const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'isolated-kakao-test-secret-not-production';
const db = require('../db');
const security = require('../services/security');
const { registerKakaoAuth } = require('../services/kakaoAuth');
let server, base, profileId = 1001, externalCalls = 0, simulatedError = null;
const config = { clientId: 'test-client', clientSecret: 'test-secret', redirectUri: 'http://localhost:3000/api/auth/kakao/callback', friendsEnabled: true };
const optionalAuth = (req, res, next) => { if (req.headers['x-test-user']) req.user = { id: Number(req.headers['x-test-user']) }; next(); };
const auth = (req, res, next) => optionalAuth(req, res, () => req.user ? next() : res.status(401).json({ error: 'login' }));
const issueToken = user => jwt.sign({ uid: user.id }, security.secret);
before(async () => {
  db.prepare('INSERT INTO users(id,nickname,password_hash) VALUES (1,?,?), (2,?,?)').run('기존친구1', '', '기존친구2', '');
  const app = express();
  app.use(express.json(), cookieParser());
  registerKakaoAuth(app, db, { auth, optionalAuth, issueToken }, { config, fetchImpl: async url => {
    externalCalls++;
    if (simulatedError && url.includes('/talk/friends')) return {ok:false,status:403,json:async()=>({code:simulatedError})};
    let result;
    if (url.includes('/oauth/token')) result = { access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600 };
    else if (url.includes('/v2/user/me')) result = { id: profileId, kakao_account: { profile: { nickname: '카카오친구' } } };
    else result = { elements: [{ id: 1002, profile_nickname: '카카오친구2' }, { id: 9999, profile_nickname: '앱 미가입' }], total_count: 2 };
    return { ok: true, json: async () => result };
  } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
const call = (path, user, body, cookie) => fetch(base + '/api' + path, {
  method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': String(user) } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
async function begin(user, mode = 'link') {
  const response = await call('/auth/kakao/start?mode=' + mode, user);
  const url = new URL(response.headers.get('location'));
  return { state: url.searchParams.get('state'), cookie: response.headers.get('set-cookie').split(';')[0], url };
}
const finish = (pending, user) => call('/auth/kakao/callback?code=test-code&state=' + pending.state, user, null, pending.cookie);

test('친구 동의 성공은 친구관리 복귀 신호를 전달하고 비활성화 시 명확히 거부한다', async () => {
  const pending = await begin(1,'friends');
  assert.equal(pending.url.searchParams.get('scope'),'friends');
  assert.equal((await finish(pending,1)).headers.get('location'),'/#kakao_friends_connected');
  config.friendsEnabled = false;
  assert.equal((await call('/auth/kakao/start?mode=friends',1)).headers.get('location'),'/#kakao_error=friends_permission');
  config.friendsEnabled = true;
  db.prepare('DELETE FROM kakao_accounts WHERE user_id=1').run();
  externalCalls = 0;
});

test('OAuth state·연결 계정·토큰 암호화 및 재사용을 검증한다', async () => {
  const pending = await begin(1);
  assert.equal(pending.url.origin, 'https://kauth.kakao.com');
  assert.equal(pending.url.searchParams.get('redirect_uri'), config.redirectUri);
  const wrong = await call('/auth/kakao/callback?code=test-code&state=wrong', 1, null, pending.cookie);
  assert.equal(wrong.headers.get('location'), '/#kakao_error=state');
  assert.equal(externalCalls, 0);
  const connected = await finish(pending, 1);
  assert.equal(connected.headers.get('location'), '/#kakao_connected');
  assert.match(connected.headers.get('set-cookie'), /HttpOnly/);
  const stored = db.prepare('SELECT * FROM kakao_accounts WHERE user_id=1').get();
  assert.equal(stored.kakao_id, '1001');
  assert.ok(!stored.tokens.includes('private'));
  assert.equal(security.decrypt(stored.tokens).access_token, 'private-access-token');
  assert.equal((await finish(pending, 1)).headers.get('location'), '/#kakao_error=state');
  assert.equal(externalCalls, 2);
  const wrongOwner = await begin(1);
  assert.equal((await finish(wrongOwner, 2)).headers.get('location'), '/#kakao_error=state');
  const conflict = await begin(2);
  assert.equal((await finish(conflict, 2)).headers.get('location'), '/#kakao_error=already_linked');
  assert.equal(db.prepare('SELECT count(*) AS n FROM kakao_accounts').get().n, 1);
});

test('카카오 친구 증명으로만 추가하고 초대는 수신자만 수락한다', async () => {
  profileId = 1002;
  assert.equal((await finish(await begin(2), 2)).headers.get('location'), '/#kakao_connected');
  const consent = await begin(1, 'friends');
  assert.equal(consent.url.searchParams.get('scope'), 'friends');
  const { friends } = await (await call('/kakao/friends', 1)).json();
  assert.equal(friends.length, 1);
  assert.equal(friends[0].id, 2);
  assert.equal((await call('/friends', 1, { userId: 2 })).status, 403);
  assert.equal((await call('/friends', 2, { proof: friends[0].proof })).status, 403);
  assert.equal((await call('/friends', 1, { proof: friends[0].proof })).status, 200);
  db.prepare("INSERT INTO rooms(id,title,invite_code,host_user_id,membership_locked) VALUES (1,'친구 모임','ABCDEF',1,1)").run();
  db.prepare('INSERT INTO room_members(room_id,user_id) VALUES (1,1)').run();
  assert.equal((await call('/rooms/1/invites', 2, { userId: 1 })).status, 403);
  assert.equal((await call('/rooms/1/invites', 1, { userId: 2 })).status, 200);
  const { invites } = await (await call('/invites', 2)).json();
  assert.equal(invites.length, 1);
  assert.equal((await call(`/invites/${invites[0].id}/respond`, 1, { accept: true })).status, 404);
  assert.equal((await call(`/invites/${invites[0].id}/respond`, 2, { accept: true })).status, 200);
  assert.equal(db.prepare('SELECT active FROM room_members WHERE room_id=1 AND user_id=2').get().active, 1);
  assert.equal((await call(`/invites/${invites[0].id}/respond`, 2, { accept: true })).status, 404);
});

test('친구 동의 부족과 앱 권한 부족은 서로 다른 복구 방법을 반환한다', async () => {
  for (const [provider,code] of [[-402,'KAKAO_CONSENT_REQUIRED'],[-5,'KAKAO_APP_PERMISSION']]) {
    simulatedError=provider;
    const result=await call('/kakao/friends',2);
    assert.equal(result.status,403);
    assert.equal((await result.json()).code,code);
  }
  simulatedError=null;
});

test('카카오 로그인은 기존 연결 계정을 재사용하며 설정 응답은 비밀값을 노출하지 않는다', async () => {
  const pending = await begin(null, 'login');
  const response = await finish(pending);
  assert.equal(response.headers.get('location'), '/#kakao_connected');
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 2);
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('pickgo_token='));
  const token = cookie.split(';')[0].slice('pickgo_token='.length);
  assert.equal(jwt.verify(token, security.secret).uid, 2);
  const status = await (await call('/auth/kakao/status', 2)).text();
  assert.ok(!status.includes('test-secret') && !status.includes('test-client'));
  assert.equal(JSON.parse(status).linked, true);
  config.friendsEnabled = false;
  assert.equal((await call('/kakao/friends', 2)).status, 409);
});

test('연결되지 않은 카카오 계정은 닉네임·비밀번호를 정해야 가입이 완료되고 계정에 연결된다', async () => {
  profileId = 3003;
  const before = db.prepare('SELECT count(*) AS n FROM users').get().n;
  const response = await finish(await begin(null, 'login'));
  assert.equal(response.headers.get('location'), '/#kakao_signup');
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, before);
  const signupCookie = response.headers.getSetCookie().find(value => value.startsWith('pickgo_kakao_signup=')).split(';')[0];
  assert.ok(!response.headers.getSetCookie().some(value => value.startsWith('pickgo_token=')));
  assert.deepEqual(await (await call('/auth/kakao/signup', null, null, signupCookie)).json(), { pending: true, nicknameHint: '카카오친구' });
  assert.equal((await call('/auth/kakao/signup', null, { nickname: '새친구', password: 'short' }, signupCookie)).status, 400);
  assert.equal((await call('/auth/kakao/signup', null, { nickname: '기존친구1', password: 'long-enough-pass' }, signupCookie)).status, 409);
  assert.equal((await call('/auth/kakao/signup', null, { nickname: '새친구', password: 'long-enough-pass' })).status, 401);
  const done = await call('/auth/kakao/signup', null, { nickname: '새친구', password: 'long-enough-pass' }, signupCookie);
  assert.equal(done.status, 200);
  const { user } = await done.json();
  assert.equal(db.prepare('SELECT kakao_id FROM kakao_accounts WHERE user_id = ?').get(user.id).kakao_id, '3003');
  assert.ok(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id).password_hash.startsWith('$2'));
  // 같은 인증으로 두 번 가입할 수 없고, 다음 카카오 로그인은 만든 계정으로 바로 로그인
  assert.equal((await call('/auth/kakao/signup', null, { nickname: '또친구', password: 'long-enough-pass' }, signupCookie)).status, 401);
  const again = await finish(await begin(null, 'login'));
  assert.equal(again.headers.get('location'), '/#kakao_connected');
  const token = again.headers.getSetCookie().find(value => value.startsWith('pickgo_token=')).split(';')[0].slice('pickgo_token='.length);
  assert.equal(jwt.verify(token, security.secret).uid, user.id);
  assert.equal(JSON.parse(await (await call('/auth/kakao/status')).text()).signupRequired, true);
});

test('비밀번호 찾기는 카카오에 연결된 계정만 로그인시키고 15분짜리 재설정 권한을 준다', async () => {
  profileId = 4004;
  assert.equal((await finish(await begin(null, 'recover'))).headers.get('location'), '/#kakao_error=not_linked');
  profileId = 3003;
  const response = await finish(await begin(null, 'recover'));
  assert.equal(response.headers.get('location'), '/#kakao_recover');
  const reset = response.headers.getSetCookie().find(value => value.startsWith('pickgo_password_reset='));
  const claims = jwt.verify(reset.split(';')[0].slice('pickgo_password_reset='.length), security.secret, { audience: 'password-reset' });
  assert.equal(claims.uid, db.prepare("SELECT user_id FROM kakao_accounts WHERE kakao_id = '3003'").get().user_id);
  assert.ok(claims.exp - claims.iat <= 900);
});
