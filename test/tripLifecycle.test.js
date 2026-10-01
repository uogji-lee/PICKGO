const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'isolated-test-secret';
const app = require('../server');
const db = require('../db');

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
    const result = await request('/signup', null, { nickname: `여행${index}`, password: 'test-pass' });
    users.push({ ...result.data.user, cookie: result.cookie });
  }
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

async function setup(participants = users.slice(0, 2)) {
  const { data: room } = await request('/rooms', users[0], { title: '생애주기' });
  for (const user of users.slice(1)) await request('/rooms/join', user, { inviteCode: room.inviteCode });
  const path = `/rooms/${room.roomId}`;
  const trip = await request(`${path}/trips`, users[0], { title: '첫 여행', participantIds: participants.map(user => user.id) });
  return { path, tripId: trip.data.tripId };
}
const roster = async path => (await request(path, users[0])).data.room.tripParticipantIds;

test('참석 여부는 본인만 바꾸고, 다른 사람의 참석은 방장만 바꾼다', async () => {
  const { path, tripId } = await setup();
  // 본인 참석 · 불참
  assert.equal((await request(`${path}/trips/${tripId}/attendance`, users[2], { attending: true })).status, 200);
  assert.deepEqual((await roster(path)).sort(), [users[0].id, users[1].id, users[2].id].sort());
  assert.equal((await request(`${path}/trips/${tripId}/attendance`, users[1], { attending: false })).status, 200);
  assert.ok(!(await roster(path)).includes(users[1].id));
  assert.equal((await request(`${path}/trips/${tripId}/attendance`, users[1], { attending: 'yes' })).status, 400);
  // 멤버(총무 포함)는 다른 사람 참석을 바꿀 수 없음
  await request(`${path}/members/${users[3].id}/role`, users[0], { role: 'treasurer' });
  assert.equal((await request(`${path}/trips/${tripId}/participants`, users[3], { participantIds: [users[3].id] })).status, 403);
  assert.equal((await request(`${path}/trips/${tripId}/participants`, users[2], { participantIds: [users[2].id] })).status, 403);
  // 방장은 모두 변경 가능
  assert.equal((await request(`${path}/trips/${tripId}/participants`, users[0], { participantIds: [users[0].id, users[3].id] })).status, 200);
  assert.deepEqual((await roster(path)).sort(), [users[0].id, users[3].id].sort());
});

test('숙소 후보는 참석자가 링크로 올리고 한 사람 한 표로 투표, 방장이 확정한다', async () => {
  const { path } = await setup();
  const url = 'https://www.airbnb.co.kr/rooms/12345678';
  assert.equal((await request(`${path}/lodging`, users[2], { name: '불참자 숙소', url })).status, 403);
  assert.equal((await request(`${path}/lodging`, users[1], { name: '이상한 링크', url: 'javascript:alert(1)' })).status, 400);
  const first = await request(`${path}/lodging`, users[1], { name: '바다뷰 에어비앤비', url, memo: '1박 18만원' });
  assert.equal(first.status, 200);
  const second = await request(`${path}/lodging`, users[0], { name: '시내 호텔', url: 'https://hotel.example.com/a' });

  assert.equal((await request(`${path}/lodging/${first.data.id}/vote`, users[2], {})).status, 403);
  await request(`${path}/lodging/${first.data.id}/vote`, users[0], {});
  await request(`${path}/lodging/${first.data.id}/vote`, users[1], {});
  await request(`${path}/lodging/${second.data.id}/vote`, users[1], {}); // 표 옮기기
  let list = (await request(`${path}/lodging`, users[1])).data;
  assert.deepEqual(list.candidates.map(item => item.voterIds), [[users[0].id], [users[1].id]]);
  assert.equal(list.myVote, second.data.id);
  await request(`${path}/lodging/${second.data.id}/vote`, users[1], {}); // 같은 후보 다시 누르면 취소
  assert.equal((await request(`${path}/lodging`, users[1])).data.myVote, null);

  // 삭제는 올린 사람 또는 방장만
  assert.equal((await request(`${path}/lodging/${second.data.id}/delete`, users[1], {})).status, 403);
  assert.equal((await request(`${path}/lodging/${first.data.id}/delete`, users[0], {})).status, 200);
  const third = await request(`${path}/lodging`, users[1], { name: '바다뷰 에어비앤비', url });
  assert.equal((await request(`${path}/lodging/${third.data.id}/select`, users[1], {})).status, 403);
  assert.equal((await request(`${path}/lodging/${third.data.id}/select`, users[0], {})).status, 200);
  const detail = (await request(path, users[0])).data.room;
  assert.deepEqual([detail.accommodation.name, detail.accommodation.url, detail.accommodation.mapX], ['바다뷰 에어비앤비', url, null]);
  list = (await request(`${path}/lodging`, users[0])).data;
  assert.equal(list.candidates.find(item => item.id === third.data.id).selected, true);

  // 교통 조건만 저장하면 확정한 숙소는 유지
  assert.equal((await request(`${path}/trip-settings`, users[0], { transportMode: 'car', vehicleCount: 1 })).status, 200);
  assert.equal((await request(path, users[0])).data.room.accommodation.url, url);
});

