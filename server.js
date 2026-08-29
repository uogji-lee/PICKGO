const path = require('path');
require('dotenv').config({ quiet: true });
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { customAlphabet } = require('nanoid');

const db = require('./db');
const regions = require('./data/regions');
const {
  PREFERENCES,
  aggregatePreferences,
  buildFallbackRecommendations,
  buildItinerary,
  normalizePreferenceIds,
} = require('./services/recommendations');
const { createKakaoLocalClient } = require('./services/kakaoLocal');
const { createNaverLocalClient } = require('./services/naverLocal');
const { createGooglePlacesClient } = require('./services/googlePlaces');
const { createTourApiClient } = require('./services/tourApi');

const JWT_SECRET = process.env.PICKGO_JWT_SECRET || 'pickgo-dev-secret-change-me';
const PORT = process.env.PORT || 3000;
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6); // 헷갈리는 글자 제외
const kakaoLocal = createKakaoLocalClient();
const naverLocal = createNaverLocalClient();
const googlePlaces = createGooglePlacesClient();
const tourApi = createTourApiClient();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 인증 미들웨어 ----------
function auth(req, res, next) {
  const token = req.cookies.pickgo_token;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
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
      const payload = jwt.verify(token, JWT_SECRET);
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
app.post('/api/signup', (req, res) => {
  const { nickname, password } = req.body || {};
  if (!nickname || !password) {
    return res.status(400).json({ error: '닉네임과 비밀번호를 모두 입력해주세요.' });
  }
  const trimmed = String(nickname).trim();
  if (trimmed.length < 2 || trimmed.length > 12) {
    return res.status(400).json({ error: '닉네임은 2~12자로 입력해주세요.' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상으로 입력해주세요.' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE nickname = ?').get(trimmed);
  if (exists) return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (nickname, password_hash) VALUES (?, ?)').run(trimmed, hash);
  const user = { id: info.lastInsertRowid, nickname: trimmed };
  const token = issueToken(user);
  res.cookie('pickgo_token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax' });
  res.json({ user });
});

app.post('/api/login', (req, res) => {
  const { nickname, password } = req.body || {};
  if (!nickname || !password) {
    return res.status(400).json({ error: '닉네임과 비밀번호를 모두 입력해주세요.' });
  }
  const row = db.prepare('SELECT * FROM users WHERE nickname = ?').get(String(nickname).trim());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: '닉네임 또는 비밀번호가 올바르지 않습니다.' });
  }
  const user = { id: row.id, nickname: row.nickname };
  const token = issueToken(user);
  res.cookie('pickgo_token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax' });
  res.json({ user });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('pickgo_token');
  res.json({ ok: true });
});

