const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'isolated-test-secret';
const app = require('../server');
const db = require('../db');
let server;
let base;
let users;
async function request(path, user, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: user.cookie } : {}) },
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
    const result = await request('/signup', null, { nickname: `테스트${index}`, password: 'test-pass' });
    assert.equal(result.status, 200);
    users.push({ ...result.data.user, cookie: result.cookie });
  }
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
async function createRoom(managed = false) {
  const { data } = await request('/rooms', users[0], { title: '정산 테스트' });
  for (const user of users.slice(1, 3)) assert.equal((await request('/rooms/join', user, { inviteCode: data.inviteCode })).status, 200);
  const path = `/rooms/${data.roomId}`;
  let tripId;
  if (managed) {
    assert.equal((await request(`${path}/members/${users[0].id}/role`, users[0], { role: 'treasurer' })).status, 200);
    const trip = await request(`${path}/trips`, users[0], { title: '첫 여행', date: '2026-09-19', participantIds: users.slice(0, 3).map(user => user.id) });
    assert.equal(trip.status, 200);
    tripId = trip.data.tripId;
  }
  return { ...data, path, tripId };
}

test('인증, 방 격리, 총무 권한, 역할 교체와 방장 위임을 서버에서 검사한다', async () => {
  const { path } = await createRoom();
  assert.equal((await request(`${path}/finance`)).status, 401);
  assert.equal((await request(`${path}/finance`, users[3])).status, 403);
  assert.equal((await request(`${path}/finance/dues`, users[1], { amount: 10000 })).status, 403);
  assert.equal((await request(`${path}/members/${users[1].id}/role`, users[1], { role: 'treasurer' })).status, 403);
  assert.equal((await request(`${path}/members/${users[1].id}/role`, users[0], { role: 'treasurer' })).status, 200);
  assert.equal((await request(`${path}/finance/dues`, users[1], { amount: 10000 })).status, 200);
  assert.equal((await request(`${path}/members/${users[2].id}/kick`, users[1], {})).status, 403);
  await request(`${path}/members/${users[2].id}/role`, users[0], { role: 'treasurer' });
  assert.equal((await request(`${path}/finance/dues`, users[1], { amount: 20000 })).status, 403);
  assert.equal((await request(`${path}/members/${users[0].id}/kick`, users[0], {})).status, 400);
  assert.equal((await request(`${path}/members/${users[2].id}/role`, users[0], { role: 'host' })).status, 200);
  assert.equal((await request(`${path}/title`, users[0], { title: '변경' })).status, 403);
  assert.equal((await request(`${path}/title`, users[2], { title: '변경' })).status, 200);
  const detail = (await request(path, users[2])).data;
  assert.equal(detail.members.filter(person => person.role === 'host').length, 1);
  assert.equal(detail.isHost, true);
});

test('실제 회비·공동금고·선결제·추가 납부·반환 전체 흐름을 정산한다', async () => {
  const { path, tripId } = await createRoom(true);
  const manager = users[0];
  for (const user of users.slice(0, 2)) await request(`${path}/finance/payments`, manager, { userId: user.id, amount: 10000 });
  const expense = { tripId, title: '저녁', amount: 9000, payerUserId: null, participantIds: users.slice(0, 3).map(user => user.id), date: '2026-09-17' };
  assert.equal((await request(`${path}/finance/expenses`, manager, expense)).status, 200);
  assert.equal((await request(`${path}/finance/expenses`, manager, { ...expense, title: '둘만 카페', amount: 7001, payerUserId: users[1].id, participantIds: users.slice(1, 3).map(user => user.id) })).status, 200);
  let data = (await request(`${path}/finance`, users[1])).data;
  assert.deepEqual(data.people.map(person => person.balance), [7000, 10500, -6500]);
  assert.equal((await request(`${path}/trips/${tripId}/finish`, manager, {})).status, 200);
  data = (await request(`${path}/finance`, users[1])).data;
  assert.equal(data.people[2].unpaid, 6500);
  assert.equal(data.requests.find(row => row.user_id === users[2].id).remaining, 6500);
  assert.equal((await request(`${path}/finance/refunds`, manager, { userId: users[1].id, amount: 10501 })).status, 400);
  assert.equal((await request(`${path}/finance/payments`, manager, { userId: users[2].id, amount: 6500 })).status, 200);
  assert.equal((await request(`${path}/finance/refunds`, manager, { userId: users[0].id, amount: 7000 })).status, 200);
  assert.equal((await request(`${path}/finance/refunds`, manager, { userId: users[1].id, amount: 10500 })).status, 200);
  data = (await request(`${path}/finance`, manager)).data;
  assert.ok(data.people.every(person => person.balance === 0));
  assert.ok(data.people.every(person => person.unpaid === 0));
  assert.equal(data.poolBalance, 0);
  assert.equal((await request(`${path}/finance/refunds`, manager, { userId: users[1].id, amount: 10500 })).status, 400);
  assert.equal((await request(`${path}/finance/payments/${data.payments[0].id}/void`, manager, {})).status, 400);
  assert.equal((await request(`${path}/finance/nudges`, manager, { userId: users[2].id })).status, 400);
});

