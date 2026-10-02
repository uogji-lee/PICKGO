const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'isolated-nickname-test-secret';
const app = require('../server');
const db = require('../db');
const accounts = require('../services/accounts');
let server, base;
async function request(path, user, body) {
  const response = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: user.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
}
const signup = nickname => request('/signup', null, { nickname, password: 'test-pass' });
const available = (nickname, user) => request('/nickname-available?nickname=' + encodeURIComponent(nickname), user);
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

test('닉네임은 공백 정리·NFC 정규화해 저장하고 대소문자·공백만 다른 이름은 409로 막는다', async () => {
  const first = await signup('Minji');
  assert.equal(first.status, 200);
  assert.equal(first.data.user.nickname, 'Minji');
  for (const nickname of ['minji', ' MINJI ', 'mInJi']) {
    const result = await signup(nickname);
    assert.equal(result.status, 409, nickname);
    assert.equal(result.data.error, '이미 사용 중인 닉네임입니다.');
  }
  const spaced = await signup('  민   지 ');
  assert.equal(spaced.status, 200);
  assert.equal(spaced.data.user.nickname, '민 지');
  for (const nickname of ['민 지', '민  지', '민 지 ', '민\t지']) assert.equal((await signup(nickname)).status, 409, JSON.stringify(nickname));
  // 자모가 분리된(NFD) 입력도 완성형으로 저장돼 같은 이름으로 본다
  const decomposed = await signup('하늘'.normalize('NFD'));
  assert.equal(decomposed.status, 200);
  assert.equal(decomposed.data.user.nickname, '하늘'.normalize('NFC'));
  assert.equal((await signup('하늘')).status, 409);
  // 보이지 않는 문자(폭 없는 공백·방향 제어·soft hyphen·한글 채움 문자 등)가 섞인 닉네임은 거절
  for (const mark of ['\u200B', '\u200C', '\u200D', '\u200E', '\u200F', '\u202E', '\u2066', '\u00AD', '\u2060', '\u115F', '\u1160', '\u3164', '\uFFA0']) {
    assert.equal((await signup(`mi${mark}nji`)).status, 400, mark.codePointAt(0).toString(16));
  }
  assert.equal((await signup(' a ')).status, 400);
  assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE lower(nickname) = 'minji'").get().n, 1);
});

test('로그인은 공백을 정리하고 대소문자가 달라도 저장된 계정으로 로그인하되 비밀번호는 그대로 확인한다', async () => {
  assert.equal((await signup('Traveler')).status, 200);
  for (const nickname of ['traveler', ' TRAVELER ', 'Traveler']) {
    const result = await request('/login', null, { nickname, password: 'test-pass' });
    assert.equal(result.status, 200, nickname);
    assert.equal(result.data.user.nickname, 'Traveler');
  }
  assert.equal((await request('/login', null, { nickname: 'traveler', password: 'wrong-pass' })).status, 401);
  const spaced = await request('/login', null, { nickname: '  민    지  ', password: 'test-pass' });
  assert.equal(spaced.status, 200);
  assert.equal(spaced.data.user.nickname, '민 지');
});

test('닉네임 변경도 다른 사람과 대소문자·공백만 다르면 409, 내 닉네임의 대소문자 변경은 허용한다', async () => {
  const bora = await signup('Bora');
  const user = { ...bora.data.user, cookie: bora.cookie };
  assert.equal((await request('/me/profile', user, { nickname: 'MINJI' })).status, 409);
  assert.equal((await request('/me/profile', user, { nickname: '민 지 ' })).status, 409);
  assert.equal((await request('/me/profile', user, { nickname: 'x' })).status, 400);
  const own = await request('/me/profile', user, { nickname: ' BORA ' });
  assert.equal(own.status, 200);
  assert.equal(own.data.user.nickname, 'BORA');
  const changed = await request('/me/profile', user, { nickname: '보라   여행' });
  assert.equal(changed.status, 200);
  assert.equal((await request('/me', user)).data.user.nickname, '보라 여행');
});

test('닉네임 사용 가능 여부 API는 정규화한 값과 안내 문구를 주고 로그인 사용자의 현재 닉네임은 사용 가능으로 본다', async () => {
  const taken = await available(' MINJI ');
  assert.equal(taken.status, 200);
  assert.deepEqual(taken.data, { available: false, nickname: 'MINJI', message: '이미 사용 중인 닉네임이에요' });
  assert.equal(taken.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await available('  새   이름 ')).data, { available: true, nickname: '새 이름', message: '사용 가능한 닉네임이에요' });
  assert.deepEqual((await available('a')).data, { available: false, nickname: 'a', message: '닉네임은 2~12자로 입력해주세요.' });
  assert.equal((await available('가'.repeat(41))).status, 400);
  assert.equal((await request('/nickname-available')).status, 400);
  const login = await request('/login', null, { nickname: 'minji', password: 'test-pass' });
  const me = { cookie: login.cookie };
  assert.equal((await available('minji', me)).data.available, true);
  assert.equal((await available('traveler', me)).data.available, false);
});

test('중복 확인을 통과한 뒤 같은 이름이 먼저 저장되는 경쟁에서도 가입·닉네임 변경은 409로 답한다', async () => {
  // 확인과 저장 사이에 다른 요청이 대소문자만 다른 같은 이름을 먼저 저장한 상황을 트리거로 흉내 냄
  db.exec(`CREATE TEMP TRIGGER race_insert BEFORE INSERT ON users WHEN NEW.nickname = 'Racer' BEGIN INSERT INTO users(nickname,password_hash) VALUES ('RACER',''); END;
    CREATE TEMP TRIGGER race_update BEFORE UPDATE OF nickname ON users WHEN NEW.nickname = 'Racer' BEGIN INSERT INTO users(nickname,password_hash) VALUES ('RACER',''); END;`);
  try {
    const raced = await signup('Racer');
    assert.equal(raced.status, 409);
    assert.equal(raced.data.error, '이미 사용 중인 닉네임입니다.');
    const runner = await signup('Runner');
    const renamed = await request('/me/profile', { cookie: runner.cookie }, { nickname: 'Racer' });
    assert.equal(renamed.status, 409);
    assert.equal(renamed.data.error, '이미 사용 중인 닉네임입니다.');
    assert.equal((await request('/me', { cookie: runner.cookie })).data.user.nickname, 'Runner');
    // 실패한 문장은 트리거가 저장한 행까지 함께 되돌림
    assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE lower(nickname) = 'racer'").get().n, 0);
  } finally { db.exec('DROP TRIGGER race_insert; DROP TRIGGER race_update;'); }
});

test('DB에도 대소문자 무시 유니크 인덱스가 있어 동시 가입 경쟁은 닉네임 충돌로 판별된다', () => {
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'users_nickname_ci'").get());
  let error;
  try { db.prepare('INSERT INTO users(nickname,password_hash) VALUES (?,?)').run('TRAVELER', ''); } catch (err) { error = err; }
  assert.ok(error);
  assert.equal(accounts.isNicknameConflict(error), true);
  assert.equal(accounts.isNicknameConflict(Object.assign(new Error('FOREIGN KEY constraint failed'), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })), false);
});
