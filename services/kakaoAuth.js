const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const security = require('./security');
const { NICKNAME_TAKEN, hashPassword, isNicknameConflict, validateNickname } = require('./accounts');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function registerKakaoAuth(app, db, { auth, optionalAuth, issueToken }, options = {}) {
  const config = options.config || {
    clientId: process.env.KAKAO_REST_API_KEY, clientSecret: process.env.KAKAO_CLIENT_SECRET,
    secretDisabled: process.env.KAKAO_CLIENT_SECRET_DISABLED === 'true',
    redirectUri: process.env.KAKAO_REDIRECT_URI || `${security.origin}/api/auth/kakao/callback`,
    signupRequired: process.env.KAKAO_SIGNUP_REQUIRED !== 'false',
  };
  const fetchImpl = options.fetchImpl || fetch;
  const configured = () => Boolean(config.clientId && (config.clientSecret || config.secretDisabled));
  // 카카오가 설정된 서버에서는 신규 가입 시 카카오 본인 인증을 거치도록 함 (KAKAO_SIGNUP_REQUIRED=false로 해제)
  const signupRequired = () => configured() && config.signupRequired !== false;
  const SIGNUP_COOKIE = 'pickgo_kakao_signup';
  const RESET_COOKIE = 'pickgo_password_reset';
  const pendingSignup = req => {
    const raw = req.cookies?.[SIGNUP_COOKIE];
    if (typeof raw !== 'string' || raw.length > 200) return null;
    const row = db.prepare('SELECT * FROM kakao_signups WHERE token_hash = ?').get(hash(raw));
    return row && row.expires_at > Date.now() ? row : null;
  };
  const error = (message, status = 400) => Object.assign(new Error(message), { status });
  const asyncRoute = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (err) { res.status(err.status || 502).json({ error: err.status ? err.message : '카카오 연결을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.', code: err.code || 'KAKAO_UNAVAILABLE' }); }
  };
  async function kakao(url, init = {}) {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (!response.ok) {
      const providerCode = String(body.code ?? body.error_code ?? 'unknown');
      console.warn(`[Kakao API] status=${response.status} code=${providerCode.replace(/[^A-Za-z0-9_-]/g,'')}`);
      const codes = {
        'KOE320': ['카카오 인증 요청이 만료되었습니다. 다시 연결해주세요.', 401, 'KAKAO_RECONNECT'],
        'KOE322': ['카카오 연결 기간이 만료되었습니다. 다시 연결해주세요.', 401, 'KAKAO_RECONNECT'],
        '-401': ['카카오 인증이 만료되었습니다. 다시 연결해주세요.', 401, 'KAKAO_RECONNECT'],
        '-9': ['카카오 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.', 429, 'KAKAO_RATE_LIMIT'],
      };
      const [message, status, code] = codes[providerCode] || (response.status === 401 ? ['카카오 인증이 만료되었습니다. 다시 연결해주세요.',401,'KAKAO_RECONNECT'] : ['카카오 연결에 실패했습니다. 앱 설정과 연결 상태를 확인해주세요.', 502, 'KAKAO_UNAVAILABLE']);
      throw Object.assign(error(message, status), {code});
    }
    return body;
  }
  const tokenRequest = params => kakao('https://kauth.kakao.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}), ...params }),
  });
  app.get('/api/auth/kakao/status', optionalAuth, (req, res) => res.json({
    enabled: configured(), redirectUri: config.redirectUri, signupRequired: signupRequired(),
    linked: Boolean(req.user && db.prepare('SELECT 1 FROM kakao_accounts WHERE user_id = ?').get(req.user.id)),
    missing: [!config.clientId && 'REST API 키', !config.clientSecret && !config.secretDisabled && '클라이언트 시크릿'].filter(Boolean),
  }));
  app.get('/api/auth/kakao/start', optionalAuth, (req, res) => {
    if (!configured()) return res.redirect('/#kakao_error=configuration');
    // 카카오 친구 API는 쓰지 않음: 예전 친구 동의 링크(mode=friends)는 일반 계정 연결로 처리
    const requested = req.query.mode === 'friends' ? 'link' : req.query.mode;
    const mode = ['link', 'recover'].includes(requested) ? requested : 'login';
    if (mode === 'link' && !req.user) return res.redirect('/#kakao_error=login_required');
    const state = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO oauth_states(state_hash,user_id,mode,expires_at) VALUES (?,?,?,?)')
      .run(hash(state), ['login', 'recover'].includes(mode) ? null : req.user.id, mode, Date.now() + 600000);
    res.cookie('pickgo_oauth_state', state, { ...security.cookieOptions, maxAge: 600000 });
    const url = new URL('https://kauth.kakao.com/oauth/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri, state,
      ...(mode === 'link' ? { prompt: 'select_account' } : {}) }).toString();
    res.redirect(url.toString());
  });
  app.get('/api/auth/kakao/callback', optionalAuth, async (req, res) => {
    const state = req.query.state;
    res.clearCookie('pickgo_oauth_state', security.cookieOptions);
    if (typeof state !== 'string' || state.length > 200 || state !== req.cookies.pickgo_oauth_state) return res.redirect('/#kakao_error=state');
    const pending = db.prepare('SELECT * FROM oauth_states WHERE state_hash = ?').get(hash(state));
    db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(hash(state));
    if (!pending || pending.expires_at < Date.now() || (pending.user_id && pending.user_id !== req.user?.id)) return res.redirect('/#kakao_error=state');
    if (req.query.error || typeof req.query.code !== 'string') return res.redirect('/#kakao_error=cancelled');
    try {
      const tokens = await tokenRequest({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: config.redirectUri });
      const profile = await kakao('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (!profile.id || !tokens.access_token || !Number.isFinite(tokens.expires_in)) throw error('잘못된 인증 응답');
      const kakaoId = String(profile.id);
      const userId = db.transaction(() => {
        const existing = db.prepare('SELECT user_id FROM kakao_accounts WHERE kakao_id = ?').get(kakaoId);
        if (pending.user_id && existing && pending.user_id !== existing.user_id) throw error('이미 다른 계정에 연결되어 있습니다.', 409);
        const linked = pending.user_id && db.prepare('SELECT kakao_id FROM kakao_accounts WHERE user_id = ?').get(pending.user_id);
        if (linked && linked.kakao_id !== kakaoId) throw error('다른 카카오 계정으로 교체할 수 없습니다.', 409);
        const id = pending.user_id || existing?.user_id;
        if (!id) return null; // 연결된 계정이 없으면 가입 완료 화면에서 닉네임·비밀번호를 정함
        if (!tokens.refresh_token) {
          const previous = db.prepare('SELECT tokens FROM kakao_accounts WHERE user_id=? AND kakao_id=?').get(id,kakaoId);
          if (previous) { try { tokens.refresh_token = security.decrypt(previous.tokens).refresh_token; } catch {} }
        }
        db.prepare(`INSERT INTO kakao_accounts(user_id,kakao_id,tokens,expires_at) VALUES (?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET tokens=excluded.tokens,expires_at=excluded.expires_at`)
          .run(id, kakaoId, security.encrypt(tokens), Date.now() + tokens.expires_in * 1000);
        return id;
      })();
      if (!userId) {
        if (pending.mode === 'recover') return res.redirect('/#kakao_error=not_linked');
        const raw = crypto.randomBytes(32).toString('base64url');
        db.prepare('DELETE FROM kakao_signups WHERE expires_at < ? OR kakao_id = ?').run(Date.now(), kakaoId);
        db.prepare('INSERT INTO kakao_signups(token_hash,kakao_id,tokens,token_expires_at,nickname_hint,expires_at) VALUES (?,?,?,?,?,?)')
          .run(hash(raw), kakaoId, security.encrypt(tokens), Date.now() + tokens.expires_in * 1000,
            String(profile.kakao_account?.profile?.nickname || '').slice(0, 12), Date.now() + 900000);
        res.cookie(SIGNUP_COOKIE, raw, { ...security.cookieOptions, maxAge: 900000 });
        return res.redirect('/#kakao_signup');
      }
      res.cookie('pickgo_token', issueToken({ id: userId }), { ...security.cookieOptions, maxAge: 30 * 86400000 });
      if (pending.mode === 'recover') {
        // 카카오 본인 인증 직후 15분 동안만 기존 비밀번호 없이 새 비밀번호 설정 허용
        res.cookie(RESET_COOKIE, jwt.sign({ uid: userId }, security.secret, { audience: 'password-reset', expiresIn: '15m' }), { ...security.cookieOptions, maxAge: 900000 });
        return res.redirect('/#kakao_recover');
      }
      res.redirect('/#kakao_connected');
    } catch (err) { res.redirect('/#kakao_error=' + (err.status === 409 ? 'already_linked' : 'configuration')); }
  });
  app.get('/api/auth/kakao/signup', (req, res) => {
    const pending = pendingSignup(req);
    res.json({ pending: Boolean(pending), nicknameHint: pending?.nickname_hint || '' });
  });
  app.post('/api/auth/kakao/signup', asyncRoute(async (req, res) => {
    const pending = pendingSignup(req);
    if (!pending) throw error('카카오 인증이 만료되었습니다. 다시 인증해주세요.', 401);
    const nickname = validateNickname(db, req.body?.nickname);
    const passwordHash = hashPassword(req.body?.password);
    const userId = db.transaction(() => {
      if (db.prepare('SELECT 1 FROM kakao_accounts WHERE kakao_id = ?').get(pending.kakao_id)) throw error('이미 가입된 카카오 계정입니다. 로그인해주세요.', 409);
      let id;
      try { id = db.prepare('INSERT INTO users(nickname,password_hash) VALUES (?,?)').run(nickname, passwordHash).lastInsertRowid; }
      catch (err) { throw isNicknameConflict(err) ? error(NICKNAME_TAKEN, 409) : err; }
      db.prepare('INSERT INTO kakao_accounts(user_id,kakao_id,tokens,expires_at) VALUES (?,?,?,?)').run(id, pending.kakao_id, pending.tokens, pending.token_expires_at);
      db.prepare('DELETE FROM kakao_signups WHERE token_hash = ?').run(pending.token_hash);
      return id;
    })();
    res.clearCookie(SIGNUP_COOKIE, security.cookieOptions);
    res.cookie('pickgo_token', issueToken({ id: userId }), { ...security.cookieOptions, maxAge: 30 * 86400000 });
    res.json({ user: { id: userId, nickname } });
  }));
  app.get('/api/friends', auth, (req, res) => res.json({ friends: db.prepare(`SELECT u.id,u.nickname FROM friend_links f JOIN users u ON u.id=f.friend_id WHERE f.owner_id=?`).all(req.user.id) }));
  app.post('/api/rooms/:id/invites', auth, asyncRoute(async (req, res) => {
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(req.params.id);
    if (!room || room.deleted_at || room.host_user_id !== req.user.id) throw error('방장만 친구를 초대할 수 있습니다.', 403);
    if (!db.prepare('SELECT 1 FROM friend_links WHERE owner_id=? AND friend_id=?').get(req.user.id, req.body.userId)) throw error('추가한 친구를 선택해주세요.');
    const member = db.prepare('SELECT active FROM room_members WHERE room_id=? AND user_id=?').get(room.id, req.body.userId);
    if (member) throw error(member.active ? '이미 참여 중입니다.' : '추방된 멤버입니다.');
    db.prepare(`INSERT INTO room_invites(room_id,sender_id,recipient_id) VALUES (?,?,?)
      ON CONFLICT(room_id,recipient_id) DO UPDATE SET status='pending',sender_id=excluded.sender_id`).run(room.id, req.user.id, req.body.userId);
    res.json({ ok: true });
  }));
  app.get('/api/invites', auth, (req, res) => res.json({ invites: db.prepare(`SELECT i.id,r.title,u.nickname AS sender FROM room_invites i
    JOIN rooms r ON r.id=i.room_id JOIN users u ON u.id=i.sender_id WHERE recipient_id=? AND i.status='pending' AND r.deleted_at IS NULL`).all(req.user.id) }));
  app.post('/api/invites/:id/respond', auth, asyncRoute(async (req, res) => {
    if (typeof req.body.accept !== 'boolean') throw error('수락 여부를 선택해주세요.');
    const roomId = db.transaction(() => {
      const invite = db.prepare("SELECT * FROM room_invites WHERE id=? AND recipient_id=? AND status='pending'").get(req.params.id, req.user.id);
      if (!invite) throw error('초대를 찾을 수 없습니다.', 404);
      if (req.body.accept) {
        if (!db.prepare('SELECT 1 FROM rooms WHERE id=? AND deleted_at IS NULL').get(invite.room_id)) throw error('삭제된 방입니다.', 404);
        const member = db.prepare('SELECT active FROM room_members WHERE room_id=? AND user_id=?').get(invite.room_id, req.user.id);
        if (member && !member.active) throw error('추방된 방에 입장할 수 없습니다.', 403);
        db.prepare('INSERT OR IGNORE INTO room_members(room_id,user_id) VALUES (?,?)').run(invite.room_id, req.user.id);
      }
      db.prepare('UPDATE room_invites SET status=? WHERE id=?').run(req.body.accept ? 'accepted' : 'declined', invite.id);
      return invite.room_id;
    })();
    res.json({ ok: true, roomId });
  }));
  return { configured, signupRequired, hasPendingSignup: req => Boolean(pendingSignup(req)), resetCookie: RESET_COOKIE };
}
module.exports = { registerKakaoAuth };
