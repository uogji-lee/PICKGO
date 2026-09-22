const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const security = require('./security');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function registerKakaoAuth(app, db, { auth, optionalAuth, issueToken }, options = {}) {
  const config = options.config || {
    clientId: process.env.KAKAO_REST_API_KEY, clientSecret: process.env.KAKAO_CLIENT_SECRET,
    secretDisabled: process.env.KAKAO_CLIENT_SECRET_DISABLED === 'true',
    redirectUri: process.env.KAKAO_REDIRECT_URI || `${security.origin}/api/auth/kakao/callback`,
    friendsEnabled: process.env.KAKAO_FRIENDS_ENABLED === 'true',
  };
  const fetchImpl = options.fetchImpl || fetch;
  const configured = () => Boolean(config.clientId && (config.clientSecret || config.secretDisabled));
  const error = (message, status = 400) => Object.assign(new Error(message), { status });
  const asyncRoute = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (err) { res.status(err.status || 502).json({ error: err.status ? err.message : '카카오 연결을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.' }); }
  };
  async function kakao(url, init = {}) {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (!response.ok) throw error(body.code === -402 ? '카카오 친구 목록 동의와 앱 권한이 필요합니다.' : '카카오 인증이 만료되었거나 앱 설정이 필요합니다. 카카오 계정을 다시 연결해주세요.', response.status === 401 ? 401 : 502);
    return body;
  }
  const tokenRequest = params => kakao('https://kauth.kakao.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}), ...params }),
  });
  async function accessToken(userId) {
    const account = db.prepare('SELECT * FROM kakao_accounts WHERE user_id = ?').get(userId);
    if (!account) throw error('먼저 카카오 계정을 연결해주세요.', 409);
    let tokens;
    try { tokens = security.decrypt(account.tokens); } catch { throw error('카카오 계정을 다시 연결해주세요.', 401); }
    if (account.expires_at <= Date.now() + 60000) {
      if (!tokens.refresh_token) throw error('카카오 계정을 다시 연결해주세요.', 401);
      const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
      tokens = { ...tokens, ...fresh };
      db.prepare('UPDATE kakao_accounts SET tokens = ?, expires_at = ? WHERE user_id = ?')
        .run(security.encrypt(tokens), Date.now() + fresh.expires_in * 1000, userId);
    }
    return tokens.access_token;
  }
  app.get('/api/auth/kakao/status', optionalAuth, (req, res) => res.json({
    enabled: configured(), friendsEnabled: Boolean(config.friendsEnabled), redirectUri: config.redirectUri,
    linked: Boolean(req.user && db.prepare('SELECT 1 FROM kakao_accounts WHERE user_id = ?').get(req.user.id)),
    missing: [!config.clientId && 'REST API 키', !config.clientSecret && !config.secretDisabled && '클라이언트 시크릿'].filter(Boolean),
  }));
  app.get('/api/auth/kakao/start', optionalAuth, (req, res) => {
    if (!configured()) return res.redirect('/#kakao_error=configuration');
    const mode = ['link', 'friends'].includes(req.query.mode) ? req.query.mode : 'login';
    if (mode !== 'login' && !req.user) return res.redirect('/#kakao_error=login_required');
    if (mode === 'friends' && !config.friendsEnabled) return res.redirect('/#kakao_error=friends_permission');
    const state = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO oauth_states(state_hash,user_id,mode,expires_at) VALUES (?,?,?,?)')
      .run(hash(state), mode === 'login' ? null : req.user.id, mode, Date.now() + 600000);
    res.cookie('pickgo_oauth_state', state, { ...security.cookieOptions, maxAge: 600000 });
    const url = new URL('https://kauth.kakao.com/oauth/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri, state,
      ...(mode === 'friends' ? { scope: 'friends' } : {}), ...(mode === 'link' ? { prompt: 'select_account' } : {}) }).toString();
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
        let id = pending.user_id || existing?.user_id;
        if (!id) {
          const raw = profile.kakao_account?.profile?.nickname || '카카오친구';
          const nickname = String(raw).slice(0, 6) + '_' + crypto.randomBytes(3).toString('hex');
          id = db.prepare('INSERT INTO users(nickname,password_hash) VALUES (?,?)').run(nickname, '').lastInsertRowid;
        }
        db.prepare(`INSERT INTO kakao_accounts(user_id,kakao_id,tokens,expires_at) VALUES (?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET tokens=excluded.tokens,expires_at=excluded.expires_at`)
          .run(id, kakaoId, security.encrypt(tokens), Date.now() + tokens.expires_in * 1000);
        return id;
      })();
      res.cookie('pickgo_token', issueToken({ id: userId }), { ...security.cookieOptions, maxAge: 30 * 86400000 });
      res.redirect(pending.mode === 'friends' ? '/#kakao_friends_connected' : '/#kakao_connected');
    } catch (err) { res.redirect('/#kakao_error=' + (err.status === 409 ? 'already_linked' : 'configuration')); }
  });
  app.get('/api/kakao/friends', auth, asyncRoute(async (req, res) => {
    if (!config.friendsEnabled) throw error('카카오 개발자 콘솔의 친구 목록 권한과 동의항목 설정이 필요합니다.', 409);
    const offset = Number(req.query.offset || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw error('잘못된 목록 위치입니다.');
    const token = await accessToken(req.user.id);
    const result = await kakao(`https://kapi.kakao.com/v1/api/talk/friends?limit=100&offset=${offset}`, { headers: { Authorization: `Bearer ${token}` } });
    const friends = (result.elements || []).map(friend => {
      const account = db.prepare('SELECT user_id FROM kakao_accounts WHERE kakao_id = ?').get(String(friend.id));
      if (!account || account.user_id === req.user.id) return null;
      return { id: account.user_id, nickname: friend.profile_nickname || '카카오 친구',
        added: Boolean(db.prepare('SELECT 1 FROM friend_links WHERE owner_id = ? AND friend_id = ?').get(req.user.id, account.user_id)),
        proof: jwt.sign({ owner: req.user.id, friend: account.user_id }, security.secret, { audience: 'friend-add', expiresIn: '5m' }) };
    }).filter(Boolean);
    res.json({ friends, nextOffset: offset + 100 < result.total_count ? offset + 100 : null });
  }));
  app.post('/api/friends', auth, asyncRoute(async (req, res) => {
    let proof;
    try { proof = jwt.verify(req.body.proof, security.secret, { algorithms: ['HS256'], audience: 'friend-add' }); }
    catch { throw error('친구 목록을 새로 불러온 뒤 추가해주세요.', 403); }
    if (proof.owner !== req.user.id || proof.friend === req.user.id) throw error('친구를 추가할 수 없습니다.', 403);
    db.prepare('INSERT OR IGNORE INTO friend_links(owner_id,friend_id) VALUES (?,?)').run(req.user.id, proof.friend);
    res.json({ ok: true });
  }));
  app.get('/api/friends', auth, (req, res) => res.json({ friends: db.prepare(`SELECT u.id,u.nickname FROM friend_links f JOIN users u ON u.id=f.friend_id WHERE f.owner_id=?`).all(req.user.id) }));
  app.post('/api/rooms/:id/invites', auth, asyncRoute(async (req, res) => {
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(req.params.id);
    if (!room || room.host_user_id !== req.user.id) throw error('방장만 친구를 초대할 수 있습니다.', 403);
    if (!db.prepare('SELECT 1 FROM friend_links WHERE owner_id=? AND friend_id=?').get(req.user.id, req.body.userId)) throw error('추가한 친구를 선택해주세요.');
    const member = db.prepare('SELECT active FROM room_members WHERE room_id=? AND user_id=?').get(room.id, req.body.userId);
    if (member) throw error(member.active ? '이미 참여 중입니다.' : '추방된 멤버입니다.');
    db.prepare(`INSERT INTO room_invites(room_id,sender_id,recipient_id) VALUES (?,?,?)
      ON CONFLICT(room_id,recipient_id) DO UPDATE SET status='pending',sender_id=excluded.sender_id`).run(room.id, req.user.id, req.body.userId);
    res.json({ ok: true });
  }));
  app.get('/api/invites', auth, (req, res) => res.json({ invites: db.prepare(`SELECT i.id,r.title,u.nickname AS sender FROM room_invites i
    JOIN rooms r ON r.id=i.room_id JOIN users u ON u.id=i.sender_id WHERE recipient_id=? AND i.status='pending'`).all(req.user.id) }));
  app.post('/api/invites/:id/respond', auth, asyncRoute(async (req, res) => {
    if (typeof req.body.accept !== 'boolean') throw error('수락 여부를 선택해주세요.');
    const roomId = db.transaction(() => {
      const invite = db.prepare("SELECT * FROM room_invites WHERE id=? AND recipient_id=? AND status='pending'").get(req.params.id, req.user.id);
      if (!invite) throw error('초대를 찾을 수 없습니다.', 404);
      if (req.body.accept) {
        const member = db.prepare('SELECT active FROM room_members WHERE room_id=? AND user_id=?').get(invite.room_id, req.user.id);
        if (member && !member.active) throw error('추방된 방에 입장할 수 없습니다.', 403);
        db.prepare('INSERT OR IGNORE INTO room_members(room_id,user_id) VALUES (?,?)').run(invite.room_id, req.user.id);
      }
      db.prepare('UPDATE room_invites SET status=? WHERE id=?').run(req.body.accept ? 'accepted' : 'declined', invite.id);
      return invite.room_id;
    })();
    res.json({ ok: true, roomId });
  }));
}
module.exports = { registerKakaoAuth };
