const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'isolated-nickname-availability-secret';
process.env.PICKGO_TRUST_PROXY = '1'; // X-Forwarded-For로 테스트마다 다른 IP를 씀
process.env.KAKAO_REST_API_KEY = 'test-client';
process.env.KAKAO_CLIENT_SECRET = 'test-secret';
delete process.env.KAKAO_SIGNUP_REQUIRED; // 카카오가 설정된 서버는 기본으로 카카오 가입 필수
const app = require('../server');
const db = require('../db');
let server, base, userCookie;
const check = (nickname, ip, cookie) => fetch(base + '/api/nickname-available?nickname=' + encodeURIComponent(nickname), {
  headers: { 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) },
});
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const id = db.prepare('INSERT INTO users(nickname,password_hash) VALUES (?,?)').run('Minji', '').lastInsertRowid;
  userCookie = 'pickgo_token=' + jwt.sign({ uid: id }, process.env.PICKGO_JWT_SECRET);
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

test('카카오 가입 필수 서버에서는 로그인했거나 카카오 가입 대기 중일 때만 닉네임 중복을 확인할 수 있다', async () => {
  const anonymous = await check('minji', '10.0.0.1');
  assert.equal(anonymous.status, 403);
  assert.equal((await anonymous.json()).code, 'KAKAO_SIGNUP_REQUIRED');
  const pending = raw => `pickgo_kakao_signup=${raw}`;
  const insertPending = (raw, expiresAt) => db.prepare('INSERT INTO kakao_signups(token_hash,kakao_id,tokens,token_expires_at,expires_at) VALUES (?,?,?,?,?)')
    .run(crypto.createHash('sha256').update(raw).digest('hex'), raw, '{}', 0, expiresAt);
  insertPending('waiting-signup', Date.now() + 60000);
  insertPending('expired-signup', Date.now() - 1000);
  const waiting = await check('minji', '10.0.0.1', pending('waiting-signup'));
  assert.equal(waiting.status, 200);
  assert.equal((await waiting.json()).available, false);
  assert.equal((await check('minji', '10.0.0.1', pending('expired-signup'))).status, 403);
  assert.equal((await check('minji', '10.0.0.1', pending('unknown-signup'))).status, 403);
  const loggedIn = await check('새 이름', '10.0.0.1', userCookie);
  assert.equal(loggedIn.status, 200);
  assert.equal((await loggedIn.json()).available, true);
});

test('닉네임 중복 확인은 IP마다 1분에 60번까지만 받고 넘으면 429로 막는다', async () => {
  for (let i = 0; i < 60; i++) assert.equal((await check('이름' + i, '10.0.0.2', userCookie)).status, 200, String(i));
  const limited = await check('이름', '10.0.0.2', userCookie);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, '닉네임 확인 요청이 많아요. 잠시 후 다시 시도해주세요.');
  // 다른 IP는 영향을 받지 않음
  assert.equal((await check('이름', '10.0.0.3', userCookie)).status, 200);
});
