const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultRoomTab, bindRoomTabs } = require('../public/js/roomTabs');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('방 렌더링은 조건·회비·멤버를 별도 패널에 배치하고 탭 초기화까지 실행한다', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8').replace(/init\(\);\s*$/, '');
  for (const status of ['planning', 'decided']) {
    const root = { innerHTML: '' };
    const room = { id: 10, activeTripId: 1, status, title: '테스트 모임', inviteCode: 'TEST12', selectedRegion: { name: '테스트 여행지' }, tripNights: 1 };
    const context = vm.createContext({
      document: { getElementById: () => root, querySelector: () => null },
      fetch: async () => ({ ok: true, json: async () => ({ room, members: [], tally: {}, bestDates: [], preferenceOptions: [], isHost: false }) }),
      bindRoomTabs: () => { throw new Error('tabs-initialized'); },
    });
    vm.runInContext(source + ';state.user={id:1};state.roomId=10;', context);
    await assert.rejects(vm.runInContext('renderRoomDetail()', context), /tabs-initialized/);
    const html = root.innerHTML;
    const section = key => html.split(`id="panel-${key}"`)[1].split('</section>')[0];
    assert.match(section('finance'), /id="roomFinance"/);
    assert.match(section('conditions'), /id="preferenceGrid"/);
    assert.match(section('members'), /id="kakaoSocialPanel"/);
    assert.match(section('course'), /id="tripManagement"/);
    if (status === 'decided') assert.match(section('course'), /id="recommendationCard"/);
    assert.doesNotMatch(section('course'), /id="roomFinance"|id="preferenceGrid"/);
  }
});
test('추첨 전 조건·추첨 후 코스를 기본 표시하며 같은 여행에서는 선택 탭을 유지한다', () => {
  assert.equal(defaultRoomTab({ activeTripId: null, status: 'planning' }), 'course');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'planning' }), 'conditions');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'decided' }, { phase: '1:planning', tab: 'conditions' }), 'course');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'decided' }, { phase: '1:decided', tab: 'finance' }), 'finance');
  assert.equal(defaultRoomTab({ activeTripId: 2, status: 'planning' }, { phase: '1:decided', tab: 'finance' }), 'conditions');
});
test('탭 클릭·방향키·이동 버튼은 한 패널만 표시하고 포커스와 선택 상태를 갱신한다', () => {
  const panels = Object.fromEntries(['course', 'conditions', 'finance', 'members'].map(key => ['panel-' + key, { hidden: true }]));
  const buttons = Object.keys(panels).map(id => ({
    dataset: { roomTab: id.slice(6) }, attrs: { 'aria-controls': id },
    getAttribute(key) { return this.attrs[key]; }, setAttribute(key, value) { this.attrs[key] = value; }, focus() { this.focused = true; },
  }));
  const link = { dataset: { goTab: 'conditions' } };
  global.document = { querySelectorAll: selector => selector === '[data-room-tab]' ? buttons : [link], getElementById: id => panels[id] };
  try {
    bindRoomTabs({ id: 90, activeTripId: 1, status: 'decided' });
    assert.equal(panels['panel-course'].hidden, false);
    buttons[2].onclick();
    assert.equal(buttons[2].attrs['aria-selected'], 'true');
    assert.equal(Object.values(panels).filter(panel => !panel.hidden).length, 1);
    let prevented = false;
    buttons[2].onkeydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
    assert.ok(prevented && buttons[3].focused);
    assert.equal(panels['panel-members'].hidden, false);
    link.onclick();
    assert.equal(panels['panel-conditions'].hidden, false);
    assert.equal(buttons[1].tabIndex, 0);
    assert.equal(buttons[3].tabIndex, -1);
  } finally { delete global.document; }
});
