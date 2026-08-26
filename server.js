const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { customAlphabet } = require('nanoid');

const db = require('./db');
const regions = require('./data/regions');

const JWT_SECRET = process.env.PICKGO_JWT_SECRET || 'pickgo-dev-secret-change-me';
const PORT = process.env.PORT || 3000;
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6); // 헷갈리는 글자 제외

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
    SELECT u.id, u.nickname, m.availability_json, m.dresscode
    FROM room_members m JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ?
  `).all(room.id).map(m => ({
    id: m.id,
    nickname: m.nickname,
    availability: JSON.parse(m.availability_json || '[]'),
    dresscode: m.dresscode || null
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
      selectedRegion,
      selectedDresscode: room.selected_dresscode
    },
    members,
    tally,
    bestDates,
    bestCount,
    isHost: room.host_user_id === req.user.id
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

app.post('/api/rooms/:id/select-date', auth, (req, res) => {
  const room = getRoomOr404(req, res);
  if (!room) return;
  if (room.host_user_id !== req.user.id) return res.status(403).json({ error: '방장만 날짜를 확정할 수 있습니다.' });
  const { date } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '올바른 날짜가 아닙니다.' });
  db.prepare('UPDATE rooms SET selected_date = ? WHERE id = ?').run(date, room.id);
  res.json({ ok: true });
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`PICKGO 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
