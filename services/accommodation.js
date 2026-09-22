const jwt = require('jsonwebtoken');
const { normalizeCoordinate, stripHtml } = require('./naverLocal');
function registerAccommodation(app, { auth, getRoomOr404, naverLocal, secret }) {
  app.get('/api/rooms/:id/accommodation-search', auth, async (req, res) => {
    const room = getRoomOr404(req, res);
    if (!room) return;
    if (room.host_user_id !== req.user.id) return res.status(403).json({error:'방장만 숙소를 설정할 수 있습니다.'});
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2 || query.length > 120) return res.status(400).json({error:'숙소명 또는 주소를 2~120자로 입력해주세요.'});
    try {
      const items = await naverLocal.searchLocal(query, {sort:'random'});
      const places = items.map(item => ({name:stripHtml(item.title),address:item.roadAddress || item.address || '',mapX:normalizeCoordinate(item.mapx,180),mapY:normalizeCoordinate(item.mapy,90)}))
        .filter(item => item.mapX && item.mapY && Number(item.mapX)>0 && Number(item.mapX)<=180 && Number(item.mapY)>0 && Number(item.mapY)<=90)
        .map(place => ({...place,proof:jwt.sign({place,roomId:room.id,tripId:room.active_trip_id,owner:req.user.id},secret,{audience:'accommodation',expiresIn:'30m'})}));
      res.json({places,notice:places.length ? '네이버 지역 검색 결과입니다. 주소를 확인하고 실제 숙소를 선택해주세요.' : '네이버에 등록된 장소를 찾지 못했습니다. 지역과 숙소명을 함께 입력해주세요. 일반 주소의 좌표 변환은 별도 Maps Geocoding 권한이 필요합니다.'});
    } catch { res.status(502).json({error:'네이버 숙소 검색에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'}); }
  });
}
function verifyAccommodation(proof, room, userId, secret) {
  const data = jwt.verify(proof,secret,{algorithms:['HS256'],audience:'accommodation'});
  if (data.roomId !== room.id || data.tripId !== room.active_trip_id || data.owner !== userId) throw new Error('invalid accommodation');
  return data.place;
}
module.exports = {registerAccommodation,verifyAccommodation};
