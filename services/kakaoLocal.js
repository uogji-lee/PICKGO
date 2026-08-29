const BASE_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const CACHE_TTL_MS = 30 * 60 * 1000;

const SEARCH_DEFINITIONS = Object.freeze({
  nature: { keyword: '산책', categoryCode: 'AT4', label: '자연·힐링' },
  culture: { keyword: '문화', categoryCode: 'CT1', label: '문화·역사' },
  activity: { keyword: '체험', categoryCode: null, label: '액티비티' },
  food: { keyword: '맛집', categoryCode: 'FD6', label: '맛집' },
  shopping: { keyword: '전통시장', categoryCode: null, label: '쇼핑' },
  festival: { keyword: '축제', categoryCode: 'CT1', label: '축제·공연' },
  cafe: { keyword: '카페', categoryCode: 'CE7', label: '카페·휴식' },
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

function createKakaoLocalClient(options = {}) {
  const restApiKey = options.restApiKey || process.env.KAKAO_REST_API_KEY || '';
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = options.timeoutMs || 6000;
  const cache = new Map();

  function readCache(key) {
    const entry = cache.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      cache.delete(key);
      return null;
    }
    return entry.value;
  }

  function writeCache(key, value) {
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return value;
  }

  async function searchKeyword(params) {
    if (!restApiKey) throw new Error('KAKAO_REST_API_KEY가 설정되지 않았습니다.');
    if (typeof fetchImpl !== 'function') throw new Error('현재 Node.js 환경에서 fetch를 사용할 수 없습니다.');

    const cacheKey = JSON.stringify(params);
    const cached = readCache(cacheKey);
    if (cached) return cached;

    const url = new URL(BASE_URL);
    Object.entries({ size: 10, page: 1, sort: 'accuracy', ...params }).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `KakaoAK ${restApiKey}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('카카오 로컬 API 응답 시간이 초과되었습니다.');
      throw new Error('카카오 로컬 API에 연결할 수 없습니다.');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`카카오 로컬 API 요청 실패 (${response.status})`);
    const json = await response.json();
    return writeCache(cacheKey, Array.isArray(json.documents) ? json.documents : []);
  }

  async function getPersonalizedPlaces(regionName, votes, anchor = null) {
    const rankedPreferences = Object.entries(votes || {})
      .filter(([id, count]) => SEARCH_DEFINITIONS[id] && Number(count) > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, 2);

    const effectivePreferences = rankedPreferences.length ? rankedPreferences : ['nature', 'culture'];
    const searchIds = [...new Set([...effectivePreferences, 'food', 'cafe'])].slice(0, 4);
    const settled = await Promise.allSettled(searchIds.map(async preferenceId => {
      const definition = SEARCH_DEFINITIONS[preferenceId];
      const params = {
        query: `${regionName} ${definition.keyword}`,
        category_group_code: definition.categoryCode,
      };
      if (anchor?.mapX && anchor?.mapY) {
        params.x = anchor.mapX;
        params.y = anchor.mapY;
        params.radius = 20000;
        params.sort = 'distance';
      }

      const documents = await searchKeyword(params);
      return documents.map((document, index) => ({
        id: `kakao-${document.id}`,
        name: String(document.place_name || ''),
        category: String(document.category_group_name || document.category_name?.split('>').pop()?.trim() || '장소'),
        categoryCode: String(document.category_group_code || ''),
        image: null,
        thumbnail: null,
        address: String(document.road_address_name || document.address_name || ''),
        telephone: document.phone ? String(document.phone) : null,
        mapX: document.x ? String(document.x) : null,
        mapY: document.y ? String(document.y) : null,
        placeUrl: safeWebUrl(document.place_url),
        source: 'kakao',
        sourceLabel: '카카오맵',
        reason: `${definition.label} 검색 결과${document.distance ? ` · 기준 장소에서 약 ${Math.round(Number(document.distance) / 100) / 10}km` : ''}`,
        preferenceId,
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
    isConfigured: () => Boolean(restApiKey),
    searchKeyword,
  };
}

module.exports = { SEARCH_DEFINITIONS, createKakaoLocalClient };
