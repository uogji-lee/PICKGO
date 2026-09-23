const { registerClubLedger } = require('./clubLedger');
const ROLE_LABELS = { member: '멤버', treasurer: '총무', guide: '길잡이', photographer: '사진사' };

function registerRoomManagement(app, db, auth) {
  const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
  const members = roomId => db.prepare(`SELECT m.*, u.nickname, u.id FROM room_members m
    JOIN users u ON u.id = m.user_id WHERE m.room_id = ? ORDER BY u.id`).all(roomId);
  function access(req, permission = 'member') {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room || room.deleted_at) fail('방을 찾을 수 없습니다.', 404);
    const member = members(room.id).find(person => person.id === req.user.id && person.active);
    if (!member) fail('방 멤버가 아닙니다.', 403);
    const isHost = room.host_user_id === req.user.id;
    const canManage = (room.treasurer_user_id || room.host_user_id) === req.user.id;
    if (permission === 'host' && !isHost) fail('방장만 멤버를 관리할 수 있습니다.', 403);
    if (permission === 'treasurer' && !canManage) fail('총무만 회비·지출을 수정할 수 있습니다. 총무 미지정 시 방장이 대신 관리합니다.', 403);
    if (permission === 'planner' && !isHost && !canManage) fail('방장 또는 총무만 여행을 만들 수 있습니다.', 403);
    return { room, member, isHost, canManage };
  }
  const activeMember = (roomId, id) => {
    const person = members(roomId).find(person => person.id === id && person.active);
    if (!person) fail('현재 참여 중인 멤버를 선택해주세요.');
    return person;
  };
  function route(method, suffix, handler) {
    app[method]('/api/rooms/:id/' + suffix, auth, (req, res) => {
      try { req.body ||= {}; res.json(db.transaction(() => handler(req))()); }
      catch (error) {
        if (!error.status) console.error('Room management failed:', error.message);
        res.status(error.status || 500).json({ error: error.status ? error.message : '처리하지 못했습니다. 다시 시도해주세요.' });
      }
    });
  }
  route('post', 'delete', req => {
    const { room } = access(req, 'host');
    if (req.body.title !== room.title) fail('삭제할 방 이름을 정확히 입력해주세요.');
    db.prepare("UPDATE rooms SET deleted_at = datetime('now') WHERE id = ?").run(room.id);
    return { ok: true };
  });
  route('post', 'restore', req => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room || room.host_user_id !== req.user.id) fail('방장만 복구할 수 있습니다.', 403);
    db.prepare('UPDATE rooms SET deleted_at = NULL WHERE id = ?').run(room.id);
    return { ok: true };
  });
  route('post', 'members/:userId/role', req => {
    const { room } = access(req, 'host');
    const userId = Number(req.params.userId);
    activeMember(room.id, userId);
    const role = req.body.role;
    if (role === 'host') {
      if (userId === room.host_user_id) fail('이미 방장입니다.');
      db.prepare('UPDATE rooms SET host_user_id = ? WHERE id = ?').run(userId, room.id);
    } else {
      if (!Object.hasOwn(ROLE_LABELS, role)) fail('지원하지 않는 역할입니다.');
      if (role === 'treasurer') {
        db.prepare("UPDATE room_members SET role = 'member' WHERE room_id = ? AND role = 'treasurer'").run(room.id);
        db.prepare('UPDATE rooms SET treasurer_user_id = ? WHERE id = ?').run(userId, room.id);
      } else if (userId === room.treasurer_user_id) {
        db.prepare('UPDATE rooms SET treasurer_user_id = NULL WHERE id = ?').run(room.id);
      }
      db.prepare('UPDATE room_members SET role = ? WHERE room_id = ? AND user_id = ?').run(role, room.id, userId);
    }
    return { ok: true };
  });
  route('post', 'membership', req => {
    const { room } = access(req, 'host');
    if (typeof req.body.locked !== 'boolean') fail('멤버 확정 여부를 선택해주세요.');
    db.prepare('UPDATE rooms SET membership_locked = ? WHERE id = ?').run(Number(req.body.locked), room.id);
    return { ok: true };
  });
  route('post', 'members/:userId/kick', req => {
    const { room } = access(req, 'host');
    const userId = Number(req.params.userId);
    activeMember(room.id, userId);
    if (userId === room.host_user_id) fail('방장은 자신을 추방할 수 없습니다.');
    db.prepare("UPDATE room_members SET active = 0, role = 'member' WHERE room_id = ? AND user_id = ?").run(room.id, userId);
    if (room.treasurer_user_id === userId) db.prepare('UPDATE rooms SET treasurer_user_id = NULL WHERE id = ?').run(room.id);
    return { ok: true };
  });
  registerClubLedger(db, { route, access, activeMember, members, fail });
  require('./packing').registerPacking(db, { route, access, fail });
}
module.exports = { registerRoomManagement };
