const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultRoomTab, bindRoomTabs } = require('../public/js/roomTabs');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('방 화면은 여행(장소·준비·코스·정산·준비물)과 멤버 관리·회비·지난 여행 패널로 나뉜다', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8').replace(/init\(\);\s*$/, '');
  for (const [activeTripId, status] of [[1, 'planning'], [1, 'decided'], [null, 'planning']]) {
    const root = { innerHTML: '' };
    const room = { id: 10, activeTripId, trip: activeTripId ? { id: 1, title: '가을 여행' } : null, status, title: '테스트 모임', inviteCode: 'TEST12', selectedRegion: { name: '테스트 & 여행지' }, tripNights: 1 };
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
    assert.match(html.split('id="tripSubnav"')[1], /data-room-tab="place"[^>]*>장소<[\s\S]*data-room-tab="conditions"[^>]*>준비<[\s\S]*data-room-tab="course"[\s\S]*data-room-tab="settle"[\s\S]*data-room-tab="packing"/);
    assert.match(html.split('id="tripSubnav"')[1], activeTripId ? /가을 여행/ : /진행 중인 여행이 없어요[\s\S]*장소 탭에서 새 여행/);
    // 장소: 여행 정보·참석자 → 날짜 → 출발지 → 여행지 정하기 → 참고: 가기 쉬운 여행지
    assert.match(section('place'), /id="tripManagement"[\s\S]*id="calendarGrid"[\s\S]*id="originForm"[\s\S]*id="destinationPanel"[\s\S]*id="easyToggle"/);
    assert.doesNotMatch(section('place'), /id="lodgingPanel"|id="preferenceGrid"|교통 조건|드레스 코드/);
    // 준비: 숙소 → 교통 → 취향 → 드레스코드
    assert.match(section('conditions'), /id="lodgingPanel"[\s\S]*🚗 교통 조건[\s\S]*id="preferenceGrid"[\s\S]*👗 드레스 코드/);
    assert.doesNotMatch(section('conditions'), /id="tripManagement"|id="calendarGrid"|id="originForm"|id="destinationPanel"/);
    // 진행 중 여행이 없으면 장소의 여행 정보 카드(새 여행 만들기)만 보이고 나머지 카드는 숨김
    assert.match(section('place'), /id="tripManagement"[^<]*<\/div><\/div>/);
    assert.equal(section('place').match(/<div (hidden)?>\s*<details[^>]*>\s*<summary><h2>📅/)[1], activeTripId ? undefined : 'hidden');
    assert.equal(section('conditions').match(/<div (hidden)?>\s*<details[^>]*>\s*<summary><h2>🏠/)[1], activeTripId ? undefined : 'hidden');
    // 여행지 결정 전에는 준비·코스 안내가 장소로, 결정 후에는 코스 안내가 준비로 이어진다
    if (status === 'decided') {
      // 준비 탭 맨 위에 정해진 여행지와 코스 보기 버튼
      assert.match(section('conditions'), /🎉 여행지: <strong>테스트 &amp; 여행지<\/strong>[\s\S]*data-go-tab="course"[^>]*>코스 보기<[\s\S]*id="lodgingPanel"/);
      assert.doesNotMatch(section('conditions'), /data-go-tab="place"/);
      assert.match(section('course'), /id="recommendationCard"[\s\S]*data-go-tab="conditions"/);
    } else {
      assert.match(section('conditions'), activeTripId ? /아직 여행지를 정하지 않았어요[\s\S]*data-go-tab="place"/ : /여행을 만들고 여행지를 정하면 숙소·교통·취향을 준비해요[\s\S]*data-go-tab="place"/);
      assert.doesNotMatch(section('conditions'), /🎉 여행지|data-go-tab="course"/);
      assert.match(section('course'), /data-go-tab="place"/);
      assert.doesNotMatch(section('course'), /id="recommendationCard"/);
    }
    assert.match(section('settle'), /id="expenseOverview"[\s\S]*id="settleExpenses"[\s\S]*id="settleFinish"/);
    assert.match(section('dues'), /id="roomFinance"/);
    assert.match(section('members'), /id="memberAdmin"[\s\S]*id="kakaoSocialPanel"/);
    assert.match(section('history'), /id="pastTrips"[\s\S]*id="tripRecords"/);
    assert.doesNotMatch(section('course'), /id="roomFinance"|id="preferenceGrid"/);
  }
});

test('여행이 없거나 여행지 결정 전은 장소, 결정 후는 준비를 기본으로 열고 같은 단계에서는 보던 탭을 유지한다', () => {
  assert.equal(defaultRoomTab({ activeTripId: null, status: 'planning' }), 'place');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'planning' }), 'place');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'decided' }), 'conditions');
  // 여행지가 정해지면(추첨·확정) 보던 장소 탭에서 준비 탭으로 넘어감
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'decided' }, { phase: '1:planning', tab: 'place' }), 'conditions');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'planning' }, { phase: '1:planning', tab: 'packing' }), 'packing');
  assert.equal(defaultRoomTab({ activeTripId: 1, status: 'decided' }, { phase: '1:decided', tab: 'settle' }), 'settle');
  // 단계가 바뀌면 여행 탭은 기본값으로, 방 전체 탭(회비 등)은 그대로
  assert.equal(defaultRoomTab({ activeTripId: 2, status: 'planning' }, { phase: '1:decided', tab: 'settle' }), 'place');
  assert.equal(defaultRoomTab({ activeTripId: null, status: 'planning' }, { phase: '1:decided', tab: 'dues' }), 'dues');
});

