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
  for (let index = 0; index < 3; index++) {
    const result = await request('/signup', null, { nickname: `옵션${index}`, password: 'test-pass' });
    users.push({ ...result.data.user, cookie: result.cookie });
  }
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

async function roomWithTrip(body) {
  const { data: room } = await request('/rooms', users[0], { title: '옵션 테스트' });
  for (const user of users.slice(1)) await request('/rooms/join', user, { inviteCode: room.inviteCode });
  const path = `/rooms/${room.roomId}`;
  const trip = await request(`${path}/trips`, users[0], { title: '가을 여행', participantIds: users.slice(0, 2).map(user => user.id), ...body });
  return { path, trip };
}

test('여행은 출발일 없이 만들고, 투표 후 일정 확정에서 날짜를 정한다', async () => {
  const { path, trip } = await roomWithTrip({ nights: 2 });
  assert.equal(trip.status, 200);
  let detail = (await request(path, users[0])).data.room;
  assert.equal(detail.selectedDate, null);
  assert.equal(detail.tripNights, 2);
  assert.equal((await request(`${path}/select-date`, users[0], { date: '2026-11-07', nights: 2 })).status, 200);
  detail = (await request(path, users[0])).data.room;
  assert.equal(detail.selectedDate, '2026-11-07');
  assert.equal(detail.selectedEndDate, '2026-11-09');
  // 잘못된 날짜를 보내면 여전히 거부
  const other = await roomWithTrip({ date: '2026-13-40' });
  assert.equal(other.trip.status, 400);
});

test('드레스코드는 방장이 켠 여행에서만 참석자 컨셉 중 하나를 뽑는다', async () => {
  const { path } = await roomWithTrip({});
  let detail = (await request(path, users[0])).data.room;
  assert.equal(detail.dresscodeEnabled, false);
  await request(`${path}/dresscode`, users[0], { text: '하와이안 셔츠' });
  await request(`${path}/dresscode`, users[1], { text: '전신 블랙' });
  await request(`${path}/dresscode`, users[2], { text: '참석 안 함' });

  // 꺼져 있으면 여행지 추첨에 드레스코드가 붙지 않고 단독 뽑기도 거부
  assert.equal((await request(`${path}/draw`, users[0], {})).data.dresscode, null);
  assert.equal((await request(`${path}/draw-dresscode`, users[0], {})).status, 409);

  assert.equal((await request(`${path}/dresscode-settings`, users[1], { enabled: true })).status, 403);
  assert.equal((await request(`${path}/dresscode-settings`, users[0], { enabled: 'yes' })).status, 400);
  assert.equal((await request(`${path}/dresscode-settings`, users[0], { enabled: true })).status, 200);
  assert.equal((await request(`${path}/draw-dresscode`, users[1], {})).status, 403);
  for (let index = 0; index < 10; index++) {
    const drawn = await request(`${path}/draw-dresscode`, users[0], {});
    assert.equal(drawn.status, 200);
    assert.ok(['하와이안 셔츠', '전신 블랙'].includes(drawn.data.dresscode), drawn.data.dresscode);
  }
  detail = (await request(path, users[0])).data.room;
  assert.equal(detail.dresscodeEnabled, true);
  assert.ok(detail.selectedDresscode);

  // 끄면 뽑힌 드레스코드도 지운다
  await request(`${path}/dresscode-settings`, users[0], { enabled: false });
  detail = (await request(path, users[0])).data.room;
  assert.equal(detail.dresscodeEnabled, false);
  assert.equal(detail.selectedDresscode, null);
});
