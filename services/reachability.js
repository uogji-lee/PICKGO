// 멤버별 출발지·이동수단으로 각 여행지까지 걸리는 시간을 추정하고, 모두가 가기 쉬운 지역을 순위로 매깁니다.
// 실시간 길찾기 API 대신 직선거리에 도로 우회율·평균 속도·환승 시간을 곱한 근사치라 "비교용"으로만 사용합니다.
const { REGION_COORDS, ORIGINS, RAIL_HUBS, AIRPORTS, JEJU_AIRPORT } = require('../data/travelGeo');

const MODES = { car: '자가용', public: '대중교통' };
const originById = new Map(ORIGINS.map(origin => [origin.id, origin]));

function normalizeOriginId(value) {
  return originById.has(String(value)) ? String(value) : null;
}
function normalizeMode(value) {
  return Object.hasOwn(MODES, value) ? value : null;
}

function distanceKm(a, b) {
  const toRad = degree => degree * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const isJeju = point => point.lat < 34;
const nearest = (list, point) => list.reduce((best, item) => (distanceKm(item, point) < distanceKm(best, point) ? item : best));

// 자가용: 도로 거리 = 직선 × 1.2, 시내 구간 20km는 시속 30km, 나머지는 시속 90km, 출발·주차 10분
function carMinutes(km) {
  const road = km * 1.2;
  return 10 + road * 60 / 90 + Math.min(road, 20) * (60 / 30 - 60 / 90);
}

// 시내 대중교통(지하철·시내버스)과 고속·시외버스 중 빠른 쪽
function localPublic(km) {
  const urban = 15 + km * 1.3 / 28 * 60;
  const bus = 35 + km * 1.25 / 85 * 60;
  return urban <= bus ? { minutes: urban, method: '대중교통' } : { minutes: bus, method: '고속·시외버스' };
}

// 가장 가까운 역까지 이동 → 기차 → 도착역에서 목적지까지 이동
function railTrip(from, to) {
  const departHub = nearest(RAIL_HUBS, from);
  const arriveHub = nearest(RAIL_HUBS, to);
  if (departHub === arriveHub) return null;
  const ride = distanceKm(departHub, arriveHub) * 1.05 / Math.min(departHub.speed, arriveHub.speed) * 60;
  const minutes = localPublic(distanceKm(from, departHub)).minutes + 15 + ride + localPublic(distanceKm(arriveHub, to)).minutes;
  return { minutes, method: `기차 (${departHub.name}→${arriveHub.name})` };
}

function groundTrip(from, to, mode) {
  const km = distanceKm(from, to);
  if (mode === 'car') return { minutes: carMinutes(km), method: '자가용' };
  const bus = localPublic(km);
  const rail = railTrip(from, to);
  return rail && rail.minutes < bus.minutes ? rail : bus;
}

// 제주 ↔ 육지는 항공편: 공항까지 이동 + 탑승 수속 60분 + 비행 60분 + 도착 후 20분 + 제주 내 이동
function flightTrip(from, to, mode) {
  const mainland = isJeju(from) ? to : from;
  const island = isJeju(from) ? from : to;
  const airport = AIRPORTS.reduce((best, item) => {
    const minutes = groundTrip(mainland, item, mode).minutes;
    return !best || minutes < best.minutes ? { airport: item, minutes } : best;
  }, null);
  const islandMinutes = groundTrip(JEJU_AIRPORT, island, mode).minutes + (mode === 'car' ? 20 : 0);
  return {
    minutes: airport.minutes + 60 + 60 + 20 + islandMinutes,
    method: `항공 (${airport.airport.name}↔제주공항${mode === 'car' ? ', 제주 렌터카' : ''})`,
  };
}

function estimateTrip(from, to, mode) {
  const trip = isJeju(from) !== isJeju(to) ? flightTrip(from, to, mode) : groundTrip(from, to, mode);
  return {
    minutes: Math.max(5, Math.round(trip.minutes / 5) * 5),
    method: trip.method,
    distanceKm: Math.round(distanceKm(from, to)),
  };
}

// travelers: [{ userId, nickname, originId, mode }] — 출발지·이동수단이 모두 있는 멤버만 계산에 포함
function rankRegions(travelers, regions) {
  const ready = travelers.filter(traveler => originById.has(traveler.originId) && normalizeMode(traveler.mode));
  if (!ready.length) return [];
  return regions.filter(region => REGION_COORDS[region.id]).map(region => {
    const [lat, lng] = REGION_COORDS[region.id];
    const legs = ready.map(traveler => ({
      userId: traveler.userId,
      nickname: traveler.nickname,
      mode: traveler.mode,
      ...estimateTrip(originById.get(traveler.originId), { lat, lng }, traveler.mode),
    }));
    const minutes = legs.map(leg => leg.minutes);
    const averageMinutes = Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length);
    const maxMinutes = Math.max(...minutes);
    const minMinutes = Math.min(...minutes);
    // 평균이 짧아도 한 명만 유독 멀면 불공평하므로 가장 오래 걸리는 사람의 시간도 함께 반영
    const score = Math.round(averageMinutes * 0.7 + maxMinutes * 0.3);
    return { region: { id: region.id, name: region.name }, averageMinutes, maxMinutes, spreadMinutes: maxMinutes - minMinutes, score, legs };
  }).sort((a, b) => a.score - b.score || a.spreadMinutes - b.spreadMinutes || a.region.name.localeCompare(b.region.name, 'ko'));
}

function nearestOriginId(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const origin = nearest(ORIGINS, { lat, lng });
  return distanceKm(origin, { lat, lng }) <= 80 ? origin.id : null;
}

module.exports = {
  MODES,
  ORIGINS,
  distanceKm,
  estimateTrip,
  nearestOriginId,
  normalizeMode,
  normalizeOriginId,
  originById,
  rankRegions,
};
