// 숙소 후보 링크 + 참석자 투표 (에어비앤비처럼 검색이 어려운 숙소도 링크로 후보 등록)
const linkPreview = require('./linkPreview');

function registerLodging(app, { db, auth, getRoomOr404, isMember, tripRoster }, options = {}) {
  const fetchPreview = options.fetchPreview || linkPreview.fetchLinkPreview;
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const handle = handler => (req, res) => {
    try { res.json(handler(req)); }
    catch (error) {
      if (!error.status) throw error;
      res.status(error.status).json({ error: error.message });
    }
  };
  function context(req) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room || room.deleted_at) throw fail('방을 찾을 수 없습니다.', 404);
    if (!isMember(room.id, req.user.id)) throw fail('방 멤버가 아닙니다.', 403);
    if (!room.active_trip_id) throw fail('진행 중인 여행이 없습니다.', 409);
    const roster = tripRoster(room) || [];
    return { room, isHost: room.host_user_id === req.user.id, isParticipant: roster.includes(req.user.id) };
  }
  const candidateOr404 = (room, id) => {
    const candidate = db.prepare('SELECT * FROM lodging_candidates WHERE id = ? AND trip_id = ? AND deleted = 0').get(Number(id), room.active_trip_id);
    if (!candidate) throw fail('숙소 후보를 찾을 수 없습니다.', 404);
    return candidate;
  };
  const count = (value, max) => {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > max) throw fail(`숫자는 0~${max} 사이로 입력해주세요.`);
    return Math.round(number * 2) / 2; // 욕실 1.5개 같은 값 허용
  };
  const cleanImage = value => {
    const text = String(value || '').trim();
    return text.startsWith('https://') && text.length <= 1000 ? text : null;
  };
  function cleanUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { throw fail('숙소 링크를 http(s) 주소로 입력해주세요.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.href.length > 500) throw fail('숙소 링크를 500자 이내 http(s) 주소로 입력해주세요.');
    return url.href;
  }

  app.get('/api/rooms/:id/lodging', auth, handle(req => {
    const { room, isHost, isParticipant } = context(req);
    const votes = db.prepare(`SELECT v.candidate_id, v.user_id, u.nickname FROM lodging_votes v JOIN users u ON u.id = v.user_id
      WHERE v.trip_id = ? ORDER BY u.nickname`).all(room.active_trip_id);
    const candidates = db.prepare(`SELECT c.*, u.nickname AS creator FROM lodging_candidates c JOIN users u ON u.id = c.created_by
      WHERE c.trip_id = ? AND c.deleted = 0 ORDER BY c.id`).all(room.active_trip_id).map(candidate => ({
      id: candidate.id, name: candidate.name, url: candidate.url, memo: candidate.memo, creator: candidate.creator,
      imageUrl: candidate.image_url, bedrooms: candidate.bedrooms, beds: candidate.beds, bathrooms: candidate.bathrooms, capacity: candidate.capacity,
      voterIds: votes.filter(vote => vote.candidate_id === candidate.id).map(vote => vote.user_id),
      voters: votes.filter(vote => vote.candidate_id === candidate.id).map(vote => vote.nickname),
      canDelete: isHost || candidate.created_by === req.user.id,
      selected: Boolean(room.accommodation_url) && room.accommodation_url === candidate.url,
    }));
    return { candidates, myVote: votes.find(vote => vote.user_id === req.user.id)?.candidate_id || null, canEdit: isHost || isParticipant, isHost,
      voterCount: new Set(votes.map(vote => vote.user_id)).size, participantCount: (tripRoster(room) || []).length };
  }));

  // 링크를 붙여넣으면 대표사진·제목·방 정보를 미리 읽어 등록 폼을 채움
  app.post('/api/rooms/:id/lodging/preview', auth, async (req, res) => {
    let url;
    try {
      const { isHost, isParticipant } = context(req);
      if (!isHost && !isParticipant) throw fail('이번 여행 참석자만 숙소 후보를 올릴 수 있어요.', 403);
      url = cleanUrl(req.body?.url);
    } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
    try { res.json({ url, ...(await fetchPreview(url)) }); }
    catch { res.json({ url, title: '', image: null, suggestedName: '', features: {}, notice: '이 링크에서 사진과 정보를 읽지 못했어요. 직접 입력해주세요.' }); }
  });

  app.post('/api/rooms/:id/lodging', auth, handle(req => {
    const { room, isHost, isParticipant } = context(req);
    if (!isHost && !isParticipant) throw fail('이번 여행 참석자만 숙소 후보를 올릴 수 있어요.', 403);
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 60) throw fail('숙소 이름을 1~60자로 입력해주세요.');
    const memo = String(req.body?.memo || '').trim().slice(0, 100);
    const url = cleanUrl(req.body?.url);
    const features = [count(req.body?.bedrooms, 30), count(req.body?.beds, 50), count(req.body?.bathrooms, 30), count(req.body?.capacity, 60)];
    if (db.prepare('SELECT count(*) AS n FROM lodging_candidates WHERE trip_id = ? AND deleted = 0').get(room.active_trip_id).n >= 20) throw fail('숙소 후보는 20개까지 올릴 수 있어요.');
    const id = db.prepare('INSERT INTO lodging_candidates(room_id,trip_id,name,url,memo,created_by,image_url,bedrooms,beds,bathrooms,capacity) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(room.id, room.active_trip_id, name, url, memo, req.user.id, cleanImage(req.body?.imageUrl), ...features).lastInsertRowid;
    return { ok: true, id };
  }));

  // 한 사람당 한 표. 같은 후보를 다시 누르면 투표 취소
  app.post('/api/rooms/:id/lodging/:candidateId/vote', auth, handle(req => {
    const { room, isParticipant } = context(req);
    if (!isParticipant) throw fail('이번 여행 참석자만 투표할 수 있어요.', 403);
    const candidate = candidateOr404(room, req.params.candidateId);
    const current = db.prepare('SELECT candidate_id FROM lodging_votes WHERE trip_id = ? AND user_id = ?').get(room.active_trip_id, req.user.id);
    if (current?.candidate_id === candidate.id) {
      db.prepare('DELETE FROM lodging_votes WHERE trip_id = ? AND user_id = ?').run(room.active_trip_id, req.user.id);
      return { ok: true, myVote: null };
    }
    db.prepare(`INSERT INTO lodging_votes(trip_id,user_id,candidate_id) VALUES (?,?,?)
      ON CONFLICT(trip_id,user_id) DO UPDATE SET candidate_id = excluded.candidate_id`).run(room.active_trip_id, req.user.id, candidate.id);
    return { ok: true, myVote: candidate.id };
  }));

  app.post('/api/rooms/:id/lodging/:candidateId/delete', auth, handle(req => {
    const { room, isHost } = context(req);
    const candidate = candidateOr404(room, req.params.candidateId);
    if (!isHost && candidate.created_by !== req.user.id) throw fail('올린 사람이나 방장만 삭제할 수 있어요.', 403);
    db.transaction(() => {
      db.prepare('UPDATE lodging_candidates SET deleted = 1 WHERE id = ?').run(candidate.id);
      db.prepare('DELETE FROM lodging_votes WHERE candidate_id = ?').run(candidate.id);
      if (room.accommodation_url === candidate.url) {
        db.prepare('UPDATE rooms SET accommodation_name = NULL, accommodation_address = NULL, accommodation_url = NULL, accommodation_map_x = NULL, accommodation_map_y = NULL WHERE id = ?').run(room.id);
      }
    })();
    return { ok: true };
  }));

  // 투표 결과를 보고 방장이 숙소로 확정 (링크만 있는 숙소라 좌표는 없음 → 코스는 여행지 중심으로 구성)
  app.post('/api/rooms/:id/lodging/:candidateId/select', auth, handle(req => {
    const { room, isHost } = context(req);
    if (!isHost) throw fail('방장만 숙소를 확정할 수 있어요.', 403);
    const candidate = candidateOr404(room, req.params.candidateId);
    db.prepare('UPDATE rooms SET accommodation_name = ?, accommodation_address = NULL, accommodation_url = ?, accommodation_map_x = NULL, accommodation_map_y = NULL WHERE id = ?')
      .run(candidate.name, candidate.url, room.id);
    return { ok: true };
  }));
}

module.exports = { registerLodging };
