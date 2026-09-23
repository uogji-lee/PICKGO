const roomTabState = new Map();
function defaultRoomTab(room, previous) {
  const phase = `${room.activeTripId || 'none'}:${room.status}`;
  if (previous?.phase === phase) return previous.tab;
  if (!room.activeTripId && previous?.tab === 'finance') return 'finance';
  return room.activeTripId && room.status === 'decided' ? 'course' : 'conditions';
}
function bindRoomTabs(room) {
  const buttons = [...document.querySelectorAll('[data-room-tab]')];
  const phase = `${room.activeTripId || 'none'}:${room.status}`;
  function activate(tab, focus = false) {
    if (!buttons.some(button => button.dataset.roomTab === tab)) return;
    roomTabState.set(room.id, { phase, tab });
    for (const button of buttons) {
      const selected = button.dataset.roomTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) button.focus();
    }
  }
  buttons.forEach((button, index) => {
    button.onclick = () => activate(button.dataset.roomTab);
    button.onkeydown = event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); activate(buttons[next].dataset.roomTab, true);
    };
  });
  document.querySelectorAll('[data-go-tab]').forEach(button => {
    button.onclick = () => activate(button.dataset.goTab, true);
  });
  activate(defaultRoomTab(room, roomTabState.get(room.id)));
}
if (typeof module !== 'undefined') module.exports = { defaultRoomTab, bindRoomTabs };
