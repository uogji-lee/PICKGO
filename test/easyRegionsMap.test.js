const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// 카카오 지도 SDK 흉내: 지도 크기 재계산·중심·범위 호출만 기록
function fakeKakaoMaps(calls) {
  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
  class KakaoMap {
    constructor(container, { center }) { this.center = center; calls.push(['create', container.id]); }
    getCenter() { return this.center; }
    setCenter(center) { this.center = center; calls.push(['center', center.lat, center.lng]); }
    panTo(center) { this.center = center; }
    relayout() { calls.push(['relayout']); }
    setBounds(bounds) { calls.push(['bounds', bounds.points.length]); }
  }
  class Marker {
    constructor({ position, map }) { this.position = position; this.map = map; }
    setPosition(position) { this.position = position; }
    getPosition() { return this.position; }
    setMap(map) { this.map = map; }
  }
  class LatLngBounds { constructor() { this.points = []; } extend(point) { this.points.push(point); } }
  return {
    LatLng, Map: KakaoMap, Marker, LatLngBounds, CustomOverlay: class {},
    event: { addListener() {} },
    services: { Geocoder: class {}, Places: class {}, Status: { OK: 'OK' } },
  };
}

function loadEasyRegionsScript(elements, calls, responses = {}) {
  const context = vm.createContext({
    document: { getElementById: id => elements[id] || null, createElement: () => ({}) },
    loadKakaoMapsSdk: async () => fakeKakaoMaps(calls),
    api: async url => responses[url],
    escapeHtml: value => String(value),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/easyRegions.js'), 'utf8'), context);
  return context;
}

// 장소 탭 패널(tabshow)과 접는 카드(toggle) 안에 있는 지도 칸
function mapContainer(id) {
  const panel = new EventTarget();
  const details = Object.assign(new EventTarget(), { open: true });
  const container = { id, isConnected: true, closest: selector => (selector === '[role="tabpanel"]' ? panel : selector === 'details' ? details : null) };
  return { panel, details, container };
}

test('숨은 장소 탭에서 만든 출발지 지도는 탭이나 카드가 다시 보일 때 크기와 중심(고른 위치)을 다시 맞춘다', async () => {
  const calls = [];
  const { panel, details, container } = mapContainer('originMap');
  const elements = {
    originMap: container, originPicked: { textContent: '' }, originResults: { replaceChildren() {} },
    originSearchBtn: {}, originQuery: {},
  };
  const context = loadEasyRegionsScript(elements, calls);
  const me = { id: 1, origin: { lat: 35.1, lng: 129.0, label: '부산역' } };
  const picker = await context.setupOriginMap(me, [], 'map-key', () => {});
  assert.deepEqual(calls, [['create', 'originMap']]);

  calls.length = 0;
  panel.dispatchEvent(new Event('tabshow'));
  assert.deepEqual(calls, [['relayout'], ['center', 35.1, 129.0]]);

  // 새로 고른 위치가 있으면 그 위치로 맞춤
  picker.pick(37.5, 127.0, '강남역');
  calls.length = 0;
  panel.dispatchEvent(new Event('tabshow'));
  assert.deepEqual(calls, [['relayout'], ['center', 37.5, 127.0]]);

  // 접힌 카드를 펼칠 때만 맞추고, 접을 때는 그대로
  calls.length = 0;
  details.open = false;
  details.dispatchEvent(new Event('toggle'));
  assert.deepEqual(calls, []);
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  assert.deepEqual(calls, [['relayout'], ['center', 37.5, 127.0]]);

  // 다시 그려져 화면에서 빠진 지도는 건드리지 않음
  calls.length = 0;
  container.isConnected = false;
  panel.dispatchEvent(new Event('tabshow'));
  assert.deepEqual(calls, []);
});

test('가기 쉬운 여행지의 중간지점 지도도 장소 탭이 다시 보일 때 크기와 범위를 다시 맞춘다', async () => {
  const calls = [];
  const { panel, container } = mapContainer('midpointMap');
  const item = { region: { id: 'gyeongju', name: '경북 경주시' }, averageMinutes: 90, maxMinutes: 90, distanceFromMidpointKm: 3, legs: [{ nickname: '서울러', minutes: 90, method: '대중교통' }] };
  const root = { innerHTML: '', isConnected: true, children: [], querySelectorAll: () => [] };
  const context = loadEasyRegionsScript({ easyRegions: root, midpointMap: container }, calls, {
    '/rooms/10/easy-regions': { midpoint: { label: '대전 근처', lat: 36.3, lng: 127.4 }, ranking: [item], readyCount: 1, travelerCount: 1, missing: [] },
  });
  const tripMembers = [{ id: 1, nickname: '서울러', origin: { lat: 37.5, lng: 127.0 } }];
  await context.loadEasyRegions({ id: 10, activeTripId: 1, selectedRegion: null }, false, tripMembers, 'map-key');
  await new Promise(resolve => setImmediate(resolve)); // 지도 SDK를 불러온 뒤 그리는 부분까지 기다림
  assert.match(root.innerHTML, /id="midpointMap"/);
  assert.deepEqual(calls, [['create', 'midpointMap'], ['bounds', 2]]);

  calls.length = 0;
  panel.dispatchEvent(new Event('tabshow'));
  assert.deepEqual(calls, [['relayout'], ['bounds', 2]]);
});
