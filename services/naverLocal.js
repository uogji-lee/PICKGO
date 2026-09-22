const BASE_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/local';
const CACHE_TTL_MS = 30 * 60 * 1000;

const SEARCH_DEFINITIONS = Object.freeze({
  nature: { keyword: '산책', categoryCode: 'AT4', label: '자연·힐링' },
  culture: { keyword: '전시 공연', categoryCode: 'CT1', label: '전시·공연' },
  activity: { keyword: '놀거리 체험', categoryCode: 'AT4', label: '액티비티·체험' },
  food: { keyword: '맛집', categoryCode: 'FD6', label: '맛집' },
  shopping: { keyword: '소품샵 쇼핑', categoryCode: 'CS2', label: '쇼핑·소품샵' },
  festival: { keyword: '축제 이벤트', categoryCode: 'CT1', label: '축제·이벤트' },
  cafe: { keyword: '카페 디저트', categoryCode: 'CE7', label: '카페·디저트' },
});

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').trim();
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

function normalizeCoordinate(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = Math.abs(number) > max ? number / 10_000_000 : number;
  return String(normalized);
}

function createNaverLocalClient(options = {}) {
  const clientId = options.clientId || process.env.NAVER_CLIENT_ID || '';
  const clientSecret = options.clientSecret || process.env.NAVER_CLIENT_SECRET || '';
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

  async function searchLocal(query) {
    if (!clientId || !clientSecret) throw new Error('NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET이 설정되지 않았습니다.');
    if (typeof fetchImpl !== 'function') throw new Error('현재 Node.js 환경에서 fetch를 사용할 수 없습니다.');

    const cacheKey = String(query);
    const cached = readCache(cacheKey);
    if (cached) return cached;

    const url = new URL(BASE_URL);
    url.searchParams.set('query', query);
    url.searchParams.set('display', '5');
    url.searchParams.set('start', '1');
    url.searchParams.set('sort', 'comment');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': clientId,
          'X-NCP-APIGW-API-KEY': clientSecret,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('네이버 지역 검색 응답 시간이 초과되었습니다.');
      throw new Error('네이버 지역 검색 API에 연결할 수 없습니다.');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`네이버 지역 검색 API 요청 실패 (${response.status})`);
    const json = await response.json();
    return writeCache(cacheKey, Array.isArray(json.items) ? json.items : []);
  }

  async function getPersonalizedPlaces(regionName, votes, customPreferences = []) {
    const rankedPreferences = Object.entries(votes || {})
      .filter(([id, count]) => SEARCH_DEFINITIONS[id] && Number(count) > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, 2);
    const effectivePreferences = rankedPreferences.length ? rankedPreferences : ['activity', 'culture'];
    const searchIds = [...new Set([...effectivePreferences, 'food', 'cafe'])].slice(0, 4);
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
      const items = await searchLocal(`${regionName} ${definition.keyword}`);
      return items.map((item, index) => {
        const name = stripHtml(item.title);
        return {
          id: `naver-${item.mapx || ''}-${item.mapy || ''}-${name}`,
          name,
          category: stripHtml(item.category).split('>').pop()?.trim() || '장소',
          categoryCode: definition.categoryCode,
          image: null,
          thumbnail: null,
          address: String(item.roadAddress || item.address || ''),
          telephone: null,
          mapX: normalizeCoordinate(item.mapx, 180),
          mapY: normalizeCoordinate(item.mapy, 90),
          placeUrl: safeWebUrl(item.link) || `https://map.naver.com/p/search/${encodeURIComponent(`${name} ${item.roadAddress || item.address || ''}`)}`,
          source: 'naver',
          sourceLabel: '네이버 지역검색',
          reason: `${definition.label} · 네이버 리뷰순 검색 결과`,
          preferenceId,
          customKeyword,
          rank: index,
        };
      });
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
    isConfigured: () => Boolean(clientId && clientSecret),
    searchLocal,
  };
}

module.exports = { SEARCH_DEFINITIONS, createNaverLocalClient, normalizeCoordinate, stripHtml };