test('금액·분담 인원·날짜·공동금고 잔액을 검증하고 타 방 기록을 변경할 수 없다', async () => {
  const { path, tripId } = await createRoom(true);
  for (const amount of [-1, 0.5, '1000', 100000001, null]) {
    assert.equal((await request(`${path}/finance/dues`, users[0], { amount })).status, 400);
  }
  const expense = { tripId, title: '테스트', amount: 10000, payerUserId: users[0].id, participantIds: [users[0].id], date: '2026-09-17' };
  for (const patch of [{ participantIds: [] }, { participantIds: [users[3].id] }, { participantIds: [users[0].id, users[0].id] }, { date: '2026-02-30' }, { payerUserId: null }, { amount: -1 }, { payerUserId: users[3].id }]) {
    assert.equal((await request(`${path}/finance/expenses`, users[0], { ...expense, ...patch })).status, 400);
  }
  assert.equal((await request(`${path}/finance/expenses`, users[0], expense)).status, 200);
  const record = (await request(`${path}/finance`, users[0])).data.expenses[0];
  const other = await createRoom(true);
  assert.equal((await request(`${other.path}/finance/expenses/${record.id}/void`, users[0], {})).status, 404);
  assert.equal((await request(`${path}/finance/expenses/${record.id}/void`, users[0], {})).status, 200);
  assert.equal((await request(`${path}/finance`, users[0])).data.spent, 0);
});

test('회비 꼽주기는 미납자에게만 하루 한 번이며 추방 후 접근과 재입장을 차단한다', async () => {
  const { path, inviteCode, tripId } = await createRoom(true);
  const target = users[1];
  await request(`${path}/finance/dues`, users[0], { amount: 10000 });
  assert.equal((await request(`${path}/finance/nudges`, users[2], { userId: target.id })).status, 403);
  assert.equal((await request(`${path}/finance/nudges`, users[0], { userId: target.id })).status, 200);
  assert.equal((await request(`${path}/finance/nudges`, users[0], { userId: target.id })).status, 429);
  await request(`${path}/finance/payments`, users[0], { userId: users[2].id, amount: 10000, month: require('../services/clubLedger').koreanMonth() });
  assert.equal((await request(`${path}/finance/nudges`, users[0], { userId: users[2].id })).status, 400);
  await request(`${path}/finance/expenses`, users[0], { tripId, title: '교통', amount: 3000, payerUserId: target.id, participantIds: [target.id, users[0].id], date: '2026-09-17' });
  await request(`${path}/members/${target.id}/kick`, users[0], {});
  for (const suffix of ['', '/finance', '/recommendations']) assert.equal((await request(path + suffix, target)).status, 403);
  assert.equal((await request(`${path}/preferences`, target, { preferences: ['food'] })).status, 403);
  assert.equal((await request('/rooms/join', target, { inviteCode })).status, 403);
  const rooms = (await request('/rooms/mine', target)).data.rooms;
  assert.ok(!rooms.some(room => `/rooms/${room.id}` === path));
  const detail = (await request(path, users[0])).data;
  assert.equal(detail.members.length, 2);
  const finance = (await request(`${path}/finance`, users[0])).data;
  assert.equal(finance.people.find(person => person.id === target.id).balance, 1500);
  assert.equal(finance.people.find(person => person.id === target.id).active, false);
});

