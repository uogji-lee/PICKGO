// 멤버별 출발지·이동수단 저장 + 모두가 가기 쉬운 여행지 순위 표시
function formatTravelMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}시간${rest ? ` ${rest}분` : ''}` : `${rest}분`;
}

async function loadEasyRegions(room, isHost) {
  const root = document.getElementById('easyRegions');
  if (!root) return;
  root.innerHTML = '<p class="desc">가기 쉬운 여행지를 계산하는 중…</p>';
  let data;
  try { data = await api(`/rooms/${room.id}/easy-regions`); }
  catch (error) { if (root.isConnected) root.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p>`; return; }
  if (!root.isConnected) return;
  if (!data.ranking.length) {
    root.innerHTML = '<p class="empty-state">아직 출발지를 저장한 멤버가 없어요. 내 출발지와 이동수단을 먼저 저장해주세요.</p>';
    return;
  }
  const longest = Math.max(...data.ranking.map(item => item.maxMinutes));
  root.innerHTML = `
    <p class="desc">${data.readyCount}/${data.travelerCount}명 기준${data.missing.length ? ` · 미입력: ${data.missing.map(escapeHtml).join(', ')}` : ''}</p>
    <ol class="easy-region-list">
      ${data.ranking.map((item, index) => `
        <li class="easy-region ${room.selectedRegion?.id === item.region.id ? 'chosen' : ''}">
          <div class="easy-region-head">
            <span class="easy-region-rank">${index + 1}</span>
            <strong>${escapeHtml(item.region.name)}</strong>
            <span class="easy-region-summary">평균 ${formatTravelMinutes(item.averageMinutes)} · 최대 ${formatTravelMinutes(item.maxMinutes)}</span>
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
    <p class="source-note">직선거리에 도로 우회율·평균 속도·역/공항 환승 시간을 적용한 추정치예요. 실제 시간은 교통 상황과 배차에 따라 달라요.</p>`;
  root.querySelectorAll('[data-choose-region]').forEach(button => {
    if (room.selectedRegion?.id === button.dataset.chooseRegion) { button.disabled = true; return; }
    button.onclick = async () => {
      const name = button.closest('.easy-region').querySelector('strong').textContent;
      if (!await confirmAction(`${name}을(를) 여행지로 정할까요? 드레스코드는 추첨처럼 랜덤으로 정해져요.`)) return;
      button.disabled = true;
      try {
        await api(`/rooms/${room.id}/choose-region`, { method: 'POST', body: { regionId: button.dataset.chooseRegion } });
        roomTabState.delete(room.id);
        render();
      } catch (error) { alert(error.message); button.disabled = false; }
    };
  });
}

function bindOriginForm(room, isHost) {
  const form = document.getElementById('originForm');
  if (!form) return;
  const status = document.getElementById('originStatus');
  const save = async body => {
    const buttons = form.querySelectorAll('button');
    buttons.forEach(button => { button.disabled = true; });
    try {
      const result = await api(`/rooms/${room.id}/origin`, { method: 'POST', body });
      form.elements.originId.value = result.originId;
      status.textContent = `저장했어요: ${form.elements.originId.selectedOptions[0]?.textContent || ''}`;
      await loadEasyRegions(room, isHost);
    } catch (error) { status.textContent = error.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (!form.elements.originId.value) { status.textContent = '출발 지역을 선택해주세요.'; return; }
    save({ originId: form.elements.originId.value, mode: form.elements.mode.value });
  };
  const locate = document.getElementById('originLocate');
  if (!navigator.geolocation) { locate.hidden = true; return; }
  locate.onclick = () => {
    status.textContent = '현재 위치를 확인하는 중…';
    navigator.geolocation.getCurrentPosition(
      position => save({ lat: position.coords.latitude, lng: position.coords.longitude, mode: form.elements.mode.value }),
      () => { status.textContent = '위치 권한이 없어 현재 위치를 확인하지 못했어요. 목록에서 선택해주세요.'; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };
}
