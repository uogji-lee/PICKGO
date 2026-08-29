const PREFERENCES = Object.freeze([
  { id: 'nature', label: '자연·힐링', contentTypes: [], keywords: ['공원', '숲', '산', '해변', '해수욕장', '수목원', '정원', '생태', '휴양', '폭포', '계곡', '호수', '섬'] },
  { id: 'culture', label: '전시·공연', contentTypes: ['14'], keywords: ['전시', '공연', '미술관', '아트', '갤러리', '문화', '뮤지엄'] },
  { id: 'activity', label: '액티비티·체험', contentTypes: ['25', '28'], keywords: ['체험', '레포츠', '서핑', '카약', '자전거', '클라이밍', '테마파크', '놀거리'] },
  { id: 'food', label: '맛집·카페', contentTypes: ['39'], keywords: ['맛집', '음식', '식당', '카페', '베이커리', '디저트', '브런치'] },
  { id: 'shopping', label: '쇼핑·소품샵', contentTypes: ['38'], keywords: ['쇼핑', '공방', '소품', '편집숍', '플리마켓', '복합문화공간'] },
  { id: 'festival', label: '축제·이벤트', contentTypes: ['15'], keywords: ['축제', '공연', '행사', '페스티벌', '콘서트', '야시장'] },
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

const TRENDY_KEYWORDS = Object.freeze(['카페', '아트', '벽화', '거리', '전망대', '복합문화', '테마', '공방', '야시장', '통닭', '놀이터', '쇼핑몰']);
const QUIET_CULTURE_KEYWORDS = Object.freeze(['박물관', '향교', '선생묘', '사찰', '암(', '도서관']);
const GENERIC_FACILITY_KEYWORDS = Object.freeze(['주민편익시설', '체육문화센터', '어린이교통공원']);

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

function isCafeTitle(value) {
  return /카페|커피|로스터|베이커리|디저트|브런치|티룸|찻집|다방/.test(String(value || ''));
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

      const trendyMatchCount = TRENDY_KEYWORDS.filter(keyword => searchable.includes(keyword)).length;
      score += trendyMatchCount * 4;
      if (trendyMatchCount && (Number(effectiveVotes.activity) > 0 || Number(effectiveVotes.festival) > 0)) score += 6;
      if (!Number(effectiveVotes.culture) && QUIET_CULTURE_KEYWORDS.some(keyword => searchable.includes(keyword))) score -= 8;
      if (GENERIC_FACILITY_KEYWORDS.some(keyword => searchable.includes(keyword))) score -= 12;
      if (!Number(effectiveVotes.nature) && /둘레길|옛길|트레킹길/.test(searchable)) score -= 6;

      if (item.firstimage || item.firstimage2) score += 2;

      const cafe = contentTypeId === '39' && isCafeTitle(item.title);
      return {
        id: String(item.contentid),
        name: String(item.title),
        category: cafe ? '카페·디저트' : CONTENT_TYPE_LABELS[contentTypeId] || '여행지',
        image: safeWebUrl(item.firstimage || item.firstimage2),
        thumbnail: safeWebUrl(item.firstimage2 || item.firstimage),
        address: [item.addr1, item.addr2].filter(Boolean).join(' ').trim(),
        telephone: item.tel ? String(item.tel) : null,
        mapX: item.mapx ? String(item.mapx) : null,
        mapY: item.mapy ? String(item.mapy) : null,
        copyrightType: item.cpyrhtDivCd ? String(item.cpyrhtDivCd) : null,
        categoryCode: cafe ? 'TOUR_CAFE' : `TOUR_${contentTypeId}`,
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

function addDaysToDate(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function buildItinerary(places, selectedDate = null, nights = 1) {
  const used = new Set();
  const isCafe = place => ['CE7', 'TOUR_CAFE'].includes(place.categoryCode);
  const isRestaurant = place => ['FD6', 'TOUR_39'].includes(place.categoryCode);
  const experiences = places.filter(place => !isRestaurant(place) && !isCafe(place));
  const restaurants = places.filter(isRestaurant);
  const cafes = places.filter(isCafe);
  const slots = [
    { time: '10:30', title: '취향 스폿', candidates: experiences },
    { time: '12:30', title: '점심 맛집', candidates: restaurants },
    { time: '15:00', title: '체험·핫플', candidates: experiences },
    { time: '17:30', title: '카페·휴식', candidates: cafes.length ? cafes : restaurants },
  ];
  const cleanNights = Number.isInteger(nights) ? Math.min(Math.max(nights, 0), 7) : 1;
  const days = [];

  for (let dayIndex = 0; dayIndex <= cleanNights; dayIndex++) {
    const stops = [];
    for (const slot of slots) {
      const available = slot.candidates.filter(place => !used.has(place.id));
      const fallback = places.filter(place => !used.has(place.id));
      const pool = available.length ? available : fallback;
      if (!pool.length) continue;

      const previous = stops[stops.length - 1]?.place;
      const ranked = pool.map((place, index) => ({ place, index, distance: previous ? distanceKm(previous, place) : null }));
      ranked.sort((a, b) => {
        if (a.distance === null && b.distance === null) return a.index - b.index;
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance || a.index - b.index;
      });

      const chosen = ranked[0];
      used.add(chosen.place.id);
      stops.push({
        time: slot.time,
        title: slot.title,
        travelKmFromPrevious: chosen.distance === null ? null : Math.round(chosen.distance * 10) / 10,
        place: chosen.place,
      });
    }

    days.push({
      dayNumber: dayIndex + 1,
      date: selectedDate ? addDaysToDate(selectedDate, dayIndex) : null,
      stops,
    });
  }

  return {
    startDate: selectedDate,
    endDate: selectedDate ? addDaysToDate(selectedDate, cleanNights) : null,
    nights: cleanNights,
    days,
  };
}

module.exports = {
  PREFERENCES,
  aggregatePreferences,
  buildItinerary,
  buildFallbackRecommendations,
  normalizePreferenceIds,
  rankTourItems,
};