test('월별 부분 납부를 누적하고 중복 청구 없이 잔액과 불참자 적립금을 다음 여행에 보존한다', async () => {
  const { path, tripId } = await createRoom(true);
  const manager = users[0], ids = users.slice(0, 2).map(user => user.id);
  const month = require('../services/clubLedger').koreanMonth();
  await request(`${path}/finance/dues`, manager, { amount: 10000 });
  for (const user of users.slice(0, 3)) {
    for (const amount of [4000, 6000]) assert.equal((await request(`${path}/finance/payments`, manager, { userId: user.id, amount, month })).status, 200);
  }
  for (let i = 0; i < 2; i++) {
    const data = (await request(`${path}/finance`, manager)).data;
    assert.equal(data.dues.length, 3);
    assert.ok(data.people.every(person => person.paid === 10000 && person.monthlyUnpaid === 0));
  }
  await request(`${path}/trips/${tripId}/participants`, manager, { participantIds: ids });
  const expense = { tripId, title: '숙소', amount: 12001, payerUserId: null, participantIds: ids, date: '2026-09-19' };
  assert.equal((await request(`${path}/finance/expenses`, manager, { ...expense, participantIds: [users[2].id] })).status, 400);
  assert.equal((await request(`${path}/finance/expenses`, manager, expense)).status, 200);
  assert.equal((await request(`${path}/trips/${tripId}/participants`, manager, { participantIds: [ids[0]] })).status, 400);
  const ended = await request(`${path}/trips/${tripId}/finish`, manager, {});
  assert.equal(ended.status, 200);
  assert.deepEqual((await request(`${path}/trips/${tripId}/finish`, manager, {})).data.settlement, ended.data.settlement);
  let data = (await request(`${path}/finance`, users[1])).data;
  assert.equal(data.activeTripId, null);
  assert.equal(data.refunds.length, 0);
  assert.deepEqual(data.people.map(person => person.balance), [3999, 4000, 10000]);
  assert.equal((await request(`${path}/finance/expenses/${data.expenses[0].id}/void`, manager, {})).status, 400);
  assert.equal((await request(`${path}/finance/expenses`, manager, expense)).status, 400);
  assert.equal((await request(`${path}/draw`, manager, {})).status, 409);
  const next = await request(`${path}/trips`, manager, { title: '두 번째 여행', date: '2026-10-01', nights: 0, participantIds: [users[2].id] });
  assert.equal(next.status, 200);
  assert.equal((await request(`${path}/finance/expenses`, manager, { ...expense, tripId: next.data.tripId, participantIds: [users[2].id], amount: 3000 })).status, 200);
  data = (await request(`${path}/finance`, users[2])).data;
  assert.deepEqual(data.people.map(person => person.balance), [3999, 4000, 7000]);
  assert.equal(data.trips.length, 2);
  assert.deepEqual(data.trips.find(trip => trip.id === tripId).settlement, ended.data.settlement);
  assert.equal(data.poolBalance, data.people.reduce((sum, person) => sum + person.balance, 0));
});

test('총무 미지정 시 방장이 대행하고 지정·해제·추방 시 권한을 즉시 재계산한다', async () => {
  const { path, inviteCode } = await createRoom();
  const payment = { userId: users[0].id, amount: 100 };
  assert.equal((await request(`${path}/finance/payments`, users[0], payment)).status, 200);
  assert.equal((await request(`${path}/finance/payments`, users[1], payment)).status, 403);
  await request(`${path}/members/${users[1].id}/role`, users[0], { role: 'treasurer' });
  assert.equal((await request(`${path}/finance/payments`, users[0], payment)).status, 403);
  assert.equal((await request(`${path}/finance/payments`, users[1], payment)).status, 200);
  await request(`${path}/members/${users[1].id}/role`, users[0], { role: 'member' });
  assert.equal((await request(`${path}/finance`, users[0])).data.canManage, true);
  await request(`${path}/members/${users[1].id}/role`, users[0], { role: 'treasurer' });
  await request(`${path}/members/${users[1].id}/kick`, users[0], {});
  assert.equal((await request(`${path}/finance`, users[0])).data.canManage, true);
  assert.equal((await request(`${path}/finance/payments`, users[1], payment)).status, 403);
  await request(`${path}/membership`, users[0], { locked: true });
  assert.equal((await request('/rooms/join', users[3], { inviteCode })).status, 403);
  const response = await fetch(base + '/api' + path + '/title', {
    method: 'POST', headers: { Cookie: users[0].cookie, 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ title: '위조' }),
  });
  assert.equal(response.status, 403);
  assert.equal((await request('/missing-endpoint', users[0])).status, 404);
});