app.get('/api/me', optionalAuth, (req, res) => {
  res.json({ user: req.user || null });
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
  if (!room) return res.status(404).json({ error: '존재하지 않는 초대코드입니다.' });
  const already = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(room.id, req.user.id);
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
    WHERE m.user_id = ?
    ORDER BY r.created_at DESC
  `).all(req.user.id);
  res.json({ rooms: rows });
});

function getRoomOr404(req, res) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) { res.status(404).json({ error: '방을 찾을 수 없습니다.' }); return null; }
  return room;
}

function isMember(roomId, userId) {
  return !!db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
}

app.get('/api/rooms/:id', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });

  const members = db.prepare(`
    SELECT u.id, u.nickname, m.availability_json, m.dresscode, m.preferences_json
    FROM room_members m JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ?
  `).all(room.id).map(m => ({
    id: m.id,
    nickname: m.nickname,
    availability: parseStringArray(m.availability_json),
    dresscode: m.dresscode || null,
    preferences: normalizePreferenceIds(parseStringArray(m.preferences_json))
  }));

  // 날짜별 가능 인원 집계
  const tally = {};
  for (const m of members) {
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
      status: room.status,
      selectedDate: room.selected_date,
      selectedEndDate: room.selected_date ? addDaysToDate(room.selected_date, room.trip_nights ?? 1) : null,
      tripNights: room.trip_nights ?? 1,
      selectedRegion,
      selectedDresscode: room.selected_dresscode
    },
    members,
    tally,
    bestDates,
    bestCount,
    isHost: room.host_user_id === req.user.id,
    preferenceOptions: PREFERENCES.map(({ id, label }) => ({ id, label }))
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
  const { preferences } = req.body || {};
  if (!Array.isArray(preferences)) return res.status(400).json({ error: 'preferences 배열이 필요합니다.' });

  const clean = normalizePreferenceIds(preferences);
  if (clean.length !== new Set(preferences.map(String)).size) {
    return res.status(400).json({ error: '여행 취향은 제공된 항목 중 최대 3개까지 선택할 수 있습니다.' });
  }

  db.prepare('UPDATE room_members SET preferences_json = ? WHERE room_id = ? AND user_id = ?')
    .run(JSON.stringify(clean), room.id, req.user.id);
  res.json({ ok: true, preferences: clean });
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

app.post('/api/rooms/:id/draw', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (room.host_user_id !== req.user.id) return res.status(403).json({ error: '방장만 추첨할 수 있습니다.' });

  const members = db.prepare('SELECT dresscode FROM room_members WHERE room_id = ?').all(room.id);
  const dresscodes = members.map(m => m.dresscode).filter(Boolean);

  const region = regions[Math.floor(Math.random() * regions.length)];
  const finalDresscode = dresscodes.length
    ? dresscodes[Math.floor(Math.random() * dresscodes.length)]
    : null;

  db.prepare('UPDATE rooms SET selected_region_id = ?, selected_dresscode = ?, status = ? WHERE id = ?')
    .run(region.id, finalDresscode, 'decided', room.id);

  res.json({ region, dresscode: finalDresscode });
});

app.get('/api/rooms/:id/recommendations', auth, async (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (!isMember(room.id, req.user.id)) return res.status(403).json({ error: '방 멤버가 아닙니다.' });

  const region = room.selected_region_id ? regions.find(item => item.id === room.selected_region_id) : null;
  if (!region) return res.status(409).json({ error: '여행지를 먼저 추첨해주세요.' });

  const memberRows = db.prepare('SELECT preferences_json FROM room_members WHERE room_id = ?').all(room.id);
  const votes = aggregatePreferences(memberRows.map(member => parseStringArray(member.preferences_json)));
  let tourItems = [];
  let kakaoItems = [];
  let naverItems = [];
  let googleItems = [];
  let tourApiConnected = false;
  let kakaoLocalConnected = false;
  let naverLocalConnected = false;
  let googlePlacesConnected = false;
  const notices = [];
  const providerLabels = [];

  if (tourApi.isConfigured()) {
    try {
      const itineraryPlaceCount = Math.min(((room.trip_nights ?? 1) + 1) * 4, 32);
      tourItems = await tourApi.getRecommendations(region, votes, itineraryPlaceCount, {
        tripDate: room.selected_date,
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
      const anchor = tourItems.find(item => item.mapX && item.mapY) || null;
      kakaoItems = await kakaoLocal.getPersonalizedPlaces(region.name, votes, anchor);
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
      naverItems = await naverLocal.getPersonalizedPlaces(region.name, votes);
      if (naverItems.length) {
        naverLocalConnected = true;
        providerLabels.push('네이버 지역검색');
      } else notices.push('네이버에서 취향에 맞는 지역 검색 결과를 찾지 못했습니다.');
    } catch (error) {
      console.warn(`[Naver Local] ${error.message}`);
      notices.push('네이버 지역 검색 API에 일시적으로 연결할 수 없습니다.');
    }
  }

  if (googlePlaces.isConfigured()) {
    try {
      googleItems = await googlePlaces.getPersonalizedPlaces(region.name, votes);
      if (googleItems.length) {
        googlePlacesConnected = true;
        providerLabels.push('Google Maps');
      } else notices.push('Google Places에서 취향에 맞는 장소를 찾지 못했습니다.');
    } catch (error) {
      console.warn(`[Google Places] ${error.message}`);
      notices.push('Google Places API에 일시적으로 연결할 수 없습니다.');
    }
  }

  const seenPlaces = new Set();
  const items = [...kakaoItems, ...naverItems, ...tourItems, ...googleItems].filter(item => {
    const key = String(item.name || '').toLocaleLowerCase('ko')
      .replace(/[^0-9a-z가-힣]/g, '');
    if (seenPlaces.has(key)) return false;
    seenPlaces.add(key);
    return true;
  }).slice(0, 40);
  const itinerary = buildItinerary(items, room.selected_date, room.trip_nights ?? 1);
  const uniqueProviderLabels = [...new Set(providerLabels)];

  res.json({
    provider: [tourApiConnected, kakaoLocalConnected, naverLocalConnected, googlePlacesConnected].filter(Boolean).length > 1
      ? 'multi'
      : kakaoLocalConnected ? 'kakao'
        : naverLocalConnected ? 'naver'
          : googlePlacesConnected ? 'google'
            : tourApiConnected ? 'tourapi' : 'fallback',
    providerLabel: uniqueProviderLabels.join(' + '),
    notices,
    integrationStatus: {
      tourApi: { configured: tourApi.isConfigured(), connected: tourApiConnected },
      kakaoLocal: { configured: kakaoLocal.isConfigured(), connected: kakaoLocalConnected },
      naverLocal: { configured: naverLocal.isConfigured(), connected: naverLocalConnected },
      googlePlaces: { configured: googlePlaces.isConfigured(), connected: googlePlacesConnected },
    },
    kakaoMap: {
      configured: Boolean(process.env.KAKAO_JAVASCRIPT_KEY),
      javascriptKey: process.env.KAKAO_JAVASCRIPT_KEY || null,
    },
    preferences: PREFERENCES.map(({ id, label }) => ({ id, label, votes: votes[id] || 0 })),
    itinerary,
    items,
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`PICKGO 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
