const path = require('path');
require('dotenv').config({ quiet: true });
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { customAlphabet } = require('nanoid');
const security = require('./services/security');
const { registerKakaoAuth } = require('./services/kakaoAuth');
const accounts = require('./services/accounts');

const db = require('./db');
const { registerRoomManagement } = require('./services/roomManagement');
const { planSnapshot } = require('./services/clubLedger');
const regions = require('./data/regions');
const {
  PREFERENCES,
  aggregateCustomPreferences,
  aggregatePreferences,
  buildFallbackRecommendations,
  buildItinerary,
  interpretCustomPreference,
  normalizeCustomPreference,
  normalizePreferenceIds,
  scorePlacesByPreferences,
} = require('./services/recommendations');
const { createKakaoLocalClient } = require('./services/kakaoLocal');
const { createNaverLocalClient } = require('./services/naverLocal');
const { createTourApiClient } = require('./services/tourApi');
const reachability = require('./services/reachability');

const JWT_SECRET = security.secret;
const PORT = process.env.PORT || 3000;
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6); // 헷갈리는 글자 제외
const kakaoLocal = createKakaoLocalClient();
const naverLocal = createNaverLocalClient();
const tourApi = createTourApiClient();
const { registerAccommodation, verifyAccommodation } = require('./services/accommodation');
const { registerLodging } = require('./services/lodging');

const app = express();
app.disable('x-powered-by');
if (process.env.PICKGO_TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(security.securityMiddleware);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 인증 미들웨어 ----------
function auth(req, res, next) {
  const token = req.cookies.pickgo_token;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const user = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
}

function optionalAuth(req, res, next) {
  const token = req.cookies.pickgo_token;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      const user = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(payload.uid);
      if (user) req.user = user;
    } catch (e) { /* ignore */ }
  }
  next();
}

function issueToken(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

function parseStringArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (error) {
    return [];
  }
}

function addDaysToDate(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

// ---------- 회원가입 / 로그인 ----------
const loginAttempts = new Map();
app.use(['/api/login', '/api/signup', '/api/auth/kakao/signup', '/api/me/password'], (req, res, next) => {
  const now = Date.now();
  for (const [key, value] of loginAttempts) if (value.until < now) loginAttempts.delete(key);
  const attempts = loginAttempts.get(req.ip) || { count: 0, until: now + 900000 };
  if (attempts.count >= 30) return res.status(429).json({ error: '로그인 시도가 많습니다. 15분 뒤 다시 시도해주세요.' });
  res.once('finish', () => {
    if (res.statusCode >= 400) { attempts.count++; loginAttempts.set(req.ip, attempts); }
    else loginAttempts.delete(req.ip);
  });
  next();
});
app.post('/api/signup', (req, res) => {
  if (kakaoAuth.signupRequired()) {
    return res.status(403).json({ error: '카카오 본인 인증 후 가입할 수 있어요.', code: 'KAKAO_SIGNUP_REQUIRED' });
  }
  const { nickname, password } = req.body || {};
  if (typeof nickname !== 'string' || typeof password !== 'string' || !nickname || !password) {
    return res.status(400).json({ error: '닉네임과 비밀번호를 모두 입력해주세요.' });
  }
  let trimmed, hash;
  try {
    trimmed = accounts.validateNickname(db, nickname);
    hash = accounts.hashPassword(password);
  } catch (error) { return res.status(error.status).json({ error: error.message }); }
  const info = db.prepare('INSERT INTO users (nickname, password_hash) VALUES (?, ?)').run(trimmed, hash);
  const user = { id: info.lastInsertRowid, nickname: trimmed };
  const token = issueToken(user);
  res.cookie('pickgo_token', token, { ...security.cookieOptions, maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ user });
});

app.post('/api/login', (req, res) => {
  const { nickname, password } = req.body || {};
  if (!nickname || !password) {
    return res.status(400).json({ error: '닉네임과 비밀번호를 모두 입력해주세요.' });
  }
  const row = db.prepare('SELECT * FROM users WHERE nickname = ?').get(String(nickname).trim());
  if (!row || !row.password_hash || !bcrypt.compareSync(String(password), row.password_hash)) {
    return res.status(401).json({ error: '닉네임 또는 비밀번호가 올바르지 않습니다.' });
  }
  const user = { id: row.id, nickname: row.nickname };
  const token = issueToken(user);
  res.cookie('pickgo_token', token, { ...security.cookieOptions, maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ user });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('pickgo_token', security.cookieOptions);
  res.json({ ok: true });
});

app.get('/api/me', optionalAuth, (req, res) => {
  res.json({ user: req.user ? {
    ...req.user,
    kakaoLinked: Boolean(db.prepare('SELECT 1 FROM kakao_accounts WHERE user_id = ?').get(req.user.id)),
    hasPassword: Boolean(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id)?.password_hash),
  } : null });
});

