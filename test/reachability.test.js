const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'isolated-test-secret';
const reachability = require('../services/reachability');
const regions = require('../data/regions');
const { REGION_COORDS } = require('../data/travelGeo');
const app = require('../server');
const db = require('../db');

const origin = id => reachability.originById.get(id);
const region = id => ({ lat: REGION_COORDS[id][0], lng: REGION_COORDS[id][1] });

test('모든 여행지에 좌표가 있고 출발지 id는 중복되지 않는다', () => {
  for (const item of regions) assert.ok(REGION_COORDS[item.id], `${item.id} 좌표 누락`);
  assert.equal(new Set(reachability.ORIGINS.map(item => item.id)).size, reachability.ORIGINS.length);
});

test('장거리는 기차가 버스보다 빠르고, 제주는 항공으로 계산한다', () => {
  const busan = reachability.estimateTrip(origin('seoul-center'), region('busan-haeundae'), 'public');
  assert.match(busan.method, /^기차/);
  assert.ok(busan.minutes >= 180 && busan.minutes <= 270, `서울→부산 대중교통 ${busan.minutes}분`);
  const car = reachability.estimateTrip(origin('seoul-center'), region('busan-haeundae'), 'car');
  assert.ok(car.minutes >= 240 && car.minutes <= 330, `서울→부산 자가용 ${car.minutes}분`);
  const jeju = reachability.estimateTrip(origin('seoul-center'), region('jeju-si'), 'car');
  assert.match(jeju.method, /^항공 \(김포공항/);
  const local = reachability.estimateTrip(origin('jj-jeju'), region('seogwipo'), 'car');
  assert.equal(local.method, '자가용');
  assert.ok(local.minutes < 120);
});

test('가기 쉬운 지역은 모두의 이동 시간을 고려하고, 출발지가 없는 멤버는 제외한다', () => {
  const travelers = [
    { userId: 1, nickname: '서울', originId: 'seoul-center', mode: 'public' },
    { userId: 2, nickname: '부산', originId: 'bs-seomyeon', mode: 'car' },
    { userId: 3, nickname: '미정', originId: null, mode: null },
  ];
  const ranking = reachability.rankRegions(travelers, regions);
  assert.equal(ranking.length, regions.length);
  assert.deepEqual(ranking[0].legs.map(leg => leg.userId), [1, 2]);
  // 서울·부산 사이에서 출발하면 한쪽 끝(서울/부산)이나 제주보다 중간 지역이 앞선다
  const rank = id => ranking.findIndex(item => item.region.id === id);
  assert.ok(rank('daegu-jung') < rank('seoul-jongno'));
  assert.ok(rank('daegu-jung') < rank('busan-haeundae'));
  assert.ok(rank('daegu-jung') < rank('jeju-si'));
  for (let index = 1; index < ranking.length; index++) assert.ok(ranking[index - 1].score <= ranking[index].score);
  assert.deepEqual(reachability.rankRegions([travelers[2]], regions), []);
});

test('현재 위치는 가까운 출발 생활권으로만 바꾸고 국외 좌표는 거부한다', () => {
  assert.equal(reachability.nearestOriginId(35.16, 129.06), 'bs-seomyeon');
  assert.equal(reachability.nearestOriginId(40.71, -74.0), null);
  assert.equal(reachability.nearestOriginId(NaN, 127), null);
});

let server, base, users;
async function request(path, user, body) {
  const response = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: user.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  users = [];
  for (let index = 0; index < 3; index++) {
    const result = await request('/signup', null, { nickname: `출발${index}`, password: 'test-pass' });
    users.push({ ...result.data.user, cookie: result.cookie });
  }
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

test('멤버가 출발지를 저장하면 참석자 기준으로 순위를 계산하고 방장만 여행지를 정한다', async () => {
  const { data: room } = await request('/rooms', users[0], { title: '출발지 테스트' });
  for (const user of users.slice(1)) await request('/rooms/join', user, { inviteCode: room.inviteCode });
  const path = `/rooms/${room.roomId}`;
  assert.equal((await request(`${path}/choose-region`, users[0], { regionId: 'daegu-jung' })).status, 409);
  const trip = await request(`${path}/trips`, users[0], { title: '첫 여행', date: '2026-10-10', participantIds: users.slice(0, 2).map(user => user.id) });
  assert.equal(trip.status, 200);

  assert.equal((await request(`${path}/origin`, users[0], { originId: 'nowhere', mode: 'car' })).status, 400);
  assert.equal((await request(`${path}/origin`, users[0], { originId: 'seoul-center', mode: 'plane' })).status, 400);
  assert.equal((await request(`${path}/origin`, users[0], { originId: 'seoul-center', mode: 'public' })).status, 200);
  const located = await request(`${path}/origin`, users[1], { lat: 35.16, lng: 129.06, mode: 'car' });
  assert.equal(located.data.originId, 'bs-seomyeon');
  await request(`${path}/origin`, users[2], { originId: 'jj-jeju', mode: 'car' });

  const easy = await request(`${path}/easy-regions`, users[1]);
  assert.equal(easy.status, 200);
  assert.equal(easy.data.travelerCount, 2);
  assert.equal(easy.data.readyCount, 2);
  assert.equal(easy.data.ranking.length, 5);
  assert.ok(easy.data.ranking.every(item => item.legs.every(leg => leg.userId !== users[2].id)));

  const detail = await request(path, users[0]);
  assert.equal(detail.data.members.find(member => member.id === users[1].id).originId, 'bs-seomyeon');
  assert.ok(detail.data.originOptions.length > 40);

  const target = easy.data.ranking[0].region.id;
  assert.equal((await request(`${path}/choose-region`, users[1], { regionId: target })).status, 403);
  assert.equal((await request(`${path}/choose-region`, users[0], { regionId: 'nowhere' })).status, 400);
  const chosen = await request(`${path}/choose-region`, users[0], { regionId: target });
  assert.equal(chosen.status, 200);
  const after = await request(path, users[0]);
  assert.equal(after.data.room.status, 'decided');
  assert.equal(after.data.room.selectedRegion.id, target);
});
