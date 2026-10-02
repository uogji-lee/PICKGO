const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  courseDayColor, coursePoint, kakaoDirectionsUrl, buildCourseRoutes,
  courseLegFor, courseBoundsPoints, courseLegSegments, courseMapPanelHtml,
} = require('../public/js/courseMap');
const { normalizeCoordinate } = require('../services/naverLocal');

const place = (name, mapX, mapY, source = 'naver') => ({ name, mapX: mapX === null ? null : String(mapX), mapY: mapY === null ? null : String(mapY), source, address: `${name} 주소`, reason: '테스트' });
const stop = (time, title, stopPlace) => ({ time, title, place: stopPlace, travelKmFromPrevious: null, travelMinutesFromPrevious: null, travelOrigin: null });
const hotel = { name: '바다 호텔', address: '부산 해운대구', mapX: '129.16', mapY: '35.16' };
const days = [
  { dayNumber: 1, date: '2026-10-10', stops: [
    stop('10:30', '취향 스폿', place('해운대, 해수욕장', 129.1604, 35.1587)),
    stop('12:30', '점심 맛집', place('기본 명소', null, null, 'fallback')),
    stop('15:00', '체험·핫플', place('밀면/집', 129.17, 35.17, 'kakao')),
  ] },
  { dayNumber: 2, date: '2026-10-11', stops: [stop('10:30', '취향 스폿', place('광안리', 129.118, 35.153, 'tourapi'))] },
  { dayNumber: 3, date: '2026-10-12', stops: [stop('10:30', '취향 스폿', place('좌표 없음', '', ''))] },
];

test('지도 좌표는 출처와 무관하게 유효한 WGS84 값만 쓴다', () => {
  assert.deepEqual(coursePoint(place('네이버 카페', 127.0123456, 37.2345678)), { lat: 37.2345678, lng: 127.0123456, name: '네이버 카페', address: '네이버 카페 주소' });
  assert.ok(coursePoint(place('카카오', 127, 37, 'kakao')));
  assert.ok(coursePoint(place('관광공사', 127, 37, 'tourapi')));
  for (const [x, y] of [[null, null], ['', ''], ['abc', '37'], [0, 0], [310001, 552103], [127, 95]]) {
    assert.equal(coursePoint({ name: '잘못된 좌표', mapX: x, mapY: y }), null, `${x},${y}`);
  }
  assert.equal(coursePoint(null), null);
});

test('날짜별 경로는 숙소에서 출발해 좌표 있는 장소를 순서대로 지나 숙소로 돌아온다', () => {
  const routes = buildCourseRoutes(days, hotel);
  assert.deepEqual(routes.map(route => route.dayNumber), [1, 2], '좌표가 하나도 없는 날짜는 빠진다');
  const [first, second] = routes;
  assert.deepEqual(first.path.map(point => point.name), ['바다 호텔', '해운대, 해수욕장', '밀면/집', '바다 호텔']);
  // 순번은 일정 목록 순서를 따르므로 좌표 없는 장소(1-2)를 건너뛴다
  assert.deepEqual(first.stops.map(point => point.label), ['1-1', '1-3']);
  assert.equal(first.color, courseDayColor(1));
  assert.notEqual(first.color, second.color);
  assert.deepEqual(first.legs.map(leg => [leg.from.name, leg.to.name, leg.stopIndex]), [
    ['바다 호텔', '해운대, 해수욕장', 0], ['해운대, 해수욕장', '밀면/집', 2], ['밀면/집', '바다 호텔', null],
  ]);
  assert.equal(courseLegFor(routes, 1, 2).from.name, '해운대, 해수욕장');
  assert.equal(courseLegFor(routes, 1, 1), null, '좌표 없는 장소에는 길찾기가 없다');
  assert.equal(courseLegFor(routes, 1).to.name, '바다 호텔');
  assert.equal(courseLegFor(routes, 3, 0), null);

  // 숙소 좌표가 없으면 장소끼리만 잇고 복귀 구간도 없다
  const withoutHotel = buildCourseRoutes(days, { name: '링크 숙소', mapX: null, mapY: null });
  assert.deepEqual(withoutHotel[0].path.map(point => point.name), ['해운대, 해수욕장', '밀면/집']);
  assert.equal(withoutHotel[1].legs.length, 0);
  assert.equal(courseLegFor(withoutHotel, 1, 0), null);
  assert.equal(courseLegFor(withoutHotel, 1), null);
  assert.deepEqual(buildCourseRoutes([], hotel), []);
});

test('카카오맵 길찾기 링크는 이름의 쉼표·슬래시를 지우고 위도,경도 순서로 만든다', () => {
  const url = kakaoDirectionsUrl({ name: '해운대, 해수욕장', lat: 35.1587, lng: 129.1604 }, { name: '밀면/집', lat: 35.17, lng: 129.17 });
  assert.equal(url, `https://map.kakao.com/link/from/${encodeURIComponent('해운대 해수욕장')},35.1587,129.1604/to/${encodeURIComponent('밀면 집')},35.17,129.17`);
  assert.match(kakaoDirectionsUrl({ name: ' , ', lat: 1, lng: 2 }, { name: '', lat: 3, lng: 4 }), /from\/%EC%B6%9C%EB%B0%9C,1,2\/to\/%EB%8F%84%EC%B0%A9,3,4$/);
});