test('위 탭과 여행 안쪽 5개 탭은 한 패널만 보여주고, 여행 탭을 다시 열면 마지막으로 본 여행 메뉴로 돌아간다', () => {
  const keys = ['place', 'conditions', 'course', 'settle', 'packing', 'members', 'dues', 'history'];
  const panels = Object.fromEntries(keys.map(key => ['panel-' + key, { hidden: true, shown: 0, dispatchEvent(event) { if (event.type === 'tabshow') this.shown += 1; } }]));
  const subnav = { hidden: true };
  const makeButton = dataset => ({ dataset, attrs: {}, getAttribute(key) { return this.attrs[key]; }, setAttribute(key, value) { this.attrs[key] = value; }, focus() { this.focused = true; } });
  const top = ['trip', 'members', 'dues', 'history'].map(key => makeButton({ roomTop: key }));
  const sub = ['place', 'conditions', 'course', 'settle', 'packing'].map(key => makeButton({ roomTab: key }));
  const link = { dataset: { goTab: 'place' } };
  global.document = {
    querySelectorAll: selector => selector === '[data-room-top]' ? top : selector === '[data-room-tab]' ? sub : [link],
    getElementById: id => id === 'tripSubnav' ? subnav : panels[id],
  };
  const visible = () => Object.entries(panels).filter(([, panel]) => !panel.hidden).map(([id]) => id);
  const key = (button, name) => button.onkeydown({ key: name, preventDefault() {} });
  try {
    bindRoomTabs({ id: 91, activeTripId: 1, status: 'decided' });
    assert.deepEqual(visible(), ['panel-conditions']);
    assert.equal(subnav.hidden, false);
    assert.equal(top[0].attrs['aria-selected'], 'true');
    assert.equal(sub[1].attrs['aria-selected'], 'true');
    assert.equal(panels['panel-conditions'].shown, 1);

    sub[3].onclick(); // 정산
    assert.deepEqual(visible(), ['panel-settle']);
    // 숨어 있던 패널이 보일 때만 tabshow를 보내 지도 등이 크기를 다시 맞추게 함
    sub[3].onclick();
    assert.equal(panels['panel-settle'].shown, 1);
    top[2].onclick(); // 회비
    assert.deepEqual(visible(), ['panel-dues']);
    assert.equal(subnav.hidden, true);
    assert.equal(sub.every(button => button.attrs['aria-selected'] === 'false'), true);
    top[0].onclick(); // 여행 → 마지막으로 본 정산으로 복귀
    assert.deepEqual(visible(), ['panel-settle']);
    assert.equal(panels['panel-settle'].shown, 2);

    let prevented = false;
    sub[3].onkeydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
    assert.ok(prevented && sub[4].focused);
    assert.deepEqual(visible(), ['panel-packing']);
    key(sub[4], 'ArrowRight'); // 끝에서 오른쪽 → 처음(장소)
    assert.ok(sub[0].focused);
    assert.deepEqual(visible(), ['panel-place']);
    key(sub[0], 'ArrowLeft'); // 처음에서 왼쪽 → 마지막(준비물)
    assert.deepEqual(visible(), ['panel-packing']);
    key(sub[4], 'Home');
    assert.deepEqual(visible(), ['panel-place']);
    key(sub[0], 'End');
    assert.deepEqual(visible(), ['panel-packing']);
    key(sub[4], 'ArrowLeft');
    assert.deepEqual(visible(), ['panel-settle']);
    top[0].onkeydown({ key: 'ArrowRight', preventDefault() {} });
    assert.deepEqual(visible(), ['panel-members']);
    link.onclick(); // 안내 버튼(data-go-tab="place")
    assert.deepEqual(visible(), ['panel-place']);
    assert.equal(sub[0].tabIndex, 0);
    assert.equal(sub[1].tabIndex, -1);
    assert.equal(subnav.hidden, false);

    // 여행이 없으면 장소, 같은 여행에서 여행지가 정해지면 장소 → 준비로 넘어감
    bindRoomTabs({ id: 92, activeTripId: null, status: 'planning' });
    assert.deepEqual(visible(), ['panel-place']);
    bindRoomTabs({ id: 93, activeTripId: 1, status: 'planning' });
    assert.deepEqual(visible(), ['panel-place']);
    bindRoomTabs({ id: 93, activeTripId: 1, status: 'decided' });
    assert.deepEqual(visible(), ['panel-conditions']);
  } finally { delete global.document; }
});