test('여행을 끝내면 입력값은 기록에 보관되고, 새 여행은 빈 상태로 시작하며 지난 여행 목록에 따로 보인다', async () => {
  const { path, tripId } = await setup();
  await request(`${path}/availability`, users[1], { dates: ['2026-11-07'] });
  await request(`${path}/preferences`, users[1], { preferences: [], customPreference: '조용한 산책' });
  await request(`${path}/origin`, users[1], { originId: 'bs-seomyeon', mode: 'car' });
  await request(`${path}/select-date`, users[0], { date: '2026-11-07', nights: 1 });
  await request(`${path}/choose-region`, users[0], { regionId: 'gyeongju' });
  assert.equal((await request(`${path}/trips/${tripId}/finish`, users[0], {})).status, 200);

  const archived = JSON.parse(db.prepare('SELECT member_inputs_json FROM journeys WHERE id = ?').get(tripId).member_inputs_json);
  const saved = archived.find(item => item.userId === users[1].id);
  assert.deepEqual([saved.availability, saved.customPreference, saved.originId], [['2026-11-07'], '조용한 산책', 'bs-seomyeon']);

  const past = (await request(`${path}/past-trips`, users[1])).data.trips;
  assert.equal(past.length, 1);
  assert.deepEqual([past[0].title, past[0].region, past[0].startDate, past[0].endDate], ['첫 여행', '경북 경주시', '2026-11-07', '2026-11-08']);

  assert.equal((await request(`${path}/trips`, users[0], { title: '두 번째 여행', participantIds: [users[0].id, users[1].id] })).status, 200);
  const me = (await request(path, users[1])).data.members.find(member => member.id === users[1].id);
  assert.deepEqual([me.availability, me.customPreference, me.originId], [[], '', null]);
  assert.equal((await request(`${path}/past-trips`, users[1])).data.trips.length, 1);
});

test('링크 미리보기는 대표사진·방 정보를 채우고, 후보에는 투표자 이름이 함께 내려간다', async () => {
  const preview = require('../services/linkPreview');
  const parsed = preview.parsePreview(`<html><head><meta property="og:title" content="집 · 강릉시 · ★4.98 · 침실 3개 · 침대 3개 · 욕실 2개"/>
    <meta property="og:image" content="https://a0.muscache.com/im/pictures/a.jpeg?im_w=720&amp;width=720"/></head></html>`, 'https://www.airbnb.co.kr/rooms/1');
  assert.deepEqual(parsed.features, { bedrooms: 3, beds: 3, bathrooms: 2, capacity: null });
  assert.equal(parsed.image, 'https://a0.muscache.com/im/pictures/a.jpeg?im_w=720&width=720');
  assert.equal(parsed.suggestedName, '집 · 강릉시');
  assert.equal(preview.parsePreview('<meta property="og:image" content="http://insecure.example/a.jpg">', 'https://x.example').image, null);
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '172.20.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(preview.isPrivateAddress(address), address);
  assert.ok(!preview.isPrivateAddress('13.125.53.162'));

  const { path } = await setup();
  assert.equal((await request(`${path}/lodging/preview`, users[2], { url: 'https://www.airbnb.co.kr/rooms/1' })).status, 403);
  assert.equal((await request(`${path}/lodging/preview`, users[1], { url: 'ftp://example.com/a' })).status, 400);
  const created = await request(`${path}/lodging`, users[1], { name: '바다뷰 독채', url: 'https://www.airbnb.co.kr/rooms/1', imageUrl: 'https://a0.muscache.com/a.jpeg', bedrooms: 3, beds: 3, bathrooms: 1.5, capacity: 6 });
  assert.equal(created.status, 200);
  assert.equal((await request(`${path}/lodging`, users[1], { name: '이상한 값', url: 'https://example.com/b', bedrooms: -1 })).status, 400);
  await request(`${path}/lodging/${created.data.id}/vote`, users[0], {});
  await request(`${path}/lodging/${created.data.id}/vote`, users[1], {});
  const list = (await request(`${path}/lodging`, users[1])).data;
  const item = list.candidates[0];
  assert.deepEqual([item.imageUrl, item.bedrooms, item.beds, item.bathrooms, item.capacity], ['https://a0.muscache.com/a.jpeg', 3, 3, 1.5, 6]);
  assert.deepEqual(item.voters.sort(), [users[0].nickname, users[1].nickname].sort());
  assert.deepEqual([list.voterCount, list.participantCount], [2, 2]);
});
