const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/js/account.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const taken = nickname => ({ available: false, nickname, message: '이미 사용 중인 닉네임이에요' });
const free = nickname => ({ available: true, nickname, message: '사용 가능한 닉네임이에요' });

// 가짜 입력칸·버튼·타이머·api로 watchNicknameAvailability만 불러 와 확인
function setup(options) {
  const requests = [], timers = new Map();
  let nextTimer = 0;
  const input = {
    id: 'nickname', value: '', isConnected: true, attrs: {}, listeners: {},
    setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
    addEventListener(type, handler) { this.listeners[type] = handler; }, closest: () => null, after(node) { this.status = node; },
  };
  const button = { disabled: false };
  const context = vm.createContext({
    document: { createElement: () => ({ setAttribute() {} }) },
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    api: url => new Promise((resolve, reject) => requests.push({ nickname: new URLSearchParams(url.split('?')[1]).get('nickname'), resolve, reject })),
  });
  vm.runInContext(source, context);
  const watcher = context.watchNicknameAvailability(input, button, options);
  const type = value => { input.value = value; input.listeners.input(); };
  const runTimers = () => { const due = [...timers.values()]; timers.clear(); due.forEach(timer => timer.fn()); };
  return { input, button, watcher, requests, timers, type, runTimers };
}

test('입력이 멈추고 400ms 뒤에 한 번만 확인하고, 쓸 수 없는 닉네임이면 안내와 함께 제출 버튼을 막는다', async () => {
  const { input, button, requests, timers, type, runTimers } = setup();
  type('mi'); type('min'); type('minji');
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 400);
  assert.equal(requests.length, 0);
  runTimers();
  assert.deepEqual(requests.map(request => request.nickname), ['minji']);
  requests[0].resolve(taken('minji')); await settle();
  assert.equal(input.status.textContent, '이미 사용 중인 닉네임이에요');
  assert.equal(input.status.className, 'field-status bad');
  assert.equal(input.attrs['aria-invalid'], 'true');
  assert.equal(button.disabled, true);
  type('minji2'); // 다시 입력하면 안내를 지우고 버튼을 풀어 줌
  assert.equal(input.status.textContent, '');
  assert.equal(input.attrs['aria-invalid'], undefined);
  assert.equal(button.disabled, false);
});

test('늦게 도착한 이전 값의 응답은 지금 값의 안내를 덮어쓰지 않는다', async () => {
  const { input, button, requests, type, runTimers } = setup();
  type('minji'); runTimers();
  type('bora'); runTimers();
  requests[1].resolve(free('bora')); await settle();
  requests[0].resolve(taken('minji')); await settle();
  assert.equal(input.status.textContent, '✓ 사용 가능한 닉네임이에요');
  assert.equal(button.disabled, false);
});

test('확인 중에 로그인 탭으로 바꾸면 늦게 온 "이미 사용 중" 응답이 안내를 띄우거나 로그인 버튼을 막지 않는다', async () => {
  let mode = 'login';
  const { input, button, watcher, requests, timers, type } = setup({ enabled: () => mode === 'signup' });
  type('Minji'); // 로그인 탭에서는 확인하지 않음
  assert.equal(timers.size, 0);
  mode = 'signup';
  const pending = watcher.check(); // 회원가입 탭으로 바꾸면 바로 확인
  mode = 'login';
  assert.equal(await watcher.check(), true); // 응답 전에 로그인 탭으로 돌아감
  requests[0].resolve(taken('Minji'));
  assert.equal(await pending, true);
  assert.equal(input.status.textContent, '');
  assert.equal(button.disabled, false);
  assert.equal(requests.length, 1);
});

test('확인을 기다리는 동안 다시 제출하면 막아 요청이 한 번만 나가고, 제출 중이거나 쓸 수 없는 닉네임이면 통과시키지 않는다', async () => {
  const { button, watcher, requests, type, runTimers } = setup();
  type('bora');
  const first = watcher.beforeSubmit();
  assert.equal(await watcher.beforeSubmit(), false);
  requests[0].resolve(free('bora'));
  assert.equal(await first, true);
  assert.equal(await watcher.beforeSubmit(), true); // 같은 값은 기억한 결과로 바로 통과
  assert.equal(requests.length, 1);
  button.disabled = true; // 앞선 제출이 진행 중
  assert.equal(await watcher.beforeSubmit(), false);
  button.disabled = false;
  type('minji'); runTimers();
  requests[1].resolve(taken('minji'));
  assert.equal(await watcher.beforeSubmit(), false);
});

test('제출이 409로 실패하면 기억한 결과를 버리고 다시 확인하며, 실패한 확인은 기억하지 않는다', async () => {
  const { input, button, watcher, requests, type, runTimers } = setup();
  type('bora'); runTimers();
  requests[0].resolve(free('bora')); await settle();
  assert.equal(input.status.textContent, '✓ 사용 가능한 닉네임이에요');
  const again = watcher.recheck(); // 그 사이 다른 사람이 같은 이름으로 가입
  assert.equal(requests.length, 2);
  requests[1].resolve(taken('bora'));
  assert.equal(await again, false);
  assert.equal(input.status.textContent, '이미 사용 중인 닉네임이에요');
  assert.equal(button.disabled, true);
  type('hana'); runTimers();
  requests[2].reject(new Error('요청이 많아요'));
  assert.equal(await watcher.check(), true); // 확인에 실패하면 서버의 가입 검증에 맡김
  watcher.check();
  assert.equal(requests.length, 4); // 실패한 확인은 기억하지 않고 다시 물음
});

test('입력 후 400ms 안에 화면을 떠나면 확인 요청을 보내지 않는다', () => {
  const { input, requests, type, runTimers } = setup();
  type('bora');
  input.isConnected = false;
  runTimers();
  assert.equal(requests.length, 0);
});
