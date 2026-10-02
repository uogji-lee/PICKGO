// 추천 코스 지도: 좌표 정리 · 날짜별 경로 · 카카오맵 길찾기 링크(순수 함수, node 테스트 가능) + 카카오 지도 그리기
const COURSE_DAY_COLORS = ['#e8590c', '#3b5bdb', '#0b7285', '#7048e8', '#c2255c', '#2b8a3e', '#9c5b00', '#495057'];

function courseDayColor(dayNumber) {
  const index = Math.max(Math.trunc(Number(dayNumber)) || 1, 1) - 1;
  return COURSE_DAY_COLORS[index % COURSE_DAY_COLORS.length];
}

// 출처(카카오·관광공사·네이버 등)와 무관하게 유효한 WGS84 경도(mapX)/위도(mapY)가 있으면 지도에 쓴다
function coursePoint(place) {
  if (!place || [place.mapX, place.mapY].some(value => value === null || value === undefined || String(value).trim() === '')) return null;
  const lng = Number(place.mapX);
  const lat = Number(place.mapY);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (!lat && !lng)) return null;
  return { lat, lng, name: String(place.name || '').trim(), address: String(place.address || '').trim() };
}

// 카카오맵 길찾기 링크 — 이름의 쉼표·슬래시는 링크 구분자와 겹치므로 지운다
function kakaoDirectionsUrl(from, to) {
  const part = (point, fallback) => {
    const name = String(point.name || '').replace(/[,/]/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
    return `${encodeURIComponent(name)},${point.lat},${point.lng}`;
  };
  return `https://map.kakao.com/link/from/${part(from, '출발')}/to/${part(to, '도착')}`;
}

// 날짜별 경로: (숙소 →) 좌표 있는 장소들 방문 순서대로 (→ 숙소). 구간마다 길찾기 링크를 붙인다.
function buildCourseRoutes(itineraryDays, accommodation) {
  const homePoint = coursePoint(accommodation);
  const home = homePoint && { ...homePoint, name: homePoint.name || '숙소', home: true };
  return (itineraryDays || []).map(day => {
    const stops = (day.stops || []).map((stop, index) => {
      const point = coursePoint(stop.place);
      return point && {
        ...point, name: point.name || '장소', dayNumber: day.dayNumber, index,
        label: `${day.dayNumber}-${index + 1}`, time: stop.time || '', title: stop.title || '',
      };
    }).filter(Boolean);
    if (!stops.length) return null;
    const path = home ? [home, ...stops, home] : stops;
    const legs = path.slice(1).map((to, i) => ({
      from: path[i], to, stopIndex: to.home ? null : to.index, url: kakaoDirectionsUrl(path[i], to),
    }));
    return { dayNumber: day.dayNumber, color: courseDayColor(day.dayNumber), home, stops, path, legs };
  }).filter(Boolean);
}

// 일정 목록의 장소로 들어오는 구간(stopIndex null이면 숙소 복귀 구간)
function courseLegFor(routes, dayNumber, stopIndex = null) {
  const route = routes.find(item => item.dayNumber === dayNumber);
  return route?.legs.find(leg => leg.stopIndex === stopIndex) || null;
}

// 선택한 날짜(null이면 전체)를 화면에 맞출 점들
function courseBoundsPoints(routes, dayNumber = null) {
  return routes.filter(route => dayNumber === null || route.dayNumber === dayNumber).flatMap(route => route.path);
}

// 구간을 중점에서 둘로 나눈다: 앞 절반 끝에 방향 화살표를 단다(끝점 화살표는 마커에 가려지므로).
function courseLegSegments(route) {
  return route.legs
    .filter(leg => leg.from.lat !== leg.to.lat || leg.from.lng !== leg.to.lng)
    .map(leg => {
      const middle = { lat: (leg.from.lat + leg.to.lat) / 2, lng: (leg.from.lng + leg.to.lng) / 2 };
      return [[leg.from, middle], [middle, leg.to]];
    });
}

const courseStopName = point => point.home ? `🏠 ${point.name}` : `${point.label} ${point.name}`;

function courseDirectionsLinkHtml(leg, text = '🧭 길찾기') {
  return `<a href="${escapeHtml(leg.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${leg.from.name} → ${leg.to.name} 카카오맵 길찾기`)}">${escapeHtml(text)}</a>`;
}

function courseMapPanelHtml(routes) {
  const dot = color => `<i class="course-day-dot" style="background:${color}"></i>`;
  const legCount = routes.reduce((sum, route) => sum + route.legs.length, 0);
  return `
    ${routes.length > 1 ? `
      <div class="course-map-filter" role="group" aria-label="날짜별 코스 보기">
        <button type="button" class="active" data-course-day="all" aria-pressed="true">전체</button>
        ${routes.map(route => `<button type="button" data-course-day="${route.dayNumber}" aria-pressed="false">${dot(route.color)}${route.dayNumber}일차</button>`).join('')}
      </div>` : ''}
    <div class="course-map"></div>
    <p class="course-map-note">직선 연결은 방문 순서를 보여주는 선이에요. 실제 길은 🧭 길찾기를 눌러 확인하세요.</p>
    ${legCount ? `
      <details class="course-legs">
        <summary>🧭 구간별 길찾기 <span>${legCount}구간</span></summary>
        ${routes.map(route => `
          <div class="course-legs-day" data-course-legs-day="${route.dayNumber}">
            <strong>${dot(route.color)}${route.dayNumber}일차</strong>
            <ol>${route.legs.map(leg => `<li>${courseDirectionsLinkHtml(leg, `${courseStopName(leg.from)} → ${courseStopName(leg.to)}`)}</li>`).join('')}</ol>
          </div>`).join('')}
      </details>` : ''}`;
}

