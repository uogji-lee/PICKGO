const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'isolated-test-secret';
delete process.env.KAKAO_REST_API_KEY;
const app = require('../server');
const db = require('../db');
const { regionsFromPlaces } = require('../services/destinations');

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
  for (let index = 0; index < 4; index++) {
    const result = await request('/signup', null, { nickname: `목적지${index}`, password: 'test-pass' });
    users.push({ ...result.data.user, cookie: result.cookie });
  }
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

async function setup(body = {}) {
  const { data: room } = await request('/rooms', users[0], { title: '여행지 테스트' });
  for (const user of users.slice(1)) await request('/rooms/join', user, { inviteCode: room.inviteCode });
  const path = `/rooms/${room.roomId}`;
  const trip = await request(`${path}/trips`, users[0], { title: '가을 여행', participantIds: users.slice(0, 3).map(user => user.id), ...body });
  return { path, trip };
}

test('여행을 만들 때 여행지 추첨 방식과 다시 뽑기 횟수를 정하고, 횟수를 넘으면 더 뽑을 수 없다', async () => {
  assert.equal((await setup({ destinationMethod: 'teleport' })).trip.status, 400);
  assert.equal((await setup({ drawLimit: 9 })).trip.status, 400);
  const { path } = await setup({ destinationMethod: 'random', drawLimit: 1 });
  let info = (await request(path, users[0])).data.room.trip;
  assert.deepEqual([info.destinationMethod, info.drawLimit, info.drawsLeft], ['random', 1, 2]);
  assert.equal((await request(`${path}/destination/draw`, users[1], {})).status, 403);
  const first = await request(`${path}/destination/draw`, users[0], {});
  assert.equal(first.status, 200);
  assert.equal(first.data.pool.length, 48);
  assert.ok(first.data.pool.includes(first.data.region.name));
  assert.equal(first.data.drawsLeft, 1);
  assert.equal((await request(`${path}/destination/draw`, users[0], {})).data.drawsLeft, 0);
  const third = await request(`${path}/destination/draw`, users[0], {});
  assert.equal(third.status, 409);
  assert.match(third.data.error, /다시 뽑기 1번/);
  assert.equal((await request(`${path}/draw`, users[0], {})).status, 409); // 예전 추첨 경로도 같은 제한
  info = (await request(path, users[0])).data.room;
  assert.equal(info.status, 'decided');
});

test('가기 쉬운 곳은 출발지가 모이면 중간지점 TOP 5에 투표하고, 방장이 확정하거나 그중에서 뽑는다', async () => {
  const { path } = await setup({ destinationMethod: 'easy', drawLimit: 0 });
  let state = (await request(`${path}/destination`, users[1])).data;
  assert.deepEqual([state.method, state.candidates.length, state.missingOrigins.length], ['easy', 0, 3]); // 아직 아무도 출발지 없음
  assert.equal((await request(`${path}/destination/draw`, users[0], {})).status, 409);
  await request(`${path}/origin`, users[0], { lat: 37.5665, lng: 126.978, label: '서울역', mode: 'public' });
  await request(`${path}/origin`, users[1], { lat: 35.1577, lng: 129.0592, label: '서면역', mode: 'car' });
  state = (await request(`${path}/destination`, users[1])).data;
  assert.equal(state.candidates.length, 5);
  assert.deepEqual(state.missingOrigins, [users[2].nickname]);
  assert.ok(state.midpoint.label.endsWith('근처'));
  const [top, second] = state.candidates;
  assert.equal((await request(`${path}/destination/vote`, users[3], { key: top.key })).status, 403); // 불참자
  assert.equal((await request(`${path}/destination/vote`, users[1], { key: 'seoul-jongno' })).status, 400); // 후보 밖
  await request(`${path}/destination/vote`, users[1], { key: top.key });
  await request(`${path}/destination/vote`, users[2], { key: second.key });
  state = (await request(`${path}/destination`, users[2])).data;
  assert.deepEqual(state.candidates.slice(0, 2).map(item => item.voters), [[users[1].nickname], [users[2].nickname]]);
  assert.equal(state.myVote, second.key);

  const drawn = await request(`${path}/destination/draw`, users[0], {});
  assert.equal(drawn.status, 200);
  assert.deepEqual(drawn.data.pool.sort(), state.candidates.map(item => item.region.name).sort());
  assert.equal((await request(`${path}/destination/draw`, users[0], {})).status, 409); // 다시 뽑기 0번
  // 확정은 뽑기 횟수와 무관
  assert.equal((await request(`${path}/destination/confirm`, users[1], { key: top.key })).status, 403);
  assert.equal((await request(`${path}/destination/confirm`, users[0], { key: top.key })).status, 200);
  assert.equal((await request(path, users[0])).data.room.selectedRegion.id, top.key);
});

