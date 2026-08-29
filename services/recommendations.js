const PREFERENCES = Object.freeze([
  { id: 'nature', label: '자연·힐링', contentTypes: [], keywords: ['공원', '숲', '산', '해변', '해수욕장', '수목원', '정원', '생태', '휴양', '폭포', '계곡', '호수', '섬'] },
  { id: 'culture', label: '문화·역사', contentTypes: ['14'], keywords: ['궁', '성', '사찰', '박물관', '미술관', '문화', '역사', '유적', '한옥'] },
  { id: 'activity', label: '액티비티', contentTypes: ['25', '28'], keywords: ['체험', '레포츠', '서핑', '카약', '자전거', '트레킹', '케이블카'] },
  { id: 'food', label: '맛집', contentTypes: ['39'], keywords: ['음식', '식당', '시장', '카페', '빵', '회', '한정식'] },
  { id: 'shopping', label: '쇼핑', contentTypes: ['38'], keywords: ['시장', '상점', '쇼핑', '공방', '특산물'] },
  { id: 'festival', label: '축제·공연', contentTypes: ['15'], keywords: ['축제', '공연', '행사', '페스티벌'] },
]);

const CONTENT_TYPE_LABELS = Object.freeze({
  12: '관광지',
  14: '문화시설',
  15: '축제·공연',
  25: '여행코스',
  28: '레포츠',
  32: '숙박',
  38: '쇼핑',
  39: '음식점',
});

const preferenceById = new Map(PREFERENCES.map(preference => [preference.id, preference]));

function normalizePreferenceIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(id => preferenceById.has(id)))].slice(0, 3);
}

function aggregatePreferences(memberPreferences) {
  const votes = {};
  for (const preferences of memberPreferences) {
    for (const id of normalizePreferenceIds(preferences)) {
      votes[id] = (votes[id] || 0) + 1;
    }
  }
  return votes;
}

function safeWebUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch (error) {
    return null;
  }
}

function getEffectiveVotes(votes) {
  if (votes && Object.values(votes).some(count => Number(count) > 0)) return votes;
  return { nature: 1, culture: 1, activity: 1, food: 1 };
}

function rankTourItems(items, votes, limit = 6) {
  const effectiveVotes = getEffectiveVotes(votes);
  const seen = new Set();

  return items
    .filter(item => item && item.contentid && item.title)
    .map(item => {
      const contentTypeId = String(item.contenttypeid || '');
      const searchable = `${item.title || ''} ${item.addr1 || ''} ${item.addr2 || ''}`;
      const matches = [];
      let score = 0;

      for (const preference of PREFERENCES) {
        const voteCount = Number(effectiveVotes[preference.id] || 0);
        if (!voteCount) continue;

        const typeMatch = preference.contentTypes.includes(contentTypeId);
        const keywordMatch = preference.keywords.some(keyword => searchable.includes(keyword));
        if (typeMatch || keywordMatch) {
          matches.push(preference.label);
          score += voteCount * (typeMatch ? 10 : 3);
        }
      }

      if (item.firstimage || item.firstimage2) score += 2;

      return {
        id: String(item.contentid),
        name: String(item.title),
        category: CONTENT_TYPE_LABELS[contentTypeId] || '여행지',
        image: safeWebUrl(item.firstimage || item.firstimage2),
        thumbnail: safeWebUrl(item.firstimage2 || item.firstimage),
        address: [item.addr1, item.addr2].filter(Boolean).join(' ').trim(),
        telephone: item.tel ? String(item.tel) : null,
        mapX: item.mapx ? String(item.mapx) : null,
        mapY: item.mapy ? String(item.mapy) : null,
        copyrightType: item.cpyrhtDivCd ? String(item.cpyrhtDivCd) : null,
        categoryCode: `TOUR_${contentTypeId}`,
        placeUrl: null,
        source: 'tourapi',
        sourceLabel: '한국관광공사',
        reason: matches.length ? `${matches.slice(0, 2).join(' · ')} 취향 반영` : '선정 지역의 인기 여행 정보',
        score,
        modifiedTime: String(item.modifiedtime || ''),
      };
    })
    .filter(item => {
      const key = item.id || item.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || b.modifiedTime.localeCompare(a.modifiedTime) || a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit)
    .map(({ modifiedTime, score, ...item }) => item);
}

function buildFallbackRecommendations(region, _votes, limit = 6) {
  return (region.attractions || []).slice(0, limit).map((name, index) => ({
    id: `fallback-${region.id}-${index}`,
    name,
    category: '추천 명소',
    image: null,
    thumbnail: null,
    address: region.name,
    telephone: null,
    mapX: null,
    mapY: null,
    copyrightType: null,
    categoryCode: 'FALLBACK',
    placeUrl: null,
    source: 'fallback',
    sourceLabel: 'PICKGO',
    reason: 'API 미연결 시 표시되는 PICKGO 기본 명소',
  }));
}

function distanceKm(from, to) {
  const lat1 = Number(from?.mapY);
  const lon1 = Number(from?.mapX);
  const lat2 = Number(to?.mapY);
  const lon2 = Number(to?.mapX);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;

  const toRadians = degrees => degrees * Math.PI / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildItinerary(places, selectedDate = null) {
  const used = new Set();
  const experiences = places.filter(place => !['FD6', 'CE7'].includes(place.categoryCode));
  const restaurants = places.filter(place => place.categoryCode === 'FD6');
  const cafes = places.filter(place => place.categoryCode === 'CE7');
  const slots = [
    { time: '10:00', title: '취향 장소', candidates: experiences },
    { time: '12:30', title: '점심', candidates: restaurants },
    { time: '14:30', title: '오후 체험', candidates: experiences },
    { time: '17:00', title: '카페·휴식', candidates: cafes },
  ];
  const itinerary = [];

  for (const slot of slots) {
    const available = slot.candidates.filter(place => !used.has(place.id));
    const fallback = places.filter(place => !used.has(place.id));
    const pool = available.length ? available : fallback;
    if (!pool.length) continue;

    const previous = itinerary[itinerary.length - 1]?.place;
    const ranked = pool.map((place, index) => ({ place, index, distance: previous ? distanceKm(previous, place) : null }));
    ranked.sort((a, b) => {
      if (a.distance === null && b.distance === null) return a.index - b.index;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance || a.index - b.index;
    });

    const chosen = ranked[0];
    used.add(chosen.place.id);
    itinerary.push({
      time: slot.time,
      title: slot.title,
      travelKmFromPrevious: chosen.distance === null ? null : Math.round(chosen.distance * 10) / 10,
      place: chosen.place,
    });
  }

  return { date: selectedDate, stops: itinerary };
}

module.exports = {
  PREFERENCES,
  aggregatePreferences,
  buildItinerary,
  buildFallbackRecommendations,
  normalizePreferenceIds,
  rankTourItems,
};
