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

  const itinerary = buildItinerary(places, '2026-09-12', 0);
  assert.equal(itinerary.startDate, '2026-09-12');
  assert.equal(itinerary.endDate, '2026-09-12');
  assert.deepEqual(itinerary.days[0].stops.map(stop => stop.place.name), ['숲길', '동네식당', '공방체험', '골목카페']);
  assert.ok(itinerary.days[0].stops[1].travelKmFromPrevious > 0);
});

test('TourAPI 음식점과 카페를 실제 식사·휴식 슬롯에 배치한다', () => {
  const places = [
    { id: 'tour-1', name: '점핑파크', categoryCode: 'TOUR_28' },
    { id: 'food-1', name: '행궁동 맛집', categoryCode: 'TOUR_39' },
    { id: 'tour-2', name: '아트스페이스', categoryCode: 'TOUR_14' },
    { id: 'cafe-1', name: '행궁동 카페', categoryCode: 'TOUR_CAFE' },
  ];

  const itinerary = buildItinerary(places, '2026-09-05', 0);
  assert.deepEqual(itinerary.days[0].stops.map(stop => stop.place.name), [
    '점핑파크', '행궁동 맛집', '아트스페이스', '행궁동 카페',
  ]);
  assert.deepEqual(itinerary.days[0].stops.map(stop => stop.title), [
    '취향 스폿', '점심 맛집', '체험·핫플', '카페·휴식',
  ]);
});

test('숙박 수에 맞춰 날짜별 코스를 만들고 장소를 중복 사용하지 않는다', () => {
  const places = Array.from({ length: 8 }, (_, index) => ({
    id: `place-${index}`,
    name: `장소 ${index}`,
    categoryCode: index === 1 || index === 5 ? 'FD6' : index === 3 || index === 7 ? 'CE7' : 'TOUR_12',
    mapX: String(127 + index * 0.01),
    mapY: String(37 + index * 0.01),
  }));

  const itinerary = buildItinerary(places, '2026-12-31', 1);
  const stopIds = itinerary.days.flatMap(day => day.stops.map(stop => stop.place.id));
  assert.equal(itinerary.endDate, '2027-01-01');
  assert.equal(itinerary.days.length, 2);
  assert.equal(new Set(stopIds).size, stopIds.length);
});

test('대중교통 코스는 숙소 반경 안의 장소만 사용하고 숙소 복귀 이동을 계산한다', () => {
  const places = [
    { id: 'near-spot-1', name: '숙소앞 전시', categoryCode: 'TOUR_14', mapX: '127.005', mapY: '37.005' },
    { id: 'near-food', name: '숙소앞 식당', categoryCode: 'FD6', mapX: '127.01', mapY: '37.005' },
    { id: 'near-spot-2', name: '동네 체험', categoryCode: 'TOUR_28', mapX: '127.015', mapY: '37.01' },
    { id: 'near-cafe', name: '동네 카페', categoryCode: 'CE7', mapX: '127.02', mapY: '37.01' },
    { id: 'far-spot', name: '먼 관광지', categoryCode: 'TOUR_12', mapX: '128.0', mapY: '38.0' },
  ];

  const itinerary = buildItinerary(places, '2026-09-05', 0, {
    travelerCount: 4,
    transportMode: 'public',
    accommodation: { name: '테스트 호텔', mapX: '127.0', mapY: '37.0' },
  });

  assert.equal(itinerary.planning.maxDistanceFromAccommodationKm, 12);
  assert.equal(itinerary.days[0].stops.some(stop => stop.place.id === 'far-spot'), false);
  assert.equal(itinerary.days[0].stops[0].travelOrigin, 'accommodation');
  assert.ok(itinerary.days[0].stops[0].travelMinutesFromPrevious > 0);
  assert.ok(itinerary.days[0].returnKmToAccommodation > 0);
});

test('차량 수와 여행 인원으로 좌석 부족 안내를 만든다', () => {
  const itinerary = buildItinerary([], null, 0, {
    travelerCount: 8,
    transportMode: 'car',
    vehicleCount: 1,
  });

  assert.equal(itinerary.planning.transportLabel, '차량 1대');
  assert.equal(itinerary.planning.seatCapacity, 5);
  assert.match(itinerary.planning.seatWarning, /3명/);
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
    provinceNames: ['인천', '인천광역시'],
    districtName: '중구',
  });
  assert.deepEqual(parseRegionName('강원 강릉시'), {
    provinceNames: ['강원', '강원특별자치도', '강원도'],
    districtName: '강릉시',
  });
});

test('TourAPI 클라이언트가 관광 지역 코드를 찾고 장소 종류를 섞어 추천한다', async () => {
  const requestedUrls = [];
  const client = createTourApiClient({
    serviceKey: 'test-key',
    fetchImpl: async url => {
      requestedUrls.push(url.toString());
      const parsed = new URL(url);
      const endpoint = parsed.pathname.split('/').pop();
      let items = [];
      if (endpoint === 'areaCode2' && !parsed.searchParams.has('areaCode')) {
        items = [{ name: '서울', code: '1' }];
      } else if (endpoint === 'areaCode2') {
        items = [{ name: '종로구', code: '1' }];
      } else if (endpoint === 'searchKeyword2') {
        items = [{ contentid: '400', contenttypeid: '39', title: '종로 카페', addr1: '서울 종로구' }];
      } else {
        const type = parsed.searchParams.get('contentTypeId');
        items = [{
          contentid: `tour-${type}`,
          contenttypeid: type,
          title: type === '39' ? '종로 맛집' : type === '14' ? '서울 전시공간' : '서울 산책길',
          addr1: '서울 종로구',
        }];
      }
      const payload = { response: { header: { resultCode: '0000' }, body: { items: { item: items } } } };
      return { ok: true, status: 200, json: async () => payload };
    },
  });

  const items = await client.getRecommendations({ name: '서울 종로구' }, { culture: 2 }, 4);
  assert.equal(items.some(item => item.name === '서울 전시공간'), true);
  assert.equal(items.some(item => item.categoryCode === 'TOUR_39'), true);
  assert.equal(items.some(item => item.categoryCode === 'TOUR_CAFE'), true);
  assert.match(requestedUrls[2], /areaCode=1/);
  assert.match(requestedUrls[2], /sigunguCode=1/);
});