test('원하는 곳은 아무 지역이나 후보로 올리고, 검색 지역으로 확정해도 코스·지난 여행에 이름이 남는다', async () => {
  const { path } = await setup({ destinationMethod: 'wish', drawLimit: 2 });
  const search = await request('/regions/search?q=' + encodeURIComponent('경주'), users[1]);
  assert.equal(search.data.provider, 'builtin');
  assert.deepEqual(search.data.regions.map(region => region.name), ['경북 경주시']);
  assert.equal((await request(`${path}/destination/candidates`, users[3], { region: search.data.regions[0] })).status, 403);
  assert.equal((await request(`${path}/destination/candidates`, users[1], { region: search.data.regions[0] })).status, 200);
  assert.equal((await request(`${path}/destination/candidates`, users[2], { region: { id: 'gyeongju' } })).status, 409); // 중복
  const custom = { name: '강원특별자치도 정선군', lat: 37.3807, lng: 128.6608 };
  assert.equal((await request(`${path}/destination/candidates`, users[2], { region: { name: '<script>', lat: 37, lng: 128 } })).status, 400);
  assert.equal((await request(`${path}/destination/candidates`, users[2], { region: { ...custom, lat: 10 } })).status, 400);
  assert.equal((await request(`${path}/destination/candidates`, users[2], { region: custom })).status, 200);

  let state = (await request(`${path}/destination`, users[1])).data;
  assert.deepEqual(state.candidates.map(item => [item.key, item.creator, item.canDelete]), [['gyeongju', users[1].nickname, true], [`k:${custom.name}`, users[2].nickname, false]]);
  await request(`${path}/destination/vote`, users[1], { key: `k:${custom.name}` });
  await request(`${path}/destination/vote`, users[1], { key: `k:${custom.name}` }); // 취소
  assert.equal((await request(`${path}/destination`, users[1])).data.myVote, null);

  // 방식을 바꾸면 투표 초기화, 방장만 가능
  assert.equal((await request(`${path}/destination/method`, users[1], { method: 'random' })).status, 403);
  await request(`${path}/destination/vote`, users[2], { key: 'gyeongju' });
  assert.equal((await request(`${path}/destination/method`, users[0], { method: 'wish' })).status, 200);
  assert.equal((await request(`${path}/destination`, users[2])).data.myVote, null);

  assert.equal((await request(`${path}/destination/confirm`, users[0], { key: `k:${custom.name}` })).status, 200);
  const room = (await request(path, users[0])).data.room;
  assert.deepEqual([room.selectedRegion.name, room.selectedRegion.builtin], [custom.name, false]);
  const course = await request(`${path}/recommendations`, users[1]);
  assert.equal(course.status, 200);
  assert.ok(Array.isArray(course.data.itinerary.days));

  const { tripId } = (await request(path, users[0])).data.room.trip ? { tripId: room.trip.id } : {};
  assert.equal((await request(`${path}/trips/${tripId}/finish`, users[0], {})).status, 200);
  assert.equal((await request(`${path}/past-trips`, users[1])).data.trips[0].region, custom.name);
});

test('카카오 장소 검색 결과에서 시·군·구 단위 지역을 뽑아낸다', () => {
  const regions = regionsFromPlaces([
    { place_name: '정선5일장', address_name: '강원특별자치도 정선군 정선읍 봉양리 1', x: '128.66', y: '37.38' },
    { place_name: '아리랑시장', address_name: '강원특별자치도 정선군 정선읍 2', x: '128.67', y: '37.39' },
    { place_name: '세종호수공원', address_name: '세종특별자치시 연기면 세종리 1', x: '127.27', y: '36.50' },
    { place_name: '서현역', address_name: '경기 성남시 분당구 서현동 1', x: '127.12', y: '37.38' },
  ]);
  assert.deepEqual(regions.map(region => region.name), ['강원특별자치도 정선군', '세종특별자치시', '경기 성남시']);
  assert.ok(Math.abs(regions[0].lat - 37.385) < 1e-9);
});
