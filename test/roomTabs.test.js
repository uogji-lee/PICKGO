const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultRoomTab, bindRoomTabs } = require('../public/js/roomTabs');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('방 화면은 여행(준비·코스·정산·준비물)과 멤버 관리·회비·지난 여행 패널로 나뉜다', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8').replace(/init\(\);\s*$/, '');
  for (const status of ['planning', 'decided']) {
    const root = { innerHTML: '' };
    const room = { id: 10, activeTripId: 1, trip: { id: 1, title: '가을 여행' }, status, title: '테스트 모임', inviteCode: 'TEST12', selectedRegion: { name: '테스트 여행지' }, tripNights: 1 };
    const context = vm.createContext({
      document: { getElementById: () => root, querySelector: () => null, addEventListener() {} },
      skeletonCard: () => '',
      fetch: async () => ({ ok: true, json: async () => ({ room, members: [], tally: {}, bestDates: [], preferenceOptions: [], isHost: false }) }),
      bindRoomTabs: () => { throw new Error('tabs-initialized'); },
    });
    vm.runInContext(source + ';state.user={id:1};state.roomId=10;', context);
    await assert.rejects(vm.runInContext('renderRoomDetail()', context), /tabs-initialized/);
    const html = root.innerHTML;
    const section = key => html.split(`id="panel-${key}"`)[1].split('</section>')[0];
    assert.match(html, /data-room-top="trip"[\s\S]*data-room-top="members"[\s\S]*data-room-top="dues"[\s\S]*data-room-top="history"/);
    assert.match(html.split('id="tripSubnav"')[1], /가을 여행[\s\S]*data-room-tab="conditions"[\s\S]*data-room-tab="course"[\s\S]*data-room-tab="settle"[\s\S]*data-room-tab="packing"/);
    assert.match(section('conditions'), /id="preferenceGrid"/);
    assert.match(section('conditions'), /id="tripManagement"/);
    assert.match(section('settle'), /id="expenseOverview"[\s\S]*id="settleExpenses"[\s\S]*id="settleFinish"/);
    assert.match(section('dues'), /id="roomFinance"/);
    assert.match(section('members'), /id="memberAdmin"[\s\S]*id="kakaoSocialPanel"/);
    assert.match(section('history'), /id="pastTrips"[\s\S]*id="tripRecords"/);
    if (status === 'decided') assert.match(section('course'), /id="recommendationCard"/);
    assert.doesNotMatch(section('course'), /id="roomFinance"|id="preferenceGrid"/);
  }
});

test('여행지 결정 전은 준비, 결정 후는 코스를 기본으로 열고 같은 단계에서는 보던 탭을 유지한다', () => {
  assert.equal(defaultRoomTab({ activeTripId: null, status: 'planning' }), 'conditions');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'planning' }), 'conditions');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'decided' }, { phase: '1:planning', tab: 'conditions' }), 'course');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'decided' }, { phase: '1:decided', tab: 'settle' }), 'settle');
  // 단계가 바뀌면 여행 탭은 기본값으로, 방 전체 탭(회비 등)은 그대로
  assert.equal(defaultRoomTab({ activeTripId: 2, status: 'planning' }, { phase: '1:decided', tab: 'settle' }), 'conditions');
  assert.equal(defaultRoomTab({ activeTripId: null, status: 'planning' }, { phase: '1:decided', tab: 'dues' }), 'dues');
});

test('위 탭과 여행 안쪽 탭은 한 패널만 보여주고, 여행 탭을 다시 열면 마지막으로 본 여행 메뉴로 돌아간다', () => {
  const keys = ['conditions', 'course', 'settle', 'packing', 'members', 'dues', 'history'];
  const panels = Object.fromEntries(keys.map(key => ['panel-' + key, { hidden: true }]));
  const subnav = { hidden: true };
  const makeButton = dataset => ({ dataset, attrs: {}, getAttribute(key) { return this.attrs[key]; }, setAttribute(key, value) { this.attrs[key] = value; }, focus() { this.focused = true; } });
  const top = ['trip', 'members', 'dues', 'history'].map(key => makeButton({ roomTop: key }));
  const sub = ['conditions', 'course', 'settle', 'packing'].map(key => makeButton({ roomTab: key }));
  const link = { dataset: { goTab: 'conditions' } };
  global.document = {
    querySelectorAll: selector => selector === '[data-room-top]' ? top : selector === '[data-room-tab]' ? sub : [link],
    getElementById: id => id === 'tripSubnav' ? subnav : panels[id],
  };
  const visible = () => Object.entries(panels).filter(([, panel]) => !panel.hidden).map(([id]) => id);
  try {
    bindRoomTabs({ id: 91, activeTripId: 1, status: 'decided' });
    assert.deepEqual(visible(), ['panel-course']);
    assert.equal(subnav.hidden, false);
    assert.equal(top[0].attrs['aria-selected'], 'true');

    sub[2].onclick(); // 정산
    assert.deepEqual(visible(), ['panel-settle']);
    top[2].onclick(); // 회비
    assert.deepEqual(visible(), ['panel-dues']);
    assert.equal(subnav.hidden, true);
    assert.equal(sub.every(button => button.attrs['aria-selected'] === 'false'), true);
    top[0].onclick(); // 여행 → 마지막으로 본 정산으로 복귀
    assert.deepEqual(visible(), ['panel-settle']);

    let prevented = false;
    sub[2].onkeydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
    assert.ok(prevented && sub[3].focused);
    assert.deepEqual(visible(), ['panel-packing']);
    top[0].onkeydown({ key: 'ArrowRight', preventDefault() {} });
    assert.deepEqual(visible(), ['panel-members']);
    link.onclick();
    assert.deepEqual(visible(), ['panel-conditions']);
    assert.equal(sub[0].tabIndex, 0);
    assert.equal(sub[1].tabIndex, -1);
  } finally { delete global.document; }
});