test('날짜 필터 범위와 구간을 중점에서 나눈 화살표 선을 계산한다', () => {
  const routes = buildCourseRoutes(days, hotel);
  assert.equal(courseBoundsPoints(routes).length, 4 + 3);
  assert.deepEqual(courseBoundsPoints(routes, 2).map(point => point.name), ['바다 호텔', '광안리', '바다 호텔']);
  assert.deepEqual(courseBoundsPoints(routes, 9), []);
  const segments = courseLegSegments(routes[1]);
  const middle = { lat: (35.16 + 35.153) / 2, lng: (129.16 + 129.118) / 2 };
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0].map(([from, to]) => [from.name || 'mid', to.name || 'mid']), [['바다 호텔', 'mid'], ['mid', '광안리']]);
  assert.deepEqual(segments[0][0][1], middle);
  assert.equal(segments[0][1][0], segments[0][0][1]);
  // 같은 좌표끼리의 구간은 선을 그리지 않는다
  assert.equal(courseLegSegments({ legs: [{ from: { lat: 1, lng: 2 }, to: { lat: 1, lng: 2 } }] }).length, 0);
});

test('코스 지도 패널은 날짜 칩·직선 안내·접을 수 있는 구간별 길찾기를 그린다', () => {
  global.escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  try {
    const html = courseMapPanelHtml(buildCourseRoutes(days, { ...hotel, name: '<호텔>' }));
    assert.match(html, /data-course-day="all"[^>]*>전체<[\s\S]*data-course-day="1"[\s\S]*1일차[\s\S]*data-course-day="2"/);
    assert.match(html, /직선 연결은 방문 순서를 보여주는 선이에요\. 실제 길은 🧭 길찾기를 눌러 확인하세요\./);
    assert.match(html, /<details class="course-legs">[\s\S]*5구간/);
    assert.match(html, /🏠 &lt;호텔&gt; → 1-1 해운대, 해수욕장/);
    assert.doesNotMatch(html, /<호텔>/);
    // 하루짜리 코스는 날짜 칩을 그리지 않는다
    assert.doesNotMatch(courseMapPanelHtml(buildCourseRoutes(days.slice(0, 1), hotel)), /data-course-day/);
  } finally {
    delete global.escapeHtml;
  }
});

test('네이버 좌표 정규화: WGS84×10^7은 변환하고 빈 값·카텍 크기 값은 버린다', () => {
  assert.equal(normalizeCoordinate('1291604000', 180), '129.1604');
  assert.equal(normalizeCoordinate('351587000', 90), '35.1587');
  assert.equal(normalizeCoordinate('127.5', 180), '127.5');
  assert.equal(normalizeCoordinate('', 180), null);
  assert.equal(normalizeCoordinate(null, 90), null);
  assert.equal(normalizeCoordinate('310001', 180), null);
});

test('추천 카드는 연동 상태 배지 없이 코스 지도와 장소별 길찾기 링크를 보여준다', async () => {
  const root = path.join(__dirname, '..', 'public');
  const card = { innerHTML: '' };
  const elements = {};
  const response = {
    providerLabel: '네이버 지역검색',
    notices: [],
    integrationStatus: { tourApi: { connected: false }, kakaoLocal: { connected: false }, naverLocal: { configured: true, connected: true } },
    kakaoMap: { configured: true, javascriptKey: 'test-key' },
    preferences: [],
    customPreferences: [],
    itinerary: {
      nights: 2,
      planning: { travelerCount: 2, transportLabel: '대중교통·도보', accommodation: hotel, maxDistanceFromAccommodationKm: 12, seatWarning: null },
      days: days.map(day => ({ ...day, returnKmToAccommodation: day.dayNumber === 1 ? 1.2 : null, returnMinutesToAccommodation: 15, estimatedTravelKm: 4 })),
    },
    items: [],
  };
  const context = vm.createContext({
    document: {
      getElementById: () => null,
      querySelector: selector => selector === '#recommendationCard' ? card : (elements[selector] ||= { hidden: true, setAttribute() {} }),
      addEventListener() {},
    },
    fetch: async () => ({ ok: true, json: async () => response }),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/courseMap.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').replace(/init\(\);\s*$/, '') + ';state.roomId=10;', context);
  await vm.runInContext('loadRecommendations(10)', context);

  const html = card.innerHTML;
  assert.doesNotMatch(html, /integration-status|정보 반영|연결됨|키 필요/);
  assert.match(html, /class="source-note">방문 전 운영시간과 휴무일을 확인해주세요/);
  assert.doesNotMatch(html, /장소 정보 출처/);
  // 네이버 장소만 있어도 지도 버튼이 보이고 패널에 날짜 칩이 들어간다
  assert.match(html, /id="toggleCourseMapBtn"[\s\S]*id="courseMapPanel" hidden>[\s\S]*data-course-day="2"/);
  const itinerary = html.split('class="itinerary-days"')[1];
  // 좌표 있는 장소 3곳 + 1일차 숙소 복귀 = 길찾기 4개
  assert.equal(itinerary.match(/🧭 길찾기<\/a>/g).length, 4);
  assert.ok(itinerary.includes(`https://map.kakao.com/link/from/${encodeURIComponent('바다 호텔')},35.16,129.16/to/${encodeURIComponent('해운대 해수욕장')},35.1587,129.1604`));
  assert.match(itinerary, /<span>1-3 · 체험·핫플<\/span>/);
  assert.match(itinerary, /↩ 숙소 복귀[^<]*<a href="https:\/\/map\.kakao\.com\/link\/from\/[^"]+"[^>]*>🧭 길찾기<\/a>/);
});

test('코스 지도 스크립트는 app.js보다 먼저 로드되고 연동 상태 스타일은 남지 않는다', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(html.indexOf('/js/courseMap.js') > 0 && html.indexOf('/js/courseMap.js') < html.indexOf('/js/app.js'));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8'), /integration-status/);
});