const kakaoAuth = registerKakaoAuth(app, db, { auth, optionalAuth, issueToken });

// 비밀번호 변경: 현재 비밀번호 확인, 또는 카카오 본인 인증(비밀번호 찾기) 직후 15분 이내면 현재 비밀번호 없이 재설정
app.post('/api/me/password', auth, (req, res) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  let verifiedByKakao = false;
  try {
    verifiedByKakao = jwt.verify(req.cookies[kakaoAuth.resetCookie] || '', JWT_SECRET, { algorithms: ['HS256'], audience: 'password-reset' }).uid === req.user.id;
  } catch { /* 인증 쿠키 없음 또는 만료 */ }
  if (!verifiedByKakao) {
    if (!row.password_hash) return res.status(403).json({ error: '카카오 본인 인증 후 비밀번호를 설정할 수 있어요.' });
    if (typeof req.body?.currentPassword !== 'string' || !bcrypt.compareSync(req.body.currentPassword, row.password_hash)) {
      return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }
  }
  let hash;
  try { hash = accounts.hashPassword(req.body?.newPassword); }
  catch (error) { return res.status(error.status).json({ error: error.message }); }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.clearCookie(kakaoAuth.resetCookie, security.cookieOptions);
  res.json({ ok: true });
});

app.post('/api/me/profile', auth, (req, res) => {
  const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
  if (nickname.length < 2 || nickname.length > 12) return res.status(400).json({ error: '닉네임은 2~12자로 입력해주세요.' });
  if (db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').get(nickname, req.user.id)) return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });
  db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, req.user.id);
  res.json({ user: { ...req.user, nickname } });
});
app.post('/api/friends/by-nickname', auth, (req, res) => {
  const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
  const friend = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
  if (!friend || friend.id === req.user.id) return res.status(400).json({ error: '다른 회원의 정확한 닉네임을 입력해주세요.' });
  db.prepare('INSERT OR IGNORE INTO friend_links(owner_id,friend_id) VALUES (?,?)').run(req.user.id, friend.id);
  res.json({ ok: true });
});
app.delete('/api/friends/:friendId', auth, (req, res) => {
  db.prepare('DELETE FROM friend_links WHERE owner_id = ? AND friend_id = ?').run(req.user.id, Number(req.params.friendId));
  res.json({ ok: true });
});

// ---------- 방 생성 / 입장 ----------
app.post('/api/rooms', auth, (req, res) => {
  const { title } = req.body || {};
  const roomTitle = (title && String(title).trim()) || `${req.user.nickname}의 여행`;
  let inviteCode;
  for (let i = 0; i < 10; i++) {
    const candidate = nanoid();
    const dup = db.prepare('SELECT id FROM rooms WHERE invite_code = ?').get(candidate);
    if (!dup) { inviteCode = candidate; break; }
  }
  const info = db.prepare(
    'INSERT INTO rooms (title, invite_code, host_user_id) VALUES (?, ?, ?)'
  ).run(roomTitle, inviteCode, req.user.id);
  db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)').run(info.lastInsertRowid, req.user.id);
  res.json({ roomId: info.lastInsertRowid, inviteCode });
});

app.post('/api/rooms/join', auth, (req, res) => {
  const { inviteCode } = req.body || {};
  if (!inviteCode) return res.status(400).json({ error: '초대코드를 입력해주세요.' });
  const room = db.prepare('SELECT * FROM rooms WHERE invite_code = ?').get(String(inviteCode).trim().toUpperCase());
  if (!room || room.deleted_at) return res.status(404).json({ error: '존재하지 않는 초대코드입니다.' });
  const already = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(room.id, req.user.id);
  if (already && !already.active) return res.status(403).json({ error: '추방된 방에는 다시 입장할 수 없습니다.' });
  if (!already && room.membership_locked) return res.status(403).json({ error: '멤버가 확정된 방입니다. 방장에게 초대를 요청해주세요.' });
  if (!already) {
    db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)').run(room.id, req.user.id);
  }
  res.json({ roomId: room.id });
});