test('준비물은 여행별 저장·공용 공유·개인 격리하며 완료 후 변경을 차단한다', async () => {
  const { path, tripId } = await createRoom(true);
  const packing = `${path}/trips/${tripId}/packing`;
  assert.equal((await request(packing, users[3])).status, 403);
  assert.equal((await request(`${packing}/defaults`, users[0], {})).status, 200);
  await request(`${packing}/defaults`, users[0], {});
  const first = (await request(packing, users[0])).data;
  assert.equal(first.items.length, 20);
  assert.equal((await request(packing, users[1])).data.items.length, 10);
  await request(`${packing}/defaults`, users[1], {});
  assert.equal((await request(packing, users[1])).data.items.length, 20);
  const shared = first.items.find(item => item.category === 'shared');
  const personal = first.items.find(item => item.category === 'personal');
  assert.equal((await request(`${packing}/${personal.id}`, users[1], { checked: true })).status, 404);
  assert.equal((await request(`${packing}/${shared.id}`, users[1], { checked: true })).status, 200);
  assert.equal((await request(`${packing}/${shared.id}`, users[1], { assigneeId: users[2].id })).status, 200);
  assert.equal((await request(`${packing}/${shared.id}`, users[1], { assigneeId: users[3].id })).status, 400);
  assert.equal((await request(`${packing}/${shared.id}`, users[1], { deleted: true })).status, 403);
  const updated = (await request(packing, users[0])).data.items.find(item => item.id === shared.id);
  assert.equal(updated.checked, 1);
  assert.equal(updated.assignee_id, users[2].id);
  assert.equal((await request(packing, users[1], {title:'카메라',category:'shared'})).status, 200);
  assert.equal((await request(packing, users[1], {title:'',category:'shared'})).status, 400);
  await request(`${path}/trips/${tripId}/finish`, users[0], {});
  assert.equal((await request(`${packing}/${shared.id}`, users[0], { checked: false })).status, 403);
  assert.equal((await request(packing, users[1])).data.completed, true);
  const next = await request(`${path}/trips`, users[0], {title:'다음 여행',date:'2026-10-01',participantIds:[users[0].id]});
  const nextPath = `${path}/trips/${next.data.tripId}/packing`;
  assert.equal((await request(nextPath, users[0])).data.items.length, 0);
  assert.equal((await request(`${nextPath}/defaults`, users[1], {})).status, 403);
});

test('기존 4자 비밀번호 로그인·세션·로그아웃을 유지하고 성공 로그인은 차단 횟수에 포함하지 않는다', async () => {
  const bcrypt = require('bcryptjs');
  db.prepare('INSERT INTO users(nickname,password_hash) VALUES (?,?)').run('이전계정', bcrypt.hashSync('1234', 4));
  assert.equal((await request('/login', null, {nickname:'이전계정',password:'wrong'})).status, 401);
  let result;
  for (let i = 0; i < 32; i++) {
    result = await request('/login', null, {nickname:'이전계정',password:'1234'});
    assert.equal(result.status, 200);
  }
  const user = {cookie:result.cookie};
  assert.equal((await request('/me',user)).data.user.nickname, '이전계정');
  const logout = await request('/logout',user,{});
  assert.equal(logout.status, 200);
  assert.match(logout.cookie, /^pickgo_token=$/);
  assert.equal((await request('/me',{cookie:logout.cookie})).data.user,null);
});
