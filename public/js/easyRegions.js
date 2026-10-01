// 출발지 공유(카카오맵 위치 지정) + 원할 때만 보는 '가기 쉬운 여행지' 추천(참석자 중간지점 기준)
function formatTravelMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}시간${rest ? ` ${rest}분` : ''}` : `${rest}분`;
}

const easyToggleKey = roomId => `pickgo-easy-regions-${roomId}`;
function readEasyToggle(roomId) { try { return localStorage.getItem(easyToggleKey(roomId)) === '1'; } catch { return false; } }
function writeEasyToggle(roomId, on) { try { localStorage.setItem(easyToggleKey(roomId), on ? '1' : '0'); } catch { /* 저장 불가 환경 */ } }

// 지도에 멤버 이름표 표시
function addMemberChip(maps, map, position, text, extraClass = '') {
  const chip = document.createElement('div');
  chip.className = `map-chip ${extraClass}`;
  chip.textContent = text;
  return new maps.CustomOverlay({ map, position, content: chip, yAnchor: 1.8 });
}

async function setupOriginMap(me, tripMembers, mapKey, status) {
  const container = document.getElementById('originMap');
  if (!container) return null;
  let maps;
  try { maps = await loadKakaoMapsSdk(mapKey); }
  catch { container.innerHTML = '<p class="error-msg">카카오 지도를 불러오지 못했어요. 카카오 개발자 콘솔에 이 사이트 도메인이 등록됐는지 확인해주세요.</p>'; return null; }
  if (!container.isConnected) return null;
  const mine = me?.origin;
  const map = new maps.Map(container, { center: new maps.LatLng(mine?.lat ?? 36.4, mine?.lng ?? 127.9), level: mine ? 7 : 13 });
  for (const member of tripMembers) {
    if (!member.origin || member.id === me?.id) continue;
    const position = new maps.LatLng(member.origin.lat, member.origin.lng);
    new maps.Marker({ map, position, title: member.nickname });
    addMemberChip(maps, map, position, member.nickname);
  }
  const marker = new maps.Marker({ position: map.getCenter(), map: mine ? map : null });
  const geocoder = new maps.services.Geocoder();
  const places = new maps.services.Places();
  let picked = mine ? { ...mine } : null;
  const pick = (lat, lng, label) => {
    picked = { lat, lng, label };
    const position = new maps.LatLng(lat, lng);
    marker.setPosition(position);
    marker.setMap(map);
    map.panTo(position);
    document.getElementById('originPicked').textContent = `선택한 위치: ${label} · 저장을 눌러 공유하세요.`;
  };
  const addressOf = (lat, lng) => new Promise(resolve => geocoder.coord2Address(lng, lat, (result, code) => {
    resolve(code === maps.services.Status.OK ? (result[0].road_address?.address_name || result[0].address?.address_name) : '지도에서 고른 위치');
  }));
  maps.event.addListener(map, 'click', async event => {
    const lat = event.latLng.getLat(), lng = event.latLng.getLng();
    pick(lat, lng, await addressOf(lat, lng));
  });
  const results = document.getElementById('originResults');
  const search = () => {
    const query = document.getElementById('originQuery').value.trim();
    if (query.length < 2) { status('검색어를 2자 이상 입력해주세요.'); return; }
    places.keywordSearch(query, (data, code) => {
      results.replaceChildren();
      if (code !== maps.services.Status.OK) { status('검색 결과가 없어요. 다른 이름이나 주소로 찾아보세요.'); return; }
      status('');
      for (const place of data.slice(0, 5)) {
        const item = document.createElement('li');
        item.innerHTML = `<button type="button" class="ghost"><strong>${escapeHtml(place.place_name)}</strong><small>${escapeHtml(place.road_address_name || place.address_name)}</small></button>`;
        item.querySelector('button').onclick = () => { pick(Number(place.y), Number(place.x), place.place_name); results.replaceChildren(); };
        results.append(item);
      }
    });
  };
  document.getElementById('originSearchBtn').onclick = search;
  document.getElementById('originQuery').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); search(); } };
  return { getPicked: () => picked, pick, addressOf };
}

async function bindOriginForm(room, isHost, me, tripMembers, mapKey) {
  const form = document.getElementById('originForm');
  if (!form) return;
  const statusBox = document.getElementById('originStatus');
  const status = text => { statusBox.textContent = text; };
  const picker = mapKey ? await setupOriginMap(me, tripMembers, mapKey, status) : null;
  const save = async body => {
    const buttons = form.querySelectorAll('button');
    buttons.forEach(button => { button.disabled = true; });
    try {
      await api(`/rooms/${room.id}/origin`, { method: 'POST', body: { ...body, mode: form.elements.mode.value } });
      render();
    } catch (error) { status(error.message); buttons.forEach(button => { button.disabled = false; }); }
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (picker) {
      const picked = picker.getPicked();
      if (!picked) { status('지도를 누르거나 장소를 검색해서 출발 위치를 골라주세요.'); return; }
      save({ lat: picked.lat, lng: picked.lng, label: picked.label });
    } else {
      if (!form.elements.originId.value) { status('출발 지역을 선택해주세요.'); return; }
      save({ originId: form.elements.originId.value });
    }
  };
  const locate = document.getElementById('originLocate');
  if (!navigator.geolocation) { locate.hidden = true; return; }
  locate.onclick = () => {
    status('현재 위치를 확인하는 중…');
    navigator.geolocation.getCurrentPosition(async position => {
      const { latitude: lat, longitude: lng } = position.coords;
      if (picker) { picker.pick(lat, lng, await picker.addressOf(lat, lng)); status(''); }
      else save({ lat, lng, label: '내 현재 위치' });
    }, () => status('위치 권한이 없어 현재 위치를 확인하지 못했어요.'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  };
}

function bindEasyRegions(room, isHost, tripMembers, mapKey) {
  const toggle = document.getElementById('easyToggle');
  const root = document.getElementById('easyRegions');
  if (!toggle || !root) return;
  toggle.checked = readEasyToggle(room.id);
  const sync = () => {
    root.hidden = !toggle.checked;
    if (toggle.checked) loadEasyRegions(room, isHost, tripMembers, mapKey);
  };
  toggle.onchange = () => { writeEasyToggle(room.id, toggle.checked); sync(); };
  sync();
}

async function loadEasyRegions(room, isHost, tripMembers = [], mapKey = null) {
  const root = document.getElementById('easyRegions');
  if (!root) return;
  if (!root.children.length) root.innerHTML = '<p class="desc">중간지점을 계산하는 중…</p>';
  let data;
  try { data = await api(`/rooms/${room.id}/easy-regions`); }
  catch (error) { if (root.isConnected) root.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p>`; return; }
  if (!root.isConnected) return;
  if (!data.ranking.length) {
    root.innerHTML = '<p class="empty-state">아직 출발지를 공유한 참석자가 없어요. 위에서 출발지를 먼저 저장해주세요.</p>';
    return;
  }
  const longest = Math.max(...data.ranking.map(item => item.maxMinutes));
  root.innerHTML = `
    <p class="midpoint-label">📍 참석자 중간지점: <strong>${escapeHtml(data.midpoint.label)}</strong></p>
    ${mapKey ? '<div id="midpointMap" class="origin-map small"></div>' : ''}
    <p class="desc">${data.readyCount}/${data.travelerCount}명 기준${data.missing.length ? ` · 출발지 미입력: ${data.missing.map(escapeHtml).join(', ')}` : ''}</p>
    <ol class="easy-region-list">
      ${data.ranking.map((item, index) => `
        <li class="easy-region ${room.selectedRegion?.id === item.region.id ? 'chosen' : ''}">
          <div class="easy-region-head">
            <span class="easy-region-rank">${index + 1}</span>
            <strong>${escapeHtml(item.region.name)}</strong>
            <span class="easy-region-summary">중간지점에서 ${item.distanceFromMidpointKm}km · 평균 ${formatTravelMinutes(item.averageMinutes)} · 최대 ${formatTravelMinutes(item.maxMinutes)}</span>
          </div>
          <ul class="easy-region-legs">
            ${item.legs.map(leg => `
              <li>
                <span class="easy-leg-name">${escapeHtml(leg.nickname)}</span>
                <span class="easy-leg-bar" aria-hidden="true"><span style="width:${Math.max(4, Math.round(leg.minutes * 100 / longest))}%"></span></span>
                <span class="easy-leg-time">${formatTravelMinutes(leg.minutes)}</span>
                <small>${escapeHtml(leg.method)}</small>
              </li>`).join('')}
          </ul>
          ${isHost && room.activeTripId ? `<button class="secondary small" data-choose-region="${escapeHtml(item.region.id)}">${room.selectedRegion?.id === item.region.id ? '현재 여행지' : '이 지역으로 정하기'}</button>` : ''}
        </li>`).join('')}
    </ol>
    <p class="source-note">출발 위치의 평균(중간지점) 근처 여행지를 직선거리·도로 우회율·역/공항 환승 시간으로 추정한 이동 시간 기준으로 정렬했어요. 실제 시간은 교통 상황에 따라 달라요.</p>`;
  if (mapKey) {
    loadKakaoMapsSdk(mapKey).then(maps => {
      const container = document.getElementById('midpointMap');
      if (!container) return;
      const map = new maps.Map(container, { center: new maps.LatLng(data.midpoint.lat, data.midpoint.lng), level: 12 });
      const bounds = new maps.LatLngBounds();
      for (const member of tripMembers.filter(item => item.origin)) {
        const position = new maps.LatLng(member.origin.lat, member.origin.lng);
        bounds.extend(position);
        new maps.Marker({ map, position, title: member.nickname });
        addMemberChip(maps, map, position, member.nickname);
      }
      const center = new maps.LatLng(data.midpoint.lat, data.midpoint.lng);
      bounds.extend(center);
      addMemberChip(maps, map, center, '⭐ 중간지점', 'midpoint');
      map.setBounds(bounds);
    }).catch(() => {});
  }
  root.querySelectorAll('[data-choose-region]').forEach(button => {
    if (room.selectedRegion?.id === button.dataset.chooseRegion) { button.disabled = true; return; }
    button.onclick = async () => {
      const name = button.closest('.easy-region').querySelector('strong').textContent;
      if (!await confirmAction(`${name}을(를) 여행지로 정할까요?`)) return;
      button.disabled = true;
      try {
        await api(`/rooms/${room.id}/choose-region`, { method: 'POST', body: { regionId: button.dataset.chooseRegion } });
        roomTabState.delete(room.id);
        render();
      } catch (error) { showToast(error.message, 'error'); button.disabled = false; }
    };
  });
}
