const { calculateFinance } = require('./finance');
const koreanMonth = (date = new Date()) => new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 7);
function planSnapshot(room) {
  return Object.fromEntries(['selected_date', 'trip_nights', 'traveler_count', 'transport_mode', 'vehicle_count',
    'accommodation_name', 'accommodation_address', 'accommodation_map_x', 'accommodation_map_y',
    'selected_region_id', 'selected_dresscode', 'status'].map(key => [key, room[key]]));
}
function registerClubLedger(db, { route, access, activeMember, members, fail }) {
  const records = (table, roomId, all = false) => db.prepare(`SELECT * FROM ${table} WHERE room_id = ? ${all ? '' : 'AND voided = 0'} ORDER BY id DESC`).all(roomId);
  const amount = (value, zero = false) => {
    if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > 100000000) fail('금액은 1억원 이하 원 단위 정수로 입력해주세요.');
    return value;
  };
  const validMonth = value => typeof value === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
  const validDate = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const tripById = (roomId, id) => {
    if (!Number.isSafeInteger(id) || id < 1) fail('여행을 선택해주세요.');
    const trip = db.prepare('SELECT * FROM journeys WHERE room_id = ? AND id = ?').get(roomId, id);
    if (!trip) fail('이 방의 여행을 선택해주세요.', 404);
    return trip;
  };
  const participants = (roomId, ids) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 30 || new Set(ids).size !== ids.length) fail('여행 참석자는 중복 없이 1~30명으로 선택해주세요.');
    ids.forEach(id => activeMember(roomId, id));
  };
  function accrue(room) {
    if (!room.monthly_start || !room.monthly_amount) return;
    const insert = db.prepare('INSERT OR IGNORE INTO monthly_dues(room_id,user_id,month,amount) VALUES (?,?,?,?)');
    for (let month = room.monthly_start; month <= koreanMonth();) {
      for (const member of members(room.id).filter(member => member.active && koreanMonth(new Date(member.joined_at.replace(' ', 'T') + 'Z')) <= month)) insert.run(room.id, member.id, month, room.monthly_amount);
      const [year, index] = month.split('-').map(Number);
      month = `${year + (index === 12 ? 1 : 0)}-${String(index === 12 ? 1 : index + 1).padStart(2, '0')}`;
    }
  }
  function summary(room) {
    accrue(room);
    const payments = records('trip_payments', room.id), expenses = records('trip_expenses', room.id), refunds = records('trip_refunds', room.id);
    const result = calculateFinance(members(room.id), 0, payments, expenses, refunds);
    const dues = db.prepare('SELECT * FROM monthly_dues WHERE room_id = ? ORDER BY month DESC,user_id').all(room.id).map(due => {
      const paid = payments.filter(payment => payment.user_id === due.user_id && payment.billing_month === due.month).reduce((sum, payment) => sum + payment.amount, 0);
      return { ...due, paid, unpaid: Math.max(0, due.amount - paid) };
    });
    result.people.forEach(person => {
      person.monthlyUnpaid = dues.filter(due => due.user_id === person.id).reduce((sum, due) => sum + due.unpaid, 0);
      person.additionalDue = Math.max(0, -person.balance);
      person.unpaid = Math.max(person.monthlyUnpaid, person.additionalDue);
      person.carryover = Math.max(0, person.balance);
    });
    const requests = db.prepare('SELECT * FROM payment_requests WHERE room_id = ? ORDER BY id DESC').all(room.id).map(request => ({
      ...request, remaining: request.superseded ? 0 : Math.min(request.amount, result.people.find(person => person.id === request.user_id)?.additionalDue || 0),
    }));
    const trips = db.prepare('SELECT * FROM journeys WHERE room_id = ? ORDER BY id DESC').all(room.id).map(trip => ({
      ...trip, participantIds: JSON.parse(trip.participant_ids),
      plan: trip.id === room.active_trip_id ? planSnapshot(room) : JSON.parse(trip.plan_json),
      settlement: trip.settlement_json ? JSON.parse(trip.settlement_json) : null,
      spent: expenses.filter(expense => expense.trip_id === trip.id).reduce((sum, expense) => sum + expense.amount, 0),
    }));
    return { ...result, payments, expenses, refunds, dues, requests, trips, monthlyAmount: room.monthly_amount,
      monthlyStart: room.monthly_start, currentMonth: koreanMonth(), treasurerUserId: room.treasurer_user_id,
      membershipLocked: Boolean(room.membership_locked), activeTripId: room.active_trip_id,
      history: { payments: records('trip_payments', room.id, true), expenses: records('trip_expenses', room.id, true), refunds: records('trip_refunds', room.id, true) } };
  }
  function requestDeficits(room, tripId, reason) {
    const current = summary(room);
    db.prepare('UPDATE payment_requests SET superseded = 1 WHERE room_id = ?').run(room.id);
    const insert = db.prepare('INSERT INTO payment_requests(room_id,trip_id,user_id,amount,reason) VALUES (?,?,?,?,?)');
    for (const person of current.people.filter(person => person.additionalDue > 0)) insert.run(room.id, tripId, person.id, person.additionalDue, reason);
  }
  route('get', 'finance', req => {
    const { room, canManage } = access(req);
    const nudges = db.prepare(`SELECT n.*, a.nickname AS sender_name, b.nickname AS target_name FROM dues_nudges n
      JOIN users a ON a.id = n.created_by JOIN users b ON b.id = n.user_id WHERE room_id = ? ORDER BY n.id DESC LIMIT 50`).all(room.id);
    return { ...summary(room), canManage, nudges };
  });
  route('post', 'finance/dues', req => {
    const { room } = access(req, 'treasurer');
    const month = req.body.startMonth || koreanMonth();
    if (!validMonth(month) || month < koreanMonth()) fail('월 회비는 이번 달 또는 이후부터 설정해주세요.');
    accrue(room);
    db.prepare('UPDATE rooms SET monthly_amount = ?, monthly_start = ?, dues_amount = ? WHERE id = ?').run(amount(req.body.amount, true), month, req.body.amount, room.id);
    return { ok: true, message: '이미 생성된 월별 청구는 보존하고 아직 생성되지 않은 월부터 적용합니다.' };
  });
  route('post', 'finance/payments', req => {
    const { room } = access(req, 'treasurer');
    const person = members(room.id).find(person => person.id === req.body.userId);
    if (!person) fail('이 방의 납부자를 선택해주세요.');
    const month = req.body.month || null;
    if (month && !validMonth(month)) fail('납부 대상 월을 확인해주세요.');
    if (req.body.note !== undefined && (typeof req.body.note !== 'string' || req.body.note.length > 100)) fail('메모는 100자 이내로 적어주세요.');
    db.prepare('INSERT INTO trip_payments(room_id,user_id,amount,created_by,billing_month,note) VALUES (?,?,?,?,?,?)')
      .run(room.id, person.id, amount(req.body.amount), req.user.id, month, req.body.note || (month ? '월 회비' : '추가 납부 / 기존 적립금'));
    return { ok: true };
  });
  route('post', 'trips', req => {
    const { room } = access(req, 'planner');
    if (room.active_trip_id) fail('진행 중인 여행을 먼저 종료해주세요.');
    const { title, participantIds, date, nights = 1 } = req.body;
    if (typeof title !== 'string' || !title.trim() || title.length > 60) fail('여행 이름을 1~60자로 입력해주세요.');
    participants(room.id, participantIds);
    if (!validDate(date) || !Number.isInteger(nights) || nights < 0 || nights > 7) fail('여행 날짜와 기간을 확인해주세요.');
    const plan = { ...planSnapshot(room), selected_date: date, trip_nights: nights, traveler_count: participantIds.length,
      selected_region_id: null, selected_dresscode: null, status: 'planning', accommodation_name: null,
      accommodation_address: null, accommodation_map_x: null, accommodation_map_y: null };
    const trip = db.prepare('INSERT INTO journeys(room_id,title,participant_ids,plan_json,created_by) VALUES (?,?,?,?,?)')
      .run(room.id, title.trim(), JSON.stringify(participantIds), JSON.stringify(plan), req.user.id);
    db.prepare(`UPDATE rooms SET active_trip_id = ?, selected_date = ?, trip_nights = ?, traveler_count = ?, status = 'planning',
      selected_region_id = NULL, selected_dresscode = NULL, accommodation_name = NULL, accommodation_address = NULL,
      accommodation_map_x = NULL, accommodation_map_y = NULL WHERE id = ?`).run(trip.lastInsertRowid, date, nights, participantIds.length, room.id);
    return { ok: true, tripId: trip.lastInsertRowid };
  });
  route('post', 'trips/:tripId/participants', req => {
    const { room } = access(req, 'planner');
    const trip = tripById(room.id, Number(req.params.tripId));
    if (trip.status !== 'planning' || records('trip_expenses', room.id).some(expense => expense.trip_id === trip.id)) fail('지출이 기록된 여행의 참석자는 변경할 수 없습니다.');
    participants(room.id, req.body.participantIds);
    db.prepare('UPDATE journeys SET participant_ids = ? WHERE id = ?').run(JSON.stringify(req.body.participantIds), trip.id);
    db.prepare('UPDATE rooms SET traveler_count = ? WHERE id = ?').run(req.body.participantIds.length, room.id);
    return { ok: true };
  });
  route('post', 'trips/:tripId/title', req => {
    const { room } = access(req, 'planner');
    const trip = tripById(room.id, Number(req.params.tripId));
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    if (!title || title.length > 60) fail('여행 이름을 1~60자로 입력해주세요.');
    db.prepare('UPDATE journeys SET title = ? WHERE id = ?').run(title, trip.id);
    return { ok: true };
  });
  route('post', 'trips/:tripId/finish', req => {
    const { room } = access(req, 'treasurer');
    const trip = tripById(room.id, Number(req.params.tripId));
    if (trip.status === 'completed') return { ok: true, settlement: JSON.parse(trip.settlement_json) };
    const current = summary(room), ids = JSON.parse(trip.participant_ids);
    const costs = calculateFinance(members(room.id), 0, [], current.expenses.filter(expense => expense.trip_id === trip.id));
    const settlement = { spent: costs.spent, completedAt: new Date().toISOString(),
      people: current.people.filter(person => ids.includes(person.id)).map(person => ({ ...person,
        tripShare: costs.people.find(item => item.id === person.id).share,
        tripAdvanced: costs.people.find(item => item.id === person.id).advanced,
      })) };
    db.prepare("UPDATE journeys SET status = 'completed', plan_json = ?, settlement_json = ?, completed_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(planSnapshot(room)), JSON.stringify(settlement), trip.id);
    db.prepare('UPDATE rooms SET active_trip_id = NULL WHERE id = ?').run(room.id);
    requestDeficits(room, trip.id, `${trip.title} 여행 정산 추가 납부`);
    return { ok: true, settlement };
  });
  route('post', 'finance/expenses', req => {
    const { room } = access(req, 'treasurer');
    const trip = tripById(room.id, req.body.tripId);
    const { title, payerUserId, participantIds, date } = req.body;
    if (typeof title !== 'string' || !title.trim() || title.length > 80) fail('지출 내용을 1~80자로 입력해주세요.');
    amount(req.body.amount);
    const roster = JSON.parse(trip.participant_ids);
    if (!Array.isArray(participantIds) || !participantIds.length || new Set(participantIds).size !== participantIds.length
      || participantIds.some(id => !roster.includes(id))) fail('이 여행 참석자 중 비용을 부담할 사람을 선택해주세요.');
    if (payerUserId !== null && !roster.includes(payerUserId)) fail('여행 참석자 중 선결제자를 선택해주세요.');
    if (!validDate(date)) fail('지출 날짜를 확인해주세요.');
    if (payerUserId === null && summary(room).poolBalance < req.body.amount) fail('공동금고 잔액이 부족합니다. 개인 선결제로 입력한 뒤 추가 납부를 요청해주세요.');
    db.prepare('INSERT INTO trip_expenses(room_id,title,amount,payer_user_id,participant_ids,expense_date,created_by,trip_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(room.id, title.trim(), req.body.amount, payerUserId, JSON.stringify(participantIds), date, req.user.id, trip.id);
    // Keep the original closing snapshot; append late expenses to the live ledger.
    if (trip.status === 'completed') requestDeficits(room, trip.id, `${trip.title} 종료 후 추가 지출 정산`);
    return { ok: true };
  });
  route('post', 'finance/request-extra', req => {
    const { room } = access(req, 'treasurer');
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason || reason.length > 100) fail('추가 납부 사유를 1~100자로 입력해주세요.');
    if (!summary(room).additionalTotal) fail('현재 추가 납부가 필요한 멤버가 없습니다.');
    requestDeficits(room, room.active_trip_id, reason);
    return { ok: true };
  });
  route('post', 'finance/refunds', req => {
    const { room } = access(req, 'treasurer');
    const value = amount(req.body.amount), current = summary(room);
    const person = current.people.find(person => person.id === req.body.userId);
    if (!person || person.balance < value || current.poolBalance < value) fail('개인 잔액과 공동금고 잔액 이내로 반환해주세요.');
    db.prepare('INSERT INTO trip_refunds(room_id,user_id,amount,created_by) VALUES (?,?,?,?)').run(room.id, person.id, value, req.user.id);
    return { ok: true };
  });
  for (const [kind, table] of [['payments', 'trip_payments'], ['expenses', 'trip_expenses'], ['refunds', 'trip_refunds']]) {
    route('post', `finance/${kind}/:recordId/void`, req => {
      const { room } = access(req, 'treasurer');
      const record = db.prepare(`SELECT * FROM ${table} WHERE room_id = ? AND id = ? AND voided = 0`).get(room.id, req.params.recordId);
      if (!record) fail('기록을 찾을 수 없습니다.', 404);
      if (record.trip_id && tripById(room.id, record.trip_id).status === 'completed') fail('종료된 여행의 기록은 변경할 수 없습니다.');
      if (kind === 'payments' && summary(room).poolBalance < record.amount) fail('이미 사용된 금액은 취소할 수 없습니다.');
      db.prepare(`UPDATE ${table} SET voided = 1 WHERE id = ?`).run(record.id);
      return { ok: true };
    });
  }
  route('post', 'finance/nudges', req => {
    const { room } = access(req, 'treasurer');
    const person = activeMember(room.id, req.body.userId);
    if (!summary(room).people.find(item => item.id === person.id).unpaid) fail('미납액이 없습니다.');
    if (db.prepare("SELECT 1 FROM dues_nudges WHERE room_id = ? AND user_id = ? AND created_at > datetime('now','-1 day')").get(room.id, person.id)) fail('이 친구에게는 오늘 이미 알렸어요.', 429);
    db.prepare('INSERT INTO dues_nudges(room_id,user_id,created_by,message) VALUES (?,?,?,?)').run(room.id, person.id, req.user.id, '지갑아 일어나, 다음 여행 적금 넣어야지 💸');
    return { ok: true };
  });
}
module.exports = { registerClubLedger, koreanMonth, planSnapshot };
