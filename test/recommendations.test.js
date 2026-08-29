const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aggregatePreferences,
  buildItinerary,
  normalizePreferenceIds,
  rankTourItems,
} = require('../services/recommendations');
const { createTourApiClient, parseRegionName } = require('../services/tourApi');

test('여행 취향은 허용된 값만 중복 없이 최대 3개로 정리한다', () => {
  assert.deepEqual(
    normalizePreferenceIds(['nature', 'nature', 'invalid', 'food', 'culture', 'activity']),
    ['nature', 'food', 'culture']
  );
});

test('카카오 장소를 포함해 식사와 휴식이 있는 하루 코스를 만든다', () => {
  const places = [
    { id: 'tour-1', name: '숲길', categoryCode: 'TOUR_12', mapX: '127.0', mapY: '37.0' },
    { id: 'food-1', name: '동네식당', categoryCode: 'FD6', mapX: '127.01', mapY: '37.01' },
    { id: 'tour-2', name: '공방체험', categoryCode: 'TOUR_28', mapX: '127.02', mapY: '37.02' },
    { id: 'cafe-1', name: '골목카페', categoryCode: 'CE7', mapX: '127.03', mapY: '37.03' },
  ];

  const itinerary = buildItinerary(places, '2026-09-12');
  assert.equal(itinerary.date, '2026-09-12');
  assert.deepEqual(itinerary.stops.map(stop => stop.place.name), ['숲길', '동네식당', '공방체험', '골목카페']);
  assert.ok(itinerary.stops[1].travelKmFromPrevious > 0);
});

test('여러 멤버의 여행 취향을 투표수로 집계한다', () => {
  assert.deepEqual(
    aggregatePreferences([['nature', 'food'], ['food', 'culture'], ['food']]),
    { nature: 1, food: 3, culture: 1 }
  );
});

test('TourAPI 장소를 그룹 취향 점수에 따라 정렬한다', () => {
  const items = [
    { contentid: '1', contenttypeid: '12', title: '바다공원', firstimage: 'https://example.com/park.jpg' },
    { contentid: '2', contenttypeid: '39', title: '바다식당', firstimage: 'https://example.com/food.jpg' },
    { contentid: '3', contenttypeid: '14', title: '역사박물관' },
  ];

  const ranked = rankTourItems(items, { food: 3, nature: 1 }, 3);
  assert.equal(ranked[0].name, '바다식당');
  assert.equal(ranked[0].category, '음식점');
  assert.match(ranked[0].reason, /맛집/);
});

test('지역명에서 TourAPI 법정동 조회용 시도·시군구명을 분리한다', () => {
  assert.deepEqual(parseRegionName('인천 중구(을왕리)'), {
    provinceNames: ['인천광역시'],
    districtName: '중구',
  });
  assert.deepEqual(parseRegionName('강원 강릉시'), {
    provinceNames: ['강원특별자치도', '강원도'],
    districtName: '강릉시',
  });
});

test('TourAPI 클라이언트가 법정동 코드를 찾고 지역 장소를 추천한다', async () => {
  const requestedUrls = [];
  const payloads = [
    { response: { header: { resultCode: '0000' }, body: { items: { item: [{ name: '서울특별시', code: '11' }] } } } },
    { response: { header: { resultCode: '0000' }, body: { items: { item: [{ name: '종로구', code: '11110' }] } } } },
    { response: { header: { resultCode: '0000' }, body: { items: { item: [
      { contentid: '100', contenttypeid: '14', title: '서울역사박물관', addr1: '서울 종로구', firstimage: 'https://example.com/100.jpg' },
    ] } } } },
  ];
  const client = createTourApiClient({
    serviceKey: 'test-key',
    fetchImpl: async url => {
      requestedUrls.push(url.toString());
      const payload = payloads.shift();
      return { ok: true, status: 200, json: async () => payload };
    },
  });

  const items = await client.getRecommendations({ name: '서울 종로구' }, { culture: 2 });
  assert.equal(items[0].name, '서울역사박물관');
  assert.equal(requestedUrls.length, 3);
  assert.match(requestedUrls[2], /lDongRegnCd=11/);
  assert.match(requestedUrls[2], /lDongSignguCd=11110/);
});