app.get('/api/rooms/mine', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.title, r.invite_code, r.status, r.host_user_id
    FROM rooms r
    JOIN room_members m ON m.room_id = r.id
    WHERE m.user_id = ? AND m.active = 1 AND r.deleted_at IS NULL
    ORDER BY r.created_at DESC
  `).all(req.user.id);
  const deletedRooms = db.prepare('SELECT id,title,deleted_at FROM rooms WHERE host_user_id = ? AND deleted_at IS NOT NULL').all(req.user.id);
  res.json({ rooms: rows, deletedRooms });
});

function getRoomOr404(req, res) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room || room.deleted_at) { res.status(404).json({ error: '방을 찾을 수 없습니다.' }); return null; }
  return room;
}

function isMember(roomId, userId) {
  return !!db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ? AND active = 1').get(roomId, userId);
}

function tripRoster(room) {
  const trip = room.active_trip_id && db.prepare('SELECT participant_ids FROM journeys WHERE id=? AND room_id=?').get(room.active_trip_id, room.id);
  return trip ? JSON.parse(trip.participant_ids) : null;
}
app.post(['/api/rooms/:id/draw', '/api/rooms/:id/choose-region', '/api/rooms/:id/draw-dresscode', '/api/rooms/:id/dresscode-settings', '/api/rooms/:id/select-date', '/api/rooms/:id/trip-settings'], auth, (req, res, next) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!room.active_trip_id) return res.status(409).json({ error: '방에서 새 여행을 먼저 만들어주세요.' });
  next();
});

app.get('/api/rooms/:id', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });

  const members = db.prepare(`
    SELECT u.id, u.nickname, m.role, m.availability_json, m.dresscode, m.preferences_json, m.custom_preference, m.origin_id, m.origin_mode
    FROM room_members m JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ? AND m.active = 1
  `).all(room.id).map(m => ({
    id: m.id,
    nickname: m.nickname,
    isTreasurer: m.id === room.treasurer_user_id,
    role: m.id === room.host_user_id ? 'host' : m.role,
    availability: parseStringArray(m.availability_json),
    dresscode: m.dresscode || null,
    preferences: normalizePreferenceIds(parseStringArray(m.preferences_json)),
    customPreference: normalizeCustomPreference(m.custom_preference),
    customPreferenceKeywords: interpretCustomPreference(m.custom_preference),
    originId: reachability.normalizeOriginId(m.origin_id),
    originMode: reachability.normalizeMode(m.origin_mode),
  }));

  // 날짜별 가능 인원 집계
  const tally = {};
  const roster = tripRoster(room);
  for (const m of members.filter(member => !roster || roster.includes(member.id))) {
    for (const date of m.availability) {
      tally[date] = (tally[date] || 0) + 1;
    }
  }
  let bestDates = [];
  let bestCount = 0;
  for (const [date, count] of Object.entries(tally)) {
    if (count > bestCount) { bestCount = count; bestDates = [date]; }
    else if (count === bestCount && count > 0) { bestDates.push(date); }
  }
  bestDates.sort();

  const selectedRegion = room.selected_region_id ? regions.find(r => r.id === room.selected_region_id) : null;

  res.json({
    room: {
      id: room.id,
      title: room.title,
      inviteCode: room.invite_code,
      hostUserId: room.host_user_id,
      treasurerUserId: room.treasurer_user_id,
      activeTripId: room.active_trip_id,
      membershipLocked: Boolean(room.membership_locked),
      tripParticipantIds: roster || [],
      status: room.status,
      selectedDate: room.selected_date,
      selectedEndDate: room.selected_date ? addDaysToDate(room.selected_date, room.trip_nights ?? 1) : null,
      tripNights: room.trip_nights ?? 1,
      travelerCount: room.traveler_count ?? members.length ?? 1,
      transportMode: room.transport_mode === 'car' ? 'car' : 'public',
      vehicleCount: room.vehicle_count ?? 0,
      accommodation: room.accommodation_name ? {
        name: room.accommodation_name,
        address: room.accommodation_address || null,
        url: room.accommodation_url || null,
        mapX: room.accommodation_map_x || null,
        mapY: room.accommodation_map_y || null,
      } : null,
      selectedRegion,
      selectedDresscode: room.selected_dresscode,
      dresscodeEnabled: Boolean(room.dresscode_enabled),
    },
    members,
    tally,
    bestDates,
    bestCount,
    isHost: room.host_user_id === req.user.id,
    preferenceOptions: PREFERENCES.map(({ id, label }) => ({ id, label })),
    originOptions: reachability.ORIGINS.map(({ id, group, label }) => ({ id, group, label })),
    originModes: reachability.MODES,
  });
});

app.post('/api/rooms/:id/title', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (room.host_user_id !== req.user.id) return res.status(403).json({ error: '방장만 변경할 수 있습니다.' });
  const { title } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '방제를 입력해주세요.' });
  db.prepare('UPDATE rooms SET title = ? WHERE id = ?').run(String(title).trim(), room.id);
  res.json({ ok: true });
});

app.post('/api/rooms/:id/availability', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });
  const { dates } = req.body || {};
  if (!Array.isArray(dates)) return res.status(400).json({ error: 'dates 배열이 필요합니다.' });
  const clean = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  db.prepare('UPDATE room_members SET availability_json = ? WHERE room_id = ? AND user_id = ?')
    .run(JSON.stringify(clean), room.id, req.user.id);
  res.json({ ok: true });
});

app.post('/api/rooms/:id/dresscode', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });
  const { text } = req.body || {};
  const clean = (text || '').toString().trim().slice(0, 40);
  db.prepare('UPDATE room_members SET dresscode = ? WHERE room_id = ? AND user_id = ?')
    .run(clean || null, room.id, req.user.id);
  res.json({ ok: true });
});

app.post('/api/rooms/:id/preferences', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });
  const { preferences, customPreference } = req.body || {};
  if (!Array.isArray(preferences)) return res.status(400).json({ error: 'preferences 배열이 필요합니다.' });

  const clean = normalizePreferenceIds(preferences);
  const cleanCustomPreference = normalizeCustomPreference(customPreference);
  if (clean.length !== new Set(preferences.map(String)).size) {
    return res.status(400).json({ error: '여행 취향은 제공된 항목 중 최대 3개까지 선택할 수 있습니다.' });
  }

  db.prepare('UPDATE room_members SET preferences_json = ?, custom_preference = ? WHERE room_id = ? AND user_id = ?')
    .run(JSON.stringify(clean), cleanCustomPreference || null, room.id, req.user.id);
  res.json({ ok: true, preferences: clean, customPreference: cleanCustomPreference });
});

app.post('/api/rooms/:id/origin', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });
  const { originId, mode, lat, lng } = req.body || {};
  // 현재 위치는 가장 가까운 출발 생활권으로만 바꿔 저장하고 정확한 좌표는 보관하지 않음
  const resolvedOriginId = lat !== undefined || lng !== undefined
    ? reachability.nearestOriginId(Number(lat), Number(lng))
    : reachability.normalizeOriginId(originId);
  const cleanMode = reachability.normalizeMode(mode);
  if (!resolvedOriginId) return res.status(400).json({ error: '출발 지역을 목록에서 선택해주세요. 현재 위치가 국내가 아니면 직접 선택해야 합니다.' });
  if (!cleanMode) return res.status(400).json({ error: '이동수단은 자가용 또는 대중교통 중에서 선택해주세요.' });
  db.prepare('UPDATE room_members SET origin_id = ?, origin_mode = ? WHERE room_id = ? AND user_id = ?')
    .run(resolvedOriginId, cleanMode, room.id, req.user.id);
  res.json({ ok: true, originId: resolvedOriginId, mode: cleanMode });
});

app.get('/api/rooms/:id/easy-regions', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });
  const roster = tripRoster(room);
  const travelers = db.prepare(`
    SELECT u.id, u.nickname, m.origin_id, m.origin_mode
    FROM room_members m JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ? AND m.active = 1
  `).all(room.id).filter(member => !roster || roster.includes(member.id))
    .map(member => ({ userId: member.id, nickname: member.nickname, originId: member.origin_id, mode: member.origin_mode }));
  const ranking = reachability.rankRegions(travelers, regions);
  const readyIds = new Set(ranking[0]?.legs.map(leg => leg.userId) || []);
  res.json({
    ranking: ranking.slice(0, Math.min(Math.max(Number(req.query.limit) || 5, 1), 10)),
    readyCount: readyIds.size,
    travelerCount: travelers.length,
    missing: travelers.filter(traveler => !readyIds.has(traveler.userId)).map(traveler => traveler.nickname),
  });
});

registerAccommodation(app, {auth,getRoomOr404,naverLocal,secret:JWT_SECRET});
registerLodging(app, { db, auth, getRoomOr404, isMember, tripRoster });

// 끝난 여행 목록 (진행 중인 여행과 분리해서 표시)
app.get('/api/rooms/:id/past-trips', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });
  const nickname = db.prepare('SELECT nickname FROM users WHERE id = ?');
  const spent = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM trip_expenses WHERE trip_id = ? AND voided = 0');
  const trips = db.prepare("SELECT * FROM journeys WHERE room_id = ? AND status = 'completed' ORDER BY completed_at DESC, id DESC").all(room.id).map(trip => {
    const plan = JSON.parse(trip.plan_json || '{}');
    const itinerary = trip.itinerary_json ? JSON.parse(trip.itinerary_json) : null;
    return {
      id: trip.id,
      title: trip.title,
      completedAt: trip.completed_at,
      notes: trip.notes,
      startDate: plan.selected_date || null,
      endDate: plan.selected_date ? addDaysToDate(plan.selected_date, plan.trip_nights ?? 1) : null,
      nights: plan.trip_nights ?? 1,
      region: regions.find(region => region.id === plan.selected_region_id)?.name || null,
      dresscode: plan.selected_dresscode || null,
      accommodation: plan.accommodation_name ? { name: plan.accommodation_name, url: plan.accommodation_url || null } : null,
      participants: JSON.parse(trip.participant_ids).map(id => nickname.get(id)?.nickname || '탈퇴한 멤버'),
      spent: spent.get(trip.id).total,
      course: (itinerary?.days || []).map(day => ({ dayNumber: day.dayNumber, date: day.date, stops: day.stops.map(stop => stop.place?.name).filter(Boolean) })),
    };
  });
  res.json({ trips });
});
app.post('/api/rooms/:id/trip-settings', auth, async (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (room.host_user_id !== req.user.id) return res.status(403).json({ error: '방장만 여행 조건을 변경할 수 있습니다.' });

  const travelerCount = tripRoster(room)?.length || Number(req.body?.travelerCount);
  const transportMode = req.body?.transportMode === 'car' ? 'car' : 'public';
  const vehicleCount = transportMode === 'car' ? Number(req.body?.vehicleCount) : 0;
  const accommodationName = String(req.body?.accommodationName || '').trim().slice(0, 80);

  if (!Number.isInteger(travelerCount) || travelerCount < 1 || travelerCount > 30) {
    return res.status(400).json({ error: '여행 인원은 1명부터 30명까지 입력할 수 있습니다.' });
  }
  if (transportMode === 'car' && (!Number.isInteger(vehicleCount) || vehicleCount < 1 || vehicleCount > 10)) {
    return res.status(400).json({ error: '차량 수는 1대부터 10대까지 입력할 수 있습니다.' });
  }

  let accommodation = null;
  let accommodationNotice = null;
  const keepAccommodation = !req.body.accommodationProof && !Object.hasOwn(req.body || {}, 'accommodationName');
  if (keepAccommodation) {
    accommodation = room.accommodation_name ? { name: room.accommodation_name, address: room.accommodation_address, mapX: room.accommodation_map_x, mapY: room.accommodation_map_y } : null;
  } else if (req.body.accommodationProof) {
    try { accommodation = verifyAccommodation(req.body.accommodationProof, room, req.user.id, JWT_SECRET); }
    catch { return res.status(400).json({error:'숙소 검색 결과가 만료되었거나 여행이 변경되었습니다. 다시 검색해주세요.'}); }
  } else if (accommodationName && accommodationName === room.accommodation_name) {
    accommodation = {name:room.accommodation_name,address:room.accommodation_address,mapX:room.accommodation_map_x,mapY:room.accommodation_map_y};
  } else if (accommodationName) {
    return res.status(400).json({error:'네이버에서 숙소를 검색한 뒤 주소가 맞는 결과를 선택해주세요.'});
  }
  const updated = db.prepare(`
    UPDATE rooms
    SET traveler_count = ?, transport_mode = ?, vehicle_count = ?,
        accommodation_name = ?, accommodation_address = ?, accommodation_url = ?, accommodation_map_x = ?, accommodation_map_y = ?
    WHERE id = ? AND active_trip_id = ? AND host_user_id = ?
  `).run(
    travelerCount,
    transportMode,
    vehicleCount,
    accommodation?.name || accommodationName || null,
    accommodation?.address || null,
    keepAccommodation || (accommodationName && accommodationName === room.accommodation_name) ? room.accommodation_url : null,
    accommodation?.mapX || null,
    accommodation?.mapY || null,
    room.id, room.active_trip_id, req.user.id
  );
  if (!updated.changes) return res.status(409).json({ error: '여행 또는 방장이 변경되었습니다. 새로고침 후 다시 저장해주세요.' });

  res.json({
    ok: true,
    travelerCount,
    transportMode,
    vehicleCount,
    accommodation: accommodation || (accommodationName ? { name: accommodationName } : null),
    notice: accommodationNotice,
  });
});

app.post('/api/rooms/:id/select-date', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (room.host_user_id !== req.user.id) return res.status(403).json({ error: '방장만 날짜를 확정할 수 있습니다.' });
  const { date, nights = 1 } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '올바른 날짜가 아닙니다.' });
  if (!Number.isInteger(nights) || nights < 0 || nights > 7) {
    return res.status(400).json({ error: '여행 기간은 당일치기부터 7박 8일까지 선택할 수 있습니다.' });
  }
  db.prepare('UPDATE rooms SET selected_date = ?, trip_nights = ? WHERE id = ?').run(date, nights, room.id);
  res.json({ ok: true, selectedDate: date, selectedEndDate: addDaysToDate(date, nights), tripNights: nights });
});

// 드레스코드를 켠 여행이면 참석자들이 입력한 컨셉 중 하나를 랜덤으로 선택
function drawDresscode(room) {
  if (!room.dresscode_enabled) return null;
  const roster = tripRoster(room);
  const concepts = db.prepare('SELECT user_id, dresscode FROM room_members WHERE room_id = ? AND active = 1').all(room.id)
    .filter(member => !roster || roster.includes(member.user_id))
    .map(member => member.dresscode).filter(Boolean);
  return concepts.length ? concepts[Math.floor(Math.random() * concepts.length)] : null;
}

function decideRegion(room, region) {
  const finalDresscode = drawDresscode(room);
  db.prepare('UPDATE rooms SET selected_region_id = ?, selected_dresscode = ?, status = ? WHERE id = ?')
    .run(region.id, finalDresscode, 'decided', room.id);
  return { region, dresscode: finalDresscode };
}

app.post('/api/rooms/:id/draw', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (room.host_user_id !== req.user.id) return res.status(403).json({ error: '방장만 추첨할 수 있습니다.' });
  res.json(decideRegion(room, regions[Math.floor(Math.random() * regions.length)]));
});

app.post('/api/rooms/:id/dresscode-settings', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (room.host_user_id !== req.user.id) return res.status(403).json({ error: '방장만 드레스코드 사용 여부를 바꿀 수 있습니다.' });
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled 값이 필요합니다.' });
  db.prepare('UPDATE rooms SET dresscode_enabled = ?, selected_dresscode = CASE WHEN ? THEN selected_dresscode ELSE NULL END WHERE id = ?')
    .run(req.body.enabled ? 1 : 0, req.body.enabled ? 1 : 0, room.id);
  res.json({ ok: true, enabled: req.body.enabled });
});

app.post('/api/rooms/:id/draw-dresscode', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (room.host_user_id !== req.user.id) return res.status(403).json({ error: '방장만 드레스코드를 뽑을 수 있습니다.' });
  if (!room.dresscode_enabled) return res.status(409).json({ error: '먼저 드레스코드 뽑기를 켜주세요.' });
  const dresscode = drawDresscode(room);
  if (!dresscode) return res.status(409).json({ error: '아직 입력된 드레스코드 컨셉이 없어요.' });
  db.prepare('UPDATE rooms SET selected_dresscode = ? WHERE id = ?').run(dresscode, room.id);
  res.json({ dresscode });
});

// 가기 쉬운 지역 순위 등에서 방장이 직접 여행지를 고르는 경우 (드레스코드는 추첨과 동일하게 랜덤)
app.post('/api/rooms/:id/choose-region', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (room.host_user_id !== req.user.id) return res.status(403).json({ error: '방장만 여행지를 정할 수 있습니다.' });
  const region = regions.find(item => item.id === String(req.body?.regionId || ''));
  if (!region) return res.status(400).json({ error: '존재하지 않는 여행지입니다.' });
  res.json(decideRegion(room, region));
});

app.get('/api/rooms/:id/recommendations', auth, async (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });

  const region = room.selected_region_id ? regions.find(item => item.id === room.selected_region_id) : null;
  if (!region) return res.status(409).json({ error: '여행지를 먼저 추첨해주세요.' });

  if (!room.active_trip_id) return res.status(409).json({ error: '지난 여행 코스는 여행 기록에서 확인해주세요.' });
  const roster = tripRoster(room);
  const memberRows = db.prepare('SELECT user_id, preferences_json, custom_preference FROM room_members WHERE room_id = ? AND active = 1').all(room.id)
    .filter(member => !roster || roster.includes(member.user_id));
  const votes = aggregatePreferences(memberRows.map(member => parseStringArray(member.preferences_json)));
  const customPreferences = aggregateCustomPreferences(memberRows.map(member => member.custom_preference));
  const accommodation = room.accommodation_map_x && room.accommodation_map_y ? {
    name: room.accommodation_name || '숙소',
    address: room.accommodation_address || '',
    mapX: room.accommodation_map_x,
    mapY: room.accommodation_map_y,
  } : null;
  let tourItems = [];
  let kakaoItems = [];
  let naverItems = [];
  let tourApiConnected = false;
  let kakaoLocalConnected = false;
  let naverLocalConnected = false;
  const notices = [];
  const providerLabels = [];

  if (tourApi.isConfigured()) {
    try {
      const itineraryPlaceCount = Math.min(((room.trip_nights ?? 1) + 1) * 4, 32);
      tourItems = await tourApi.getRecommendations(region, votes, itineraryPlaceCount, {
        tripDate: room.selected_date,
        customPreferences,
      });
      if (tourItems.length) {
        tourApiConnected = true;
        providerLabels.push('한국관광공사 TourAPI');
      }
      else notices.push('TourAPI에서 해당 지역의 장소를 찾지 못했습니다.');
    } catch (error) {
      console.warn(`[TourAPI] ${error.message}`);
      notices.push('관광정보 API에 일시적으로 연결할 수 없습니다.');
    }
  } else {
    notices.push('TOUR_API_SERVICE_KEY가 없어 기본 관광정보를 사용합니다.');
  }

  if (!tourItems.length) {
    tourItems = buildFallbackRecommendations(region, votes);
    providerLabels.push('PICKGO 기본 데이터');
  }

  if (kakaoLocal.isConfigured()) {
    try {
      const anchor = accommodation || tourItems.find(item => item.mapX && item.mapY) || null;
      kakaoItems = await kakaoLocal.getPersonalizedPlaces(region.name, votes, anchor, customPreferences);
      if (kakaoItems.length) {
        kakaoLocalConnected = true;
        providerLabels.push('카카오맵');
      }
      else notices.push('카카오맵에서 취향에 맞는 주변 장소를 찾지 못했습니다.');
    } catch (error) {
      console.warn(`[Kakao Local] ${error.message}`);
      notices.push('카카오 로컬 API에 일시적으로 연결할 수 없습니다.');
    }
  } else {
    notices.push('카카오 로컬 키를 추가하면 실시간 맛집·카페·체험 검색을 우선 반영합니다.');
  }

  if (naverLocal.isConfigured()) {
    try {
      naverItems = await naverLocal.getPersonalizedPlaces(region.name, votes, customPreferences);
      if (naverItems.length) {
        naverLocalConnected = true;
        providerLabels.push('네이버 지역검색');
      } else notices.push('네이버에서 취향에 맞는 지역 검색 결과를 찾지 못했습니다.');
    } catch (error) {
      console.warn(`[Naver Local] ${error.message}`);
      notices.push('네이버 지역 검색 API에 일시적으로 연결할 수 없습니다.');
    }
  }

  const seenPlaces = new Set();
  const items = [...kakaoItems, ...naverItems, ...tourItems].filter(item => {
    const key = String(item.name || '').toLocaleLowerCase('ko')
      .replace(/[^0-9a-z가-힣]/g, '');
    if (seenPlaces.has(key)) return false;
    seenPlaces.add(key);
    return true;
  });
  const scoredItems = scorePlacesByPreferences(items, votes, customPreferences)
    .sort((a, b) => b.preferenceScore - a.preferenceScore)
    .slice(0, 40);
  const itinerary = buildItinerary(scoredItems, room.selected_date, room.trip_nights ?? 1, {
    travelerCount: room.traveler_count ?? 1,
    transportMode: room.transport_mode,
    vehicleCount: room.vehicle_count ?? 0,
    accommodation,
  });
  if (room.accommodation_url && !accommodation) {
    notices.push('링크로 정한 숙소는 위치 좌표가 없어 여행지 중심으로 코스를 구성했어요.');
  } else if (room.accommodation_name && !accommodation) {
    notices.push('숙소 좌표를 확인하지 못해 현재는 선정 지역 중심으로 코스를 구성했습니다. 여행 조건에서 숙소를 다시 검색해 주세요.');
  } else if (accommodation && !itinerary.days.some(day => day.stops.length)) {
    notices.push(`숙소에서 ${itinerary.planning.maxDistanceFromAccommodationKm}km 안에 추천 장소가 없습니다. 교통수단이나 숙소를 변경해 주세요.`);
  }
  const uniqueProviderLabels = [...new Set(providerLabels)];

  const latestRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room.id);
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });
  if (!latestRoom || latestRoom.active_trip_id !== room.active_trip_id
    || JSON.stringify(planSnapshot(latestRoom)) !== JSON.stringify(planSnapshot(room))
    || JSON.stringify(tripRoster(latestRoom)) !== JSON.stringify(roster)) {
    return res.status(409).json({ error: '코스를 만드는 동안 여행 조건이 변경되었습니다. 새로고침해주세요.' });
  }
  db.prepare("UPDATE journeys SET itinerary_json = ? WHERE id = ? AND status = 'planning'")
    .run(JSON.stringify(itinerary), room.active_trip_id);

  res.json({
    provider: [tourApiConnected, kakaoLocalConnected, naverLocalConnected].filter(Boolean).length > 1
      ? 'multi'
      : kakaoLocalConnected ? 'kakao'
        : naverLocalConnected ? 'naver'
            : tourApiConnected ? 'tourapi' : 'fallback',
    providerLabel: uniqueProviderLabels.join(' + '),
    notices,
    integrationStatus: {
      tourApi: { configured: tourApi.isConfigured(), connected: tourApiConnected },
      kakaoLocal: { configured: kakaoLocal.isConfigured(), connected: kakaoLocalConnected },
      naverLocal: { configured: naverLocal.isConfigured(), connected: naverLocalConnected },
    },
    kakaoMap: {
      configured: Boolean(process.env.KAKAO_JAVASCRIPT_KEY),
      javascriptKey: process.env.KAKAO_JAVASCRIPT_KEY || null,
    },
    preferences: PREFERENCES.map(({ id, label }) => ({ id, label, votes: votes[id] || 0 })),
    customPreferences,
    tripSettings: {
      travelerCount: room.traveler_count ?? 1,
      transportMode: room.transport_mode === 'car' ? 'car' : 'public',
      vehicleCount: room.vehicle_count ?? 0,
      accommodation: room.accommodation_name ? {
        name: room.accommodation_name,
        address: room.accommodation_address || null,
        resolved: Boolean(accommodation),
      } : null,
    },
    itinerary,
    items: scoredItems,
  });
});

registerRoomManagement(app, db, auth);

app.get('/api/health', (req,res) => res.json({service:'PICKGO',status:'ok'}));

app.use('/api', (req, res) => res.status(404).json({ error: 'API를 찾을 수 없습니다.' }));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  // 기본은 모든 네트워크 인터페이스(0.0.0.0). 내 PC에서만 열려면 HOST=127.0.0.1
  const HOST = process.env.HOST || '0.0.0.0';
  const listener = app.listen(PORT, HOST, () => {
    console.log(`PICKGO 서버가 http://localhost:${PORT} 에서 실행 중입니다. (${HOST})`);
  });
  listener.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `PICKGO: 포트 ${PORT}가 이미 사용 중입니다. 다른 프로젝트를 종료하지 말고 포트 소유자를 확인해주세요.` : `PICKGO server error: ${error.code}`);
    process.exit(error.code === 'EADDRINUSE' ? 98 : 1);
  });
}

module.exports = app;
