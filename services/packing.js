const defaults = {
  essential: ['숙소 예약 확인', '교통편·렌터카 예약 확인', '신분증 확인', '여행 일정 공유', '집 정리·문단속'],
  shared: ['구급함', '공용 충전기·멀티탭', '간식·물', '쓰레기봉투', '단체 사진 준비'],
  personal: ['신분증', '충전기', '보조배터리', '세면도구', '스킨케어', '개인 상비약', '옷·속옷·양말', '우산', '이어폰', '물병'],
};
function registerPacking(db, { route, access, fail }) {
  function scope(req, editing = false) {
    const { room, isHost, canManage } = access(req);
    const tripId = Number(req.params.tripId);
    const trip = db.prepare('SELECT * FROM journeys WHERE room_id=? AND id=?').get(room.id, tripId);
    if (!trip) fail('여행을 찾을 수 없습니다.', 404);
    const ids = JSON.parse(trip.participant_ids);
    const participant = ids.includes(req.user.id);
    if (editing && (trip.status !== 'planning' || (!participant && !isHost && !canManage))) fail('진행 중인 여행 참석자와 관리자만 준비물을 변경할 수 있습니다.', 403);
    return { room, trip, ids, canManage: isHost || canManage, participant };
  }
  function visible(item, userId) { return item.category !== 'personal' || item.owner_id === userId; }
  route('get', 'trips/:tripId/packing', req => {
    const context = scope(req);
    const rows = db.prepare('SELECT * FROM packing_items WHERE trip_id=? AND deleted=0 ORDER BY id').all(context.trip.id);
    return { items: rows.filter(item => visible(item, req.user.id)).map(item => ({ ...item, canDelete: context.canManage || item.created_by === req.user.id || item.owner_id === req.user.id })), tripTitle: context.trip.title,
      completed: context.trip.status === 'completed', canEdit: context.trip.status === 'planning' && (context.participant || context.canManage),
      participants: db.prepare('SELECT u.id,u.nickname FROM users u JOIN room_members m ON m.user_id=u.id WHERE m.room_id=?').all(context.room.id).filter(user => context.ids.includes(user.id)),
      initialized: Boolean(db.prepare('SELECT 1 FROM packing_seeds WHERE trip_id=? AND user_id=?').get(context.trip.id, context.participant ? req.user.id : 0)) };
  });
  route('post', 'trips/:tripId/packing/defaults', req => {
    const { trip, participant } = scope(req, true);
    const insert = db.prepare('INSERT INTO packing_items(trip_id,title,category,owner_id,created_by) VALUES (?,?,?,?,?)');
    if (!db.prepare('SELECT 1 FROM packing_seeds WHERE trip_id=? AND user_id=0').get(trip.id)) {
      for (const category of ['essential', 'shared']) for (const title of defaults[category]) insert.run(trip.id, title, category, null, req.user.id);
      db.prepare('INSERT INTO packing_seeds VALUES (?,0)').run(trip.id);
    }
    if (participant && !db.prepare('SELECT 1 FROM packing_seeds WHERE trip_id=? AND user_id=?').get(trip.id, req.user.id)) {
      for (const title of defaults.personal) insert.run(trip.id, title, 'personal', req.user.id, req.user.id);
      db.prepare('INSERT INTO packing_seeds VALUES (?,?)').run(trip.id, req.user.id);
    }
    return { ok: true };
  });
  route('post', 'trips/:tripId/packing', req => {
    const { trip, participant } = scope(req, true);
    const { title, category } = req.body;
    if (typeof title !== 'string' || !title.trim() || title.length > 100 || !Object.hasOwn(defaults, category)) fail('준비물 이름과 종류를 확인해주세요.');
    if (category === 'personal' && !participant) fail('내 짐은 여행 참석자만 등록할 수 있습니다.', 403);
    db.prepare('INSERT INTO packing_items(trip_id,title,category,owner_id,created_by) VALUES (?,?,?,?,?)')
      .run(trip.id, title.trim(), category, category === 'personal' ? req.user.id : null, req.user.id);
    return { ok: true };
  });
  route('post', 'trips/:tripId/packing/:itemId', req => {
    const { trip, ids, canManage } = scope(req, true);
    const item = db.prepare('SELECT * FROM packing_items WHERE id=? AND trip_id=? AND deleted=0').get(req.params.itemId, trip.id);
    if (!item || !visible(item, req.user.id)) fail('준비물을 찾을 수 없습니다.', 404);
    if (req.body.deleted !== undefined) {
      if (req.body.deleted !== true || (!canManage && item.created_by !== req.user.id && item.owner_id !== req.user.id)) fail('작성자 또는 관리자만 삭제할 수 있습니다.', 403);
      db.prepare('UPDATE packing_items SET deleted=1 WHERE id=?').run(item.id);
    } else if (req.body.checked !== undefined) {
      if (typeof req.body.checked !== 'boolean') fail('체크 상태를 확인해주세요.');
      db.prepare('UPDATE packing_items SET checked=?,checked_by=? WHERE id=?').run(Number(req.body.checked), req.user.id, item.id);
    } else if (Object.hasOwn(req.body, 'assigneeId')) {
      if (item.category === 'personal' || (req.body.assigneeId !== null && !ids.includes(req.body.assigneeId))) fail('이번 여행 참석자를 선택해주세요.');
      db.prepare('UPDATE packing_items SET assignee_id=? WHERE id=?').run(req.body.assigneeId, item.id);
    } else fail('변경할 항목이 없습니다.');
    return { ok: true };
  });
}
module.exports = { registerPacking };