// panel 안의 .course-map에 지도를 그리고, 날짜 칩·말풍선을 연결한다. 다시 펼칠 때 쓸 refit을 돌려준다.
async function renderKakaoCourseMap(panel, routes, javascriptKey) {
  const maps = await loadKakaoMapsSdk(javascriptKey);
  const mapEl = panel.querySelector('.course-map');
  const first = routes[0]?.path[0];
  if (!first) throw new Error('카카오 지도에 표시할 좌표가 없습니다.');
  mapEl.innerHTML = '';
  const position = point => new maps.LatLng(point.lat, point.lng);
  const map = new maps.Map(mapEl, { center: position(first), level: 7 });

  let bubble = null;
  const closeBubble = () => { bubble?.setMap(null); bubble = null; };
  const openBubble = (point, meta, leg) => {
    closeBubble();
    const box = document.createElement('div');
    box.className = 'course-map-bubble';
    box.innerHTML = `
      <button type="button" aria-label="닫기">×</button>
      <strong>${escapeHtml(point.name)}</strong>
      ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
      ${point.address ? `<small>${escapeHtml(point.address)}</small>` : ''}
      ${leg ? courseDirectionsLinkHtml(leg) : ''}`;
    box.querySelector('button').onclick = closeBubble;
    bubble = new maps.CustomOverlay({ map, position: position(point), content: box, yAnchor: 1, zIndex: 10, clickable: true });
  };
  maps.event.addListener(map, 'click', closeBubble);

  const markerOverlay = (point, className, text, onClick, zIndex) => {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = className;
    marker.textContent = text;
    marker.setAttribute('aria-label', `${text} ${point.name}`);
    marker.onclick = onClick;
    return { marker, overlay: new maps.CustomOverlay({ map, position: position(point), content: marker, zIndex, clickable: true }) };
  };

  const layers = routes.map(route => {
    const overlays = route.stops.map(stop => {
      const { marker, overlay } = markerOverlay(stop, 'course-map-marker', stop.label, () => openBubble(
        stop, `${stop.dayNumber}일차 ${[stop.time, stop.title].filter(Boolean).join(' · ')}`, courseLegFor(routes, route.dayNumber, stop.index),
      ), 3);
      marker.style.borderColor = route.color;
      return overlay;
    });
    const lines = courseLegSegments(route).flatMap(([head, tail]) => [[head, true], [tail, false]].map(([segment, endArrow]) => new maps.Polyline({
      map, path: segment.map(position), strokeWeight: 5, strokeColor: route.color, strokeOpacity: 0.85, strokeStyle: 'solid', endArrow,
    })));
    return { dayNumber: route.dayNumber, items: [...overlays, ...lines] };
  });
  const home = routes[0].home;
  if (home) markerOverlay(home, 'course-map-home', '🏠', () => openBubble(home, '숙소', null), 4);

  const chips = [...panel.querySelectorAll('[data-course-day]')];
  const legGroups = [...panel.querySelectorAll('[data-course-legs-day]')];
  let selectedDay = null;
  const refit = () => {
    map.relayout();
    const points = courseBoundsPoints(routes, selectedDay);
    if (points.length === 1) {
      map.setLevel(4);
      map.setCenter(position(points[0]));
      return;
    }
    const bounds = new maps.LatLngBounds();
    points.forEach(point => bounds.extend(position(point)));
    map.setBounds(bounds, 48, 32, 32, 32);
  };
  const select = dayNumber => {
    selectedDay = dayNumber;
    closeBubble();
    for (const layer of layers) {
      const target = dayNumber === null || layer.dayNumber === dayNumber ? map : null;
      layer.items.forEach(item => item.setMap(target));
    }
    chips.forEach(chip => {
      const active = chip.dataset.courseDay === String(dayNumber ?? 'all');
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
    legGroups.forEach(group => { group.hidden = dayNumber !== null && group.dataset.courseLegsDay !== String(dayNumber); });
    refit();
  };
  chips.forEach(chip => { chip.onclick = () => select(chip.dataset.courseDay === 'all' ? null : Number(chip.dataset.courseDay)); });
  select(null);
  return { refit };
}

if (typeof module !== 'undefined') {
  module.exports = {
    COURSE_DAY_COLORS, courseDayColor, coursePoint, kakaoDirectionsUrl, buildCourseRoutes,
    courseLegFor, courseBoundsPoints, courseLegSegments, courseMapPanelHtml,
  };
}
