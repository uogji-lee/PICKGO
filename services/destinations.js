// 여행지 정하기: 🎲 완전 랜덤 / 🧭 가기 쉬운 곳(중간지점) / 📍 원하는 곳(검색 후보) + 투표 + 다시 뽑기 횟수 제한
const crypto = require('node:crypto');

const METHODS = { random: '🎲 완전 랜덤', easy: '🧭 가기 쉬운 곳', wish: '📍 원하는 곳' };
const DRAW_LIMITS = [0, 1, 2, 3, 5];

// 지역 표현: 내장 여행지는 id 그대로, 검색으로 고른 지역은 'k:시도 시군구'
function regionKey(region) { return region.builtin ? region.id : `k:${region.name}`; }

function createRegionTools({ regions, regionCoords, isKoreanCoordinate }) {
  const builtin = new Map(regions.map(region => [region.id, region]));
  const byName = new Map(regions.map(region => [region.name, region]));
  function fromBuiltin(region) {
    const [lat, lng] = regionCoords[region.id] || [];
    return { id: region.id, name: region.name, lat: lat ?? null, lng: lng ?? null, builtin: true };
  }
  // 클라이언트가 보낸 지역 정보를 검증해 표준 형태로 변환
  function normalize(input) {
    if (!input || typeof input !== 'object') return null;
    if (input.id && builtin.has(String(input.id))) return fromBuiltin(builtin.get(String(input.id)));
    const name = String(input.name || '').replace(/\s+/g, ' ').trim();
    if (byName.has(name)) return fromBuiltin(byName.get(name));
    const lat = Number(input.lat), lng = Number(input.lng);
    if (!name || name.length > 40 || !/^[가-힣0-9 ()·]+$/.test(name) || !isKoreanCoordinate(lat, lng)) return null;
    return { id: `k:${name}`, name, lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)), builtin: false };
  }
  // 저장된 여행지(rooms/plan)를 추천 코스에서 쓰는 형태로 복원
  function resolve(selectedId, selectedJson) {
    if (!selectedId) return null;
    if (builtin.has(selectedId)) return { ...builtin.get(selectedId), builtin: true };
    try {
      const region = JSON.parse(selectedJson || 'null');
      return region ? { ...region, attractions: [], activities: [], builtin: false } : null;
    } catch { return null; }
  }
  return { normalize, resolve, fromBuiltin, builtin };
}

// 카카오 로컬 키워드 검색 결과 주소("강원특별자치도 강릉시 …")에서 시·군·구 단위 지역을 뽑아냄
function regionsFromPlaces(documents) {
  const found = new Map();
  for (const doc of documents) {
    const tokens = String(doc.address_name || doc.road_address_name || '').split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].startsWith('세종') ? tokens[0] : tokens.slice(0, 2).join(' ');
    if (!name || name.length > 40) continue;
    const entry = found.get(name) || { name, lats: [], lngs: [], sample: doc.place_name };
    entry.lats.push(Number(doc.y));
    entry.lngs.push(Number(doc.x));
    found.set(name, entry);
  }
  return [...found.values()].map(entry => ({
    name: entry.name,
    lat: entry.lats.reduce((sum, value) => sum + value, 0) / entry.lats.length,
    lng: entry.lngs.reduce((sum, value) => sum + value, 0) / entry.lngs.length,
    sample: entry.sample,
  })).filter(entry => Number.isFinite(entry.lat) && Number.isFinite(entry.lng));
}

