const { rankTourItems } = require('./recommendations');

const BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';
const CACHE_TTL_MS = 30 * 60 * 1000;
const CODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const PROVINCE_ALIASES = Object.freeze({
  서울: ['서울', '서울특별시'],
  부산: ['부산', '부산광역시'],
  대구: ['대구', '대구광역시'],
  인천: ['인천', '인천광역시'],
  광주: ['광주', '광주광역시'],
  대전: ['대전', '대전광역시'],
  울산: ['울산', '울산광역시'],
  세종: ['세종', '세종특별자치시'],
  경기: ['경기', '경기도'],
  강원: ['강원', '강원특별자치도', '강원도'],
  충북: ['충북', '충청북도'],
  충남: ['충남', '충청남도'],
  전북: ['전북', '전북특별자치도', '전라북도'],
  전남: ['전남', '전라남도'],
  경북: ['경북', '경상북도'],
  경남: ['경남', '경상남도'],
  제주: ['제주', '제주특별자치도'],
});

const PREFERENCE_CONTENT_TYPES = Object.freeze({
  nature: ['12'],
  culture: ['14'],
  activity: ['28'],
  food: ['39'],
  shopping: ['38'],
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseRegionName(regionName) {
  const normalized = String(regionName || '').replace(/\([^)]*\)/g, '').trim();
  const [provinceToken, districtToken] = normalized.split(/\s+/);
  return {
    provinceNames: PROVINCE_ALIASES[provinceToken] || [provinceToken],
    districtName: districtToken || null,
  };
}

function normalizeServiceKey(key) {
  try {
    return decodeURIComponent(key);
  } catch (error) {
    return key;
  }
}

function createTourApiClient(options = {}) {
  const serviceKey = options.serviceKey || process.env.TOUR_API_SERVICE_KEY || '';
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

  function writeCache(key, value, ttlMs) {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return value;
  }

  async function request(endpoint, params = {}, ttlMs = CACHE_TTL_MS) {
    if (!serviceKey) throw new Error('TOUR_API_SERVICE_KEY가 설정되지 않았습니다.');
    if (typeof fetchImpl !== 'function') throw new Error('현재 Node.js 환경에서 fetch를 사용할 수 없습니다.');

    const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
    const cached = readCache(cacheKey);
    if (cached) return cached;

    const url = new URL(`${BASE_URL}/${endpoint}`);
    const query = {
      serviceKey: normalizeServiceKey(serviceKey),
      MobileOS: 'ETC',
      MobileApp: 'PICKGO',
      _type: 'json',
      ...params,
    };
    Object.entries(query).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('TourAPI 응답 시간이 초과되었습니다.');
      throw new Error('TourAPI에 연결할 수 없습니다.');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`TourAPI 요청 실패 (${response.status})`);

    let json;
    try {
      json = await response.json();
    } catch (error) {
      throw new Error('TourAPI가 올바른 JSON을 반환하지 않았습니다.');
    }

    const payload = json.response || json;
    const resultCode = String(payload.header?.resultCode || '');
    if (resultCode && !['0000', '00'].includes(resultCode)) {
      throw new Error(`TourAPI 오류: ${payload.header?.resultMsg || resultCode}`);
    }
    return writeCache(cacheKey, payload.body || {}, ttlMs);
  }

  async function resolveRegionCodes(regionName) {
    const cacheKey = `region:${regionName}`;
    const cached = readCache(cacheKey);
    if (cached) return cached;

    const { provinceNames, districtName } = parseRegionName(regionName);
    const provinceBody = await request('areaCode2', {
      numOfRows: 50,
      pageNo: 1,
    }, CODE_CACHE_TTL_MS);
    const provinces = asArray(provinceBody.items?.item);
    const province = provinces.find(item => provinceNames.includes(String(item.name || '').trim()));
    if (!province) throw new Error(`${regionName}의 TourAPI 시도 코드를 찾지 못했습니다.`);

    const codes = { areaCode: String(province.code) };
    if (!districtName || provinceNames.includes('세종특별자치시')) {
      return writeCache(cacheKey, codes, CODE_CACHE_TTL_MS);
    }

    const districtBody = await request('areaCode2', {
      numOfRows: 100,
      pageNo: 1,
      areaCode: codes.areaCode,
    }, CODE_CACHE_TTL_MS);
    const districts = asArray(districtBody.items?.item);
    const district = districts.find(item => {
      const name = String(item.name || '').trim();
      return name === districtName || name.endsWith(` ${districtName}`);
    });
    if (!district) throw new Error(`${regionName}의 TourAPI 시군구 코드를 찾지 못했습니다.`);

    codes.sigunguCode = String(district.code);
    return writeCache(cacheKey, codes, CODE_CACHE_TTL_MS);
  }

  async function getRecommendations(region, votes, limit = 12, options = {}) {
    const codes = await resolveRegionCodes(region.name);
    const selectedPreferences = Object.entries(votes || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([id]) => id);
    const contentTypes = new Set(['12', '39']);
    for (const id of selectedPreferences) {
      for (const contentTypeId of PREFERENCE_CONTENT_TYPES[id] || []) contentTypes.add(contentTypeId);
    }
    if (!selectedPreferences.length) ['14', '28'].forEach(id => contentTypes.add(id));

    const numOfRows = Math.min(Math.max(Number(limit) || 12, 12), 40);
    const calls = [...contentTypes].map(contentTypeId => request('areaBasedList2', {
      numOfRows,
      pageNo: 1,
      arrange: 'Q',
      contentTypeId,
      ...codes,
    }));
    calls.push(request('searchKeyword2', {
      numOfRows,
      pageNo: 1,
      arrange: 'Q',
      keyword: '카페',
      ...codes,
    }));

    if (Number(votes?.festival) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(options.tripDate || '')) {
      calls.push(request('searchFestival2', {
        numOfRows,
        pageNo: 1,
        arrange: 'Q',
        eventStartDate: options.tripDate.replaceAll('-', ''),
        ...codes,
      }));
    }

    const results = await Promise.allSettled(calls);
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    if (!fulfilled.length) throw results[0]?.reason || new Error('TourAPI에서 장소를 불러오지 못했습니다.');

    const rawItems = fulfilled.flatMap(result => asArray(result.value.items?.item));
    const ranked = rankTourItems(rawItems, votes, 200);
    const experiences = ranked.filter(item => !['TOUR_39', 'TOUR_CAFE'].includes(item.categoryCode));
    const restaurants = ranked.filter(item => item.categoryCode === 'TOUR_39');
    const cafes = ranked.filter(item => item.categoryCode === 'TOUR_CAFE');
    const dayCount = Math.max(1, Math.ceil(limit / 4));
    const selected = [];
    const selectedIds = new Set();
    const add = item => {
      if (!item || selectedIds.has(item.id)) return;
      selectedIds.add(item.id);
      selected.push(item);
    };

    for (let day = 0; day < dayCount; day++) {
      add(experiences[day * 2]);
      add(restaurants[day]);
      add(experiences[day * 2 + 1]);
      add(cafes[day]);
    }
    for (const item of ranked) {
      if (selected.length >= limit) break;
      add(item);
    }
    return selected.slice(0, limit);
  }

  return {
    getRecommendations,
    isConfigured: () => Boolean(serviceKey),
    resolveRegionCodes,
  };
}

module.exports = { createTourApiClient, parseRegionName };
