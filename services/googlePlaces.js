const BASE_URL = 'https://places.googleapis.com/v1/places:searchText';

const SEARCH_DEFINITIONS = Object.freeze({
  nature: { keyword: '산책 자연 명소', categoryCode: 'AT4', label: '자연·힐링' },
  culture: { keyword: '전시 공연', categoryCode: 'CT1', label: '전시·공연' },
  activity: { keyword: '놀거리 체험', categoryCode: 'AT4', label: '액티비티·체험' },
  food: { keyword: '맛집', categoryCode: 'FD6', label: '맛집' },
  shopping: { keyword: '쇼핑 소품샵', categoryCode: 'CS2', label: '쇼핑·소품샵' },
  festival: { keyword: '축제 이벤트', categoryCode: 'CT1', label: '축제·이벤트' },
  cafe: { keyword: '카페 디저트', categoryCode: 'CE7', label: '카페·디저트' },
});

function safeWebUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch (error) {
    return null;
  }
}

function createGooglePlacesClient(options = {}) {
  const apiKey = options.apiKey || process.env.GOOGLE_PLACES_API_KEY || '';
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = options.timeoutMs || 6000;

  async function searchText(textQuery) {
    if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY가 설정되지 않았습니다.');
    if (typeof fetchImpl !== 'function') throw new Error('현재 Node.js 환경에서 fetch를 사용할 수 없습니다.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName,places.googleMapsUri',
        },
        body: JSON.stringify({ textQuery, languageCode: 'ko', regionCode: 'KR', pageSize: 5 }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Google Places 응답 시간이 초과되었습니다.');
      throw new Error('Google Places API에 연결할 수 없습니다.');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`Google Places API 요청 실패 (${response.status})`);
    const json = await response.json();
    return Array.isArray(json.places) ? json.places : [];
  }

  async function getPersonalizedPlaces(regionName, votes, customPreferences = []) {
    const rankedPreferences = Object.entries(votes || {})
      .filter(([id, count]) => SEARCH_DEFINITIONS[id] && Number(count) > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, 1);
    const effectivePreferences = rankedPreferences.length ? rankedPreferences : ['activity'];
    const searchIds = [...new Set([...effectivePreferences, 'food', 'cafe'])];
    const searchTasks = searchIds.map(preferenceId => ({
      preferenceId,
      customKeyword: null,
      definition: SEARCH_DEFINITIONS[preferenceId],
    }));
    for (const customPreference of customPreferences.slice(0, 2)) {
      searchTasks.push({
        preferenceId: null,
        customKeyword: customPreference.keyword,
        definition: { keyword: customPreference.keyword, categoryCode: '', label: `기타 취향: ${customPreference.keyword}` },
      });
    }
    const settled = await Promise.allSettled(searchTasks.map(async task => {
      const { definition, preferenceId, customKeyword } = task;
      const places = await searchText(`${regionName} ${definition.keyword}`);
      return places.map((place, index) => ({
        id: `google-${place.id}`,
        name: String(place.displayName?.text || ''),
        category: String(place.primaryTypeDisplayName?.text || '장소'),
        categoryCode: definition.categoryCode,
        image: null,
        thumbnail: null,
        address: String(place.formattedAddress || ''),
        telephone: null,
        mapX: place.location?.longitude === undefined ? null : String(place.location.longitude),
        mapY: place.location?.latitude === undefined ? null : String(place.location.latitude),
        placeUrl: safeWebUrl(place.googleMapsUri),
        source: 'google',
        sourceLabel: 'Google Maps',
        reason: `${definition.label} · Google Places 검색 결과`,
        preferenceId,
        customKeyword,
        rank: index,
      }));
    }));

    const places = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    if (!places.length && settled.some(result => result.status === 'rejected')) {
      throw settled.find(result => result.status === 'rejected').reason;
    }

    const seen = new Set();
    return places.filter(place => {
      if (!place.name) return false;
      const key = `${place.name}:${place.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return {
    getPersonalizedPlaces,
    isConfigured: () => Boolean(apiKey),
    searchText,
  };
}

module.exports = { SEARCH_DEFINITIONS, createGooglePlacesClient };