function registerDestinations(app, deps) {
  const { db, auth, isMember, tripRoster, regions, reachability, kakaoLocal, decideRegion, tools } = deps;
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const handle = handler => async (req, res) => {
    try { res.json(await handler(req)); }
    catch (error) {
      if (!error.status) { console.warn(`[destinations] ${error.message}`); return res.status(500).json({ error: '처리하지 못했어요. 잠시 후 다시 시도해주세요.' }); }
      res.status(error.status).json({ error: error.message });
    }
  };

  function context(req) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room || room.deleted_at) throw fail('방을 찾을 수 없습니다.', 404);
    if (!isMember(room.id, req.user.id)) throw fail('방 멤버가 아닙니다.', 403);
    if (!room.active_trip_id) throw fail('방에서 새 여행을 먼저 만들어주세요.', 409);
    const trip = db.prepare('SELECT * FROM journeys WHERE id = ?').get(room.active_trip_id);
    const roster = tripRoster(room) || [];
    return { room, trip, roster, isHost: room.host_user_id === req.user.id, isParticipant: roster.includes(req.user.id) };
  }
  const drawsLeft = trip => Math.max(0, 1 + trip.draw_limit - trip.draw_count);

  function travelers(room, roster) {
    return db.prepare(`SELECT u.id, u.nickname, m.origin_id, m.origin_mode, m.origin_lat, m.origin_lng, m.origin_undecided
      FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? AND m.active = 1`).all(room.id)
      .filter(member => roster.includes(member.id))
      .map(member => ({ userId: member.id, nickname: member.nickname, originId: member.origin_id, lat: member.origin_lat, lng: member.origin_lng, mode: member.origin_mode, undecided: Boolean(member.origin_undecided) }));
  }

  // 방식별 후보 목록: 가기 쉬운 곳은 중간지점 추천 TOP 5, 원하는 곳은 멤버가 올린 지역
  function candidatesOf({ room, trip, roster }) {
    if (trip.destination_method === 'easy') {
      const list = travelers(room, roster);
      // 출발지 미정인 참석자는 계산에서 빼고, 미입력 안내와 따로 보여줌
      const { midpoint, ranking } = reachability.recommendNearMidpoint(list.filter(traveler => !traveler.undecided), regions, 5);
      const ready = new Set(ranking[0]?.legs.map(leg => leg.userId) || []);
      return {
        midpoint,
        missingOrigins: list.filter(traveler => !traveler.undecided && !ready.has(traveler.userId)).map(traveler => traveler.nickname),
        undecidedOrigins: list.filter(traveler => traveler.undecided).map(traveler => traveler.nickname),
        items: ranking.map(item => ({
          region: tools.fromBuiltin(tools.builtin.get(item.region.id)),
          averageMinutes: item.averageMinutes, maxMinutes: item.maxMinutes, distanceFromMidpointKm: item.distanceFromMidpointKm, legs: item.legs,
        })),
      };
    }
    if (trip.destination_method === 'wish') {
      const rows = db.prepare(`SELECT c.*, u.nickname AS creator FROM destination_candidates c JOIN users u ON u.id = c.created_by
        WHERE c.trip_id = ? AND c.deleted = 0 ORDER BY c.id`).all(trip.id);
      return { items: rows.map(row => ({ region: JSON.parse(row.region_json), creator: row.creator, createdBy: row.created_by })) };
    }
    return { items: [] };
  }

  app.get('/api/rooms/:id/destination', auth, handle(req => {
    const ctx = context(req);
    const { room, trip, isHost, isParticipant } = ctx;
    const { items, midpoint = null, missingOrigins = [], undecidedOrigins = [] } = candidatesOf(ctx);
    const votes = db.prepare(`SELECT v.region_key, v.user_id, u.nickname FROM destination_votes v JOIN users u ON u.id = v.user_id
      WHERE v.trip_id = ? ORDER BY u.nickname`).all(trip.id);
    const selected = tools.resolve(room.selected_region_id, room.selected_region_json);
    return {
      method: trip.destination_method,
      methods: METHODS,
      drawLimit: trip.draw_limit,
      drawCount: trip.draw_count,
      drawsLeft: drawsLeft(trip),
      selected: selected ? { key: regionKey(selected), name: selected.name } : null,
      midpoint,
      missingOrigins,
      undecidedOrigins,
      candidates: items.map(item => {
        const key = regionKey(item.region);
        const voters = votes.filter(vote => vote.region_key === key);
        return { ...item, key, voters: voters.map(vote => vote.nickname), voterIds: voters.map(vote => vote.user_id),
          canDelete: trip.destination_method === 'wish' && (isHost || item.createdBy === req.user.id) };
      }),
      myVote: votes.find(vote => vote.user_id === req.user.id)?.region_key || null,
      isHost,
      canVote: isParticipant,
      searchProvider: kakaoLocal.isConfigured() ? 'kakao' : 'builtin',
    };
  }));

  app.post('/api/rooms/:id/destination/method', auth, handle(req => {
    const { trip, isHost } = context(req);
    if (!isHost) throw fail('방장만 여행지 정하는 방식을 바꿀 수 있어요.', 403);
    const method = String(req.body?.method || '');
    if (!METHODS[method]) throw fail('여행지 정하는 방식을 선택해주세요.');
    db.transaction(() => {
      db.prepare('UPDATE journeys SET destination_method = ? WHERE id = ?').run(method, trip.id);
      db.prepare('DELETE FROM destination_votes WHERE trip_id = ?').run(trip.id); // 후보가 바뀌므로 투표는 초기화
    })();
    return { ok: true, method };
  }));

  // 아무 지역이나 검색: 카카오 로컬 키가 있으면 전국, 없으면 내장 여행지·출발 생활권 안에서
  app.get('/api/regions/search', auth, handle(async req => {
    const query = String(req.query.q || '').trim();
    if (query.length < 1 || query.length > 30) throw fail('검색어를 1~30자로 입력해주세요.');
    const builtinMatches = regions.filter(region => region.name.includes(query)).map(tools.fromBuiltin);
    if (!kakaoLocal.isConfigured()) return { provider: 'builtin', regions: builtinMatches.slice(0, 10) };
    const documents = await kakaoLocal.searchKeyword({ query, size: 15 });
    const found = regionsFromPlaces(documents).map(entry => ({ ...tools.normalize(entry), sample: entry.sample })).filter(region => region.name);
    const seen = new Set();
    return {
      provider: 'kakao',
      regions: [...builtinMatches, ...found].filter(region => !seen.has(regionKey(region)) && seen.add(regionKey(region))).slice(0, 10),
    };
  }));

  app.post('/api/rooms/:id/destination/candidates', auth, handle(req => {
    const { trip, isHost, isParticipant } = context(req);
    if (trip.destination_method !== 'wish') throw fail('원하는 곳 방식에서만 후보를 올릴 수 있어요.', 409);
    if (!isHost && !isParticipant) throw fail('이번 여행 참석자만 후보를 올릴 수 있어요.', 403);
    const region = tools.normalize(req.body?.region);
    if (!region) throw fail('검색 결과에서 지역을 골라주세요.');
    const key = regionKey(region);
    if (db.prepare('SELECT 1 FROM destination_candidates WHERE trip_id = ? AND region_key = ? AND deleted = 0').get(trip.id, key)) throw fail('이미 올라온 지역이에요.', 409);
    if (db.prepare('SELECT count(*) AS n FROM destination_candidates WHERE trip_id = ? AND deleted = 0').get(trip.id).n >= 20) throw fail('후보는 20곳까지 올릴 수 있어요.');
    db.prepare('INSERT INTO destination_candidates(room_id,trip_id,region_key,region_json,created_by) VALUES (?,?,?,?,?)')
      .run(trip.room_id, trip.id, key, JSON.stringify(region), req.user.id);
    return { ok: true, key };
  }));

  app.post('/api/rooms/:id/destination/candidates/delete', auth, handle(req => {
    const { trip, isHost } = context(req);
    const row = db.prepare('SELECT * FROM destination_candidates WHERE trip_id = ? AND region_key = ? AND deleted = 0').get(trip.id, String(req.body?.key || ''));
    if (!row) throw fail('후보를 찾을 수 없어요.', 404);
    if (!isHost && row.created_by !== req.user.id) throw fail('올린 사람이나 방장만 삭제할 수 있어요.', 403);
    db.transaction(() => {
      db.prepare('UPDATE destination_candidates SET deleted = 1 WHERE id = ?').run(row.id);
      db.prepare('DELETE FROM destination_votes WHERE trip_id = ? AND region_key = ?').run(trip.id, row.region_key);
    })();
    return { ok: true };
  }));

  // 한 사람 한 표, 같은 후보를 다시 누르면 취소
  app.post('/api/rooms/:id/destination/vote', auth, handle(req => {
    const ctx = context(req);
    if (!ctx.isParticipant) throw fail('이번 여행 참석자만 투표할 수 있어요.', 403);
    const key = String(req.body?.key || '');
    if (!candidatesOf(ctx).items.some(item => regionKey(item.region) === key)) throw fail('후보 목록에 있는 지역에만 투표할 수 있어요.');
    const current = db.prepare('SELECT region_key FROM destination_votes WHERE trip_id = ? AND user_id = ?').get(ctx.trip.id, req.user.id);
    if (current?.region_key === key) {
      db.prepare('DELETE FROM destination_votes WHERE trip_id = ? AND user_id = ?').run(ctx.trip.id, req.user.id);
      return { ok: true, myVote: null };
    }
    db.prepare(`INSERT INTO destination_votes(trip_id,user_id,region_key) VALUES (?,?,?)
      ON CONFLICT(trip_id,user_id) DO UPDATE SET region_key = excluded.region_key`).run(ctx.trip.id, req.user.id, key);
    return { ok: true, myVote: key };
  }));

  // 방장이 후보 중 하나로 확정 (뽑기 횟수는 쓰지 않음)
  app.post('/api/rooms/:id/destination/confirm', auth, handle(req => {
    const ctx = context(req);
    if (!ctx.isHost) throw fail('방장만 여행지를 확정할 수 있어요.', 403);
    const item = candidatesOf(ctx).items.find(candidate => regionKey(candidate.region) === String(req.body?.key || ''));
    if (!item) throw fail('후보 목록에서 지역을 골라주세요.');
    return decideRegion(ctx.room, item.region);
  }));

  // 추첨: 완전 랜덤은 전국 인기 여행지에서, 그 외에는 후보 중에서. 다시 뽑기 횟수 제한
  app.post('/api/rooms/:id/destination/draw', auth, handle(req => {
    const ctx = context(req);
    if (!ctx.isHost) throw fail('방장만 추첨할 수 있어요.', 403);
    const pool = ctx.trip.destination_method === 'random'
      ? regions.map(tools.fromBuiltin)
      : candidatesOf(ctx).items.map(item => item.region);
    if (!pool.length) throw fail(ctx.trip.destination_method === 'easy' ? '출발지가 모이면 후보가 생겨요.' : '먼저 후보 지역을 올려주세요.', 409);
    const claimed = db.prepare('UPDATE journeys SET draw_count = draw_count + 1 WHERE id = ? AND draw_count < 1 + draw_limit').run(ctx.trip.id);
    if (!claimed.changes) throw fail(`뽑기를 모두 썼어요. (처음 1번 + 다시 뽑기 ${ctx.trip.draw_limit}번)`, 409);
    const region = pool[crypto.randomInt(pool.length)];
    const result = decideRegion(ctx.room, region);
    const trip = db.prepare('SELECT * FROM journeys WHERE id = ?').get(ctx.trip.id);
    return { ...result, pool: pool.map(item => item.name), drawsLeft: drawsLeft(trip) };
  }));
}

module.exports = { DRAW_LIMITS, METHODS, createRegionTools, regionKey, regionsFromPlaces, registerDestinations };
