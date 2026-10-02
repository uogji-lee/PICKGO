// 방 화면 탭: 위쪽(여행 · 멤버 관리 · 회비 · 지난 여행) + 여행 안쪽(장소 · 준비 · 코스 · 정산 · 준비물)
const roomTabState = new Map();
const TRIP_TABS = ['place', 'conditions', 'course', 'settle', 'packing'];
const topOf = tab => (TRIP_TABS.includes(tab) ? 'trip' : tab);

function defaultRoomTab(room, previous) {
  const phase = `${room.activeTripId || 'none'}:${room.status}`;
  if (previous?.phase === phase) return previous.tab;
  // 여행이 끝나 단계가 바뀌어도 방 전체 탭(회비·멤버·지난 여행)을 보고 있었다면 유지
  if (previous && !TRIP_TABS.includes(previous.tab)) return previous.tab;
  // 여행지가 정해지기 전에는 장소(참석·날짜·출발지·여행지), 정해지면 준비(숙소·교통·취향·드레스코드)
  return room.activeTripId && room.status === 'decided' ? 'conditions' : 'place';
}

// options.initialTab: 뒤로가기로 돌아왔을 때 열 탭, options.onChange(tab, userInitiated): 탭이 바뀔 때 알림(방문 기록·스크롤)
function bindRoomTabs(room, options = {}) {
  const topButtons = [...document.querySelectorAll('[data-room-top]')];
  const subButtons = [...document.querySelectorAll('[data-room-tab]')];
  const subnav = document.getElementById('tripSubnav');
  const phase = `${room.activeTripId || 'none'}:${room.status}`;
  let lastTripTab = TRIP_TABS.includes(roomTabState.get(room.id)?.tab) ? roomTabState.get(room.id).tab : null;

  let currentTab = null;
  function activate(tab, focus = false, userInitiated = false) {
    if (![...topButtons.map(button => button.dataset.roomTop), ...subButtons.map(button => button.dataset.roomTab)].includes(tab) || tab === 'trip') return;
    const changed = tab !== currentTab;
    currentTab = tab;
    roomTabState.set(room.id, { phase, tab });
    if (TRIP_TABS.includes(tab)) lastTripTab = tab;
    const top = topOf(tab);
    for (const button of topButtons) {
      const selected = button.dataset.roomTop === top;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus && top !== 'trip') button.focus();
    }
    if (subnav) subnav.hidden = top !== 'trip';
    for (const button of subButtons) {
      const selected = button.dataset.roomTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    for (const key of [...TRIP_TABS, ...topButtons.map(button => button.dataset.roomTop).filter(key => key !== 'trip')]) {
      const panel = document.getElementById(`panel-${key}`);
      if (!panel) continue;
      const wasHidden = panel.hidden;
      panel.hidden = key !== tab;
      // 숨어 있을 때 만든 지도처럼 크기를 다시 맞춰야 하는 내용에 알림
      if (wasHidden && !panel.hidden) panel.dispatchEvent(new Event('tabshow'));
    }
    if (changed && options.onChange) options.onChange(tab, userInitiated);
  }
  const openTop = (top, focus = false) => activate(top === 'trip' ? (lastTripTab || defaultRoomTab(room, null)) : top, focus, true);

  function arrowKeys(buttons, key, onSelect) {
    buttons.forEach((button, index) => {
      button.onkeydown = event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
          : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        onSelect(buttons[next].dataset[key], true);
      };
    });
  }
  topButtons.forEach(button => { button.onclick = () => openTop(button.dataset.roomTop); });
  subButtons.forEach(button => { button.onclick = () => activate(button.dataset.roomTab, false, true); });
  arrowKeys(topButtons, 'roomTop', openTop);
  arrowKeys(subButtons, 'roomTab', (tab, focus) => activate(tab, focus, true));
  document.querySelectorAll('[data-go-tab]').forEach(button => {
    button.onclick = () => activate(button.dataset.goTab, true, true);
  });
  const initial = options.initialTab && [...topButtons.map(button => button.dataset.roomTop), ...subButtons.map(button => button.dataset.roomTab)].includes(options.initialTab)
    ? options.initialTab : defaultRoomTab(room, roomTabState.get(room.id));
  activate(initial);
  // 뒤로가기로 같은 방 안에서 탭만 바꿀 때 사용
  return tab => activate(tab, false, false);
}
if (typeof module !== 'undefined') module.exports = { defaultRoomTab, bindRoomTabs, TRIP_TABS };
