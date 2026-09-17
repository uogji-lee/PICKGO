const { calculateFinance } = require('./finance');

const ROLE_LABELS = { member: '멤버', treasurer: '총무', guide: '길잡이', photographer: '사진사' };
const NUDGES = [
  '탑승권은 준비됐는데 회비가 아직 체크인 전입니다 ✈️',
  '총무의 새로고침 버튼이 닳고 있습니다. 회비 출발 부탁 🚀',
  '지갑아 일어나, 우리 여행 가야지 💸',
  '여행 참석 버튼은 눌렀는데 송금 버튼은 길을 잃었나요? 🧭',
];

function registerRoomManagement(app, db, auth) {
  const memberRows = roomId => db.prepare(`SELECT m.*, u.nickname, u.id FROM room_members m
    JOIN users u ON u.id = m.user_id WHERE m.room_id = ? ORDER BY u.id`).all(roomId);
  const records = (table, roomId) => db.prepare(`SELECT * FROM ${table} WHERE room_id = ? AND voided = 0 ORDER BY id DESC`).all(roomId);
  const summary = room => {
    const result = calculateFinance(memberRows(room.id), room.dues_amount,
      records('trip_payments', room.id), records('trip_expenses', room.id), records('trip_refunds', room.id));
    result.settling = room.finance_phase === 'settling';
    if (result.settling) result.people.forEach(person => { person.unpaid = Math.max(0, -person.balance); });
    return result;
  };
  const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
  function access(req, hostOnly = false, managerOnly = false) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room) fail('방을 찾을 수 없습니다.', 404);
    const member = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ? AND active = 1').get(room.id, req.user.id);
    if (!member) fail('방 멤버가 아닙니다.', 403);
    const isHost = room.host_user_id === req.user.id;
    if (hostOnly && !isHost) fail('방장만 멤버를 관리할 수 있습니다.', 403);
    if (managerOnly && !isHost && member.role !== 'treasurer') fail('방장과 총무만 회비·지출을 관리할 수 있습니다.', 403);
    return { room, member, isHost, canManage: isHost || member.role === 'treasurer' };
  }
  const activeMember = (roomId, userId) => {
    if (!Number.isSafeInteger(userId)) fail('멤버를 선택해주세요.');
    const member = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ? AND active = 1').get(roomId, userId);
    if (!member) fail('현재 참여 중인 멤버를 선택해주세요.');
    return member;
  };
  const money = (value, allowZero = false) => {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 100000000) fail('금액은 1억원 이하의 원 단위 정수로 입력해주세요.');
    return value;
  };
  // Transactions also serialize permissions, role transfers and cooldown checks.
  function route(method, suffix, handler) {
    app[method]('/api/rooms/:id/' + suffix, auth, (req, res) => {
      try { res.json(db.transaction(() => handler(req))()); }
      catch (error) {
        if (!error.status) console.error('Room management failed:', error.message);
        res.status(error.status || 500).json({ error: error.status ? error.message : '처리하지 못했습니다. 다시 시도해주세요.' });
      }
    });
  }

  route('post', 'members/:userId/role', req => {
    const { room } = access(req, true);
    const userId = Number(req.params.userId);
    activeMember(room.id, userId);
    const role = req.body.role;
    if (role === 'host') {
      if (userId === room.host_user_id) fail('이미 방장입니다.');
      db.prepare('UPDATE rooms SET host_user_id = ? WHERE id = ?').run(userId, room.id);
      db.prepare("UPDATE room_members SET role = 'member' WHERE room_id = ? AND user_id IN (?, ?)").run(room.id, userId, room.host_user_id);
    } else {
      if (!Object.hasOwn(ROLE_LABELS, role)) fail('지원하지 않는 역할입니다.');
      if (userId === room.host_user_id) fail('방장 역할은 다른 멤버에게 위임해 변경할 수 있습니다.');
      if (role === 'treasurer') db.prepare("UPDATE room_members SET role = 'member' WHERE room_id = ? AND role = 'treasurer'").run(room.id);
      db.prepare('UPDATE room_members SET role = ? WHERE room_id = ? AND user_id = ?').run(role, room.id, userId);
    }
    return { ok: true };
  });

  route('post', 'members/:userId/kick', req => {
    const { room } = access(req, true);
    const userId = Number(req.params.userId);
    activeMember(room.id, userId);
    if (userId === room.host_user_id) fail('방장은 자신을 추방할 수 없습니다.');
    db.prepare("UPDATE room_members SET active = 0, role = 'member' WHERE room_id = ? AND user_id = ?").run(room.id, userId);
    return { ok: true };
  });

  route('get', 'finance', req => {
    const { room, canManage } = access(req);
    const nudges = db.prepare(`SELECT n.*, sender.nickname AS sender_name, target.nickname AS target_name
      FROM dues_nudges n JOIN users sender ON sender.id = n.created_by JOIN users target ON target.id = n.user_id
      WHERE n.room_id = ? ORDER BY n.id DESC LIMIT 20`).all(room.id);
    return { ...summary(room), canManage, payments: records('trip_payments', room.id),
      expenses: records('trip_expenses', room.id), refunds: records('trip_refunds', room.id), nudges, roleLabels: ROLE_LABELS };
  });

  route('post', 'finance/dues', req => {
    const { room } = access(req, false, true);
    if (room.finance_phase === 'settling') fail('최종 정산 중입니다. 회비를 바꾸려면 회비 모으기로 돌아가주세요.');
    db.prepare('UPDATE rooms SET dues_amount = ? WHERE id = ?').run(money(req.body.amount, true), room.id);
    return { ok: true };
  });

  route('post', 'finance/phase', req => {
    const { room } = access(req, false, true);
    if (!['collecting', 'settling'].includes(req.body.phase)) fail('올바른 정산 단계를 선택해주세요.');
    db.prepare('UPDATE rooms SET finance_phase = ? WHERE id = ?').run(req.body.phase, room.id);
    return { ok: true };
  });

  route('post', 'finance/payments', req => {
    const { room } = access(req, false, true);
    if (!Number.isSafeInteger(req.body.userId) || !memberRows(room.id).some(person => person.id === req.body.userId)) fail('방의 정산 멤버를 선택해주세요.');
    db.prepare('INSERT INTO trip_payments (room_id, user_id, amount, created_by) VALUES (?, ?, ?, ?)')
      .run(room.id, req.body.userId, money(req.body.amount), req.user.id);
    return { ok: true };
  });

  route('post', 'finance/refunds', req => {
    const { room } = access(req, false, true);
    const amount = money(req.body.amount);
    const current = summary(room);
    const person = current.people.find(person => person.id === req.body.userId);
    if (!person || person.balance < amount) fail('돌려받을 금액 이내로 입력해주세요.');
    if (current.poolBalance < amount) fail('공동금고 잔액이 부족합니다. 추가 납부를 먼저 기록해주세요.');
    db.prepare('INSERT INTO trip_refunds (room_id, user_id, amount, created_by) VALUES (?, ?, ?, ?)')
      .run(room.id, person.id, amount, req.user.id);
    return { ok: true };
  });

  route('post', 'finance/expenses', req => {
    const { room } = access(req, false, true);
    const { title, amount, payerUserId, participantIds, date } = req.body;
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 80) fail('지출 내용을 1~80자로 입력해주세요.');
    money(amount);
    if (payerUserId !== null) activeMember(room.id, payerUserId);
    if (!Array.isArray(participantIds) || !participantIds.length || participantIds.length > 1000
      || new Set(participantIds).size !== participantIds.length) fail('함께 부담할 멤버를 한 명 이상 선택해주세요.');
    participantIds.forEach(id => activeMember(room.id, id));
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail('올바른 지출 날짜를 입력해주세요.');
    if (payerUserId === null && summary(room).poolBalance < amount) fail('공동금고 잔액이 부족합니다. 실제 납부를 기록하거나 개인 선결제로 등록해주세요.');
    db.prepare(`INSERT INTO trip_expenses (room_id, title, amount, payer_user_id, participant_ids, expense_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(room.id, title.trim(), amount, payerUserId, JSON.stringify(participantIds), date, req.user.id);
    return { ok: true };
  });

  for (const [kind, table] of [['payments', 'trip_payments'], ['expenses', 'trip_expenses'], ['refunds', 'trip_refunds']]) {
    route('post', `finance/${kind}/:recordId/void`, req => {
      const { room } = access(req, false, true);
      const record = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND room_id = ? AND voided = 0`).get(req.params.recordId, room.id);
      if (!record) fail('취소할 기록을 찾을 수 없습니다.', 404);
      if (kind === 'payments' && summary(room).poolBalance < record.amount) fail('이미 사용된 회비입니다. 관련 공동금고 지출을 먼저 취소해주세요.');
      db.prepare(`UPDATE ${table} SET voided = 1 WHERE id = ?`).run(record.id);
      return { ok: true };
    });
  }

  route('post', 'finance/nudges', req => {
    const { room } = access(req, false, true);
    const userId = req.body.userId;
    activeMember(room.id, userId);
    if (!summary(room).people.find(person => person.id === userId)?.unpaid) fail('미납 회비가 없는 멤버입니다.');
    const recent = db.prepare("SELECT 1 FROM dues_nudges WHERE room_id = ? AND user_id = ? AND created_at > datetime('now', '-1 day')").get(room.id, userId);
    if (recent) fail('이 친구에게는 이미 알렸어요. 납부 알림은 하루 한 번만 보낼 수 있어요.', 429);
    db.prepare('INSERT INTO dues_nudges (room_id, user_id, created_by, message) VALUES (?, ?, ?, ?)')
      .run(room.id, userId, req.user.id, NUDGES[Math.floor(Math.random() * NUDGES.length)]);
    return { ok: true };
  });
}

module.exports = { registerRoomManagement };
