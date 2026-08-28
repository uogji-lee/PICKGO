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
    reason: 'API 미연결 시 표시되는 PICKGO 기본 명소',
  }));
}

module.exports = {
  PREFERENCES,
  aggregatePreferences,
  buildFallbackRecommendations,
  normalizePreferenceIds,
  rankTourItems,
};
