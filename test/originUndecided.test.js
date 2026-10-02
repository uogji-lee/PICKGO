const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'isolated-test-secret';
const app = require('../server');
const db = require('../db');

let server, base, users;
async function request(path, user, body) {
  const response = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: user.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  users = [];
  for (let index = 0; index < 4; index++) {
    const result = await request('/signup', null, { nickname: `미정${index}`, password: 'test-pass' });
    users.push({ ...result.data.user, cookie: result.cookie });
  }
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

async function setup() {
  const { data: room } = await request('/rooms', users[0], { title: '출발지 미정' });
  for (const user of users.slice(1)) await request('/rooms/join', user, { inviteCode: room.inviteCode });
  const path = `/rooms/${room.roomId}`;
  const trip = await request(`${path}/trips`, users[0], { title: '겨울 여행', participantIds: users.slice(0, 3).map(user => user.id), destinationMethod: 'easy' });
  return { path, tripId: trip.data.tripId };
}
const memberOf = async (path, user) => (await request(path, users[0])).data.members.find(member => member.id === user.id);

test('출발지 미정은 이동수단 없이 저장되고 기존 출발지를 지우며, 실제 출발지를 저장하면 해제된다', async () => {
  const { path } = await setup();
  await request(`${path}/origin`, users[1], { originId: 'bs-seomyeon', mode: 'car' });
  const version = (await request(`${path}/version`, users[0])).data.version;
  assert.equal((await request(`${path}/origin`, users[1], { undecided: true })).status, 200);
  let me = await memberOf(path, users[1]);
  assert.deepEqual([me.originUndecided, me.originId, me.originMode, me.origin], [true, null, null, null]);
  assert.notEqual((await request(`${path}/version`, users[0])).data.version, version); // 다른 멤버 화면에도 반영
  assert.equal((await memberOf(path, users[2])).originUndecided, false);

  // 실제 출발지는 여전히 이동수단 필수, undecided가 true가 아니면 일반 저장으로 처리
  assert.equal((await request(`${path}/origin`, users[1], { originId: 'bs-seomyeon' })).status, 400);
  assert.equal((await request(`${path}/origin`, users[1], { undecided: 'yes' })).status, 400);
  assert.equal((await memberOf(path, users[1])).originUndecided, true);

  assert.equal((await request(`${path}/origin`, users[1], { originId: 'bs-seomyeon', mode: 'car' })).status, 200);
  me = await memberOf(path, users[1]);
  assert.deepEqual([me.originUndecided, me.originId], [false, 'bs-seomyeon']);

  await request(`${path}/origin`, users[1], { undecided: true });
  assert.equal((await request(`${path}/origin`, users[1], { lat: 35.1577, lng: 129.0592, label: '서면역', mode: 'public' })).status, 200);
  me = await memberOf(path, users[1]);
  assert.deepEqual([me.originUndecided, me.origin.label], [false, '서면역']);
  assert.equal((await request(`${path}/origin`, users[3], { undecided: true })).status, 200); // 불참 멤버도 방 멤버면 저장 가능
});

test('가기 쉬운 여행지 계산에서 미정 참석자는 빠지고, 미입력 목록과 따로 내려간다', async () => {
  const { path } = await setup();
  let easy = (await request(`${path}/easy-regions`, users[0])).data;
  assert.deepEqual([easy.missing.length, easy.undecidedOrigins], [3, []]);

  await request(`${path}/origin`, users[0], { lat: 37.5665, lng: 126.978, label: '서울역', mode: 'public' });
  await request(`${path}/origin`, users[1], { undecided: true });
  easy = (await request(`${path}/easy-regions`, users[2])).data;
  assert.deepEqual([easy.readyCount, easy.travelerCount], [1, 3]);
  assert.deepEqual(easy.missing, [users[2].nickname]);
  assert.deepEqual(easy.undecidedOrigins, [users[1].nickname]);
  assert.ok(easy.ranking.every(item => item.legs.map(leg => leg.userId).join() === String(users[0].id)));

  let state = (await request(`${path}/destination`, users[1])).data;
  assert.deepEqual(state.missingOrigins, [users[2].nickname]);
  assert.deepEqual(state.undecidedOrigins, [users[1].nickname]);
  assert.equal(state.candidates.length, 5);
  assert.ok(state.candidates.every(item => !item.legs.some(leg => leg.userId === users[1].id)));

  // 좌표가 남아 있는 비정상 데이터여도 미정이면 계산 제외
  db.prepare('UPDATE room_members SET origin_lat = 35.1577, origin_lng = 129.0592, origin_mode = ? WHERE user_id = ?').run('car', users[1].id);
  easy = (await request(`${path}/easy-regions`, users[0])).data;
  assert.equal(easy.readyCount, 1);
  assert.deepEqual(easy.undecidedOrigins, [users[1].nickname]);

  // 모두 미정·미입력이면 후보 없음, 미입력에는 미정이 섞이지 않음
  await request(`${path}/origin`, users[0], { undecided: true });
  state = (await request(`${path}/destination`, users[0])).data;
  assert.deepEqual([state.candidates.length, state.missingOrigins], [0, [users[2].nickname]]);
  assert.deepEqual(state.undecidedOrigins.sort(), [users[0].nickname, users[1].nickname].sort());
  assert.equal((await request(`${path}/destination/draw`, users[0], {})).status, 409);
});

test('여행을 끝내면 출발지 미정도 기록에 보관되고, 새 여행은 미정이 풀린 채 시작한다', async () => {
  const { path, tripId } = await setup();
  await request(`${path}/origin`, users[1], { undecided: true });
  await request(`${path}/origin`, users[2], { originId: 'bs-seomyeon', mode: 'car' });
  assert.equal((await request(`${path}/trips/${tripId}/finish`, users[0], {})).status, 200);
  const archived = JSON.parse(db.prepare('SELECT member_inputs_json FROM journeys WHERE id = ?').get(tripId).member_inputs_json);
  assert.deepEqual(archived.map(item => [item.userId, item.originUndecided]).sort((a, b) => a[0] - b[0]),
    [[users[0].id, false], [users[1].id, true], [users[2].id, false]]);

  assert.equal((await request(`${path}/trips`, users[0], { title: '다음 여행', participantIds: users.slice(0, 3).map(user => user.id) })).status, 200);
  const me = await memberOf(path, users[1]);
  assert.deepEqual([me.originUndecided, me.originId], [false, null]);
});

test('출발지 카드와 멤버 목록은 미정과 미입력을 구분해 보여준다', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8').replace(/init\(\);\s*$/, '');
  const member = (id, nickname, extra) => ({ id, nickname, role: 'member', availability: [], preferences: [], originId: null, originMode: null, origin: null, originUndecided: false, ...extra });
  const members = [member(1, '나', { originUndecided: true }), member(2, '아직'), member(3, '부산러', { originId: 'bs-seomyeon', originMode: 'car' })];
  const room = { id: 10, activeTripId: 1, trip: { id: 1, title: '가을 여행' }, status: 'planning', title: '모임', inviteCode: 'TEST12', tripNights: 1 };
  for (const kakaoMapKey of [null, 'map-key']) {
    const root = { innerHTML: '' };
    const context = vm.createContext({
      document: { getElementById: () => root, querySelector: () => null, addEventListener() {} },
      skeletonCard: () => '',
      memberManagementControls: () => '',
      roomRoles: { member: '멤버' },
      fetch: async () => ({ ok: true, json: async () => ({ room, members, tally: {}, bestDates: [], preferenceOptions: [], isHost: false, kakaoMapKey,
        originOptions: [{ id: 'bs-seomyeon', group: '부산', label: '부산 서면' }], originModes: { car: '자가용', public: '대중교통' } }) }),
      bindRoomTabs: () => { throw new Error('tabs-initialized'); },
    });
    vm.runInContext(source + ';state.user={id:1};state.roomId=10;', context);
    await assert.rejects(vm.runInContext('renderRoomDetail()', context), /tabs-initialized/);
    const html = root.innerHTML;
    const form = html.split('id="originForm"')[1].split('</form>')[0];
    assert.match(form, /현재: 출발지 미정/);
    assert.match(form, /id="originUndecided" disabled>출발지 미정</);
    const list = html.split('class="origin-list"')[1].split('</ul>')[0];
    assert.match(list, /class="undecided"><strong>나<\/strong><span>출발지 미정</);
    assert.match(list, /class="missing"><strong>아직<\/strong><span>미입력</);
    assert.match(list, /부산러<\/strong><span>부산 서면 · 자가용</);
    const memberList = html.split('class="member-list"')[1].split('</ul>')[0];
    assert.match(memberList, /나[\s\S]*출발 미정[\s\S]*아직[\s\S]*출발 미입력[\s\S]*부산러[\s\S]*출발 부산 서면\(자가용\)/);
  }
});

test('여행지 정하기(가기 쉬운 곳)와 참고 카드는 출발지 미정을 미입력 안내와 따로 보여준다', async () => {
  const source = ['easyRegions.js', 'destination.js'].map(file => fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8')).join('\n');
  const leg = { userId: 1, nickname: '서울러', minutes: 90, method: '대중교통' };
  const item = { region: { id: 'gyeongju', name: '경북 경주시' }, averageMinutes: 90, maxMinutes: 90, distanceFromMidpointKm: 3, legs: [leg] };
  const responses = {
    '/rooms/10/destination': { method: 'easy', methods: { easy: '🧭 가기 쉬운 곳' }, drawLimit: 2, drawCount: 0, drawsLeft: 3, selected: null, midpoint: { label: '대전 근처' },
      missingOrigins: ['아직'], undecidedOrigins: ['고민중'], candidates: [{ ...item, key: 'gyeongju', voters: [], voterIds: [] }], myVote: null, isHost: false, canVote: true },
    '/rooms/10/easy-regions': { midpoint: { label: '대전 근처', lat: 36.3, lng: 127.4 }, ranking: [item], readyCount: 1, travelerCount: 3, missing: ['아직'], undecidedOrigins: ['고민중'] },
  };
  const roots = { destinationPanel: { innerHTML: '' }, easyRegions: { innerHTML: '' } };
  for (const root of Object.values(roots)) Object.assign(root, { isConnected: true, children: [], querySelector: () => null, querySelectorAll: () => [] });
  const context = vm.createContext({
    document: { getElementById: id => roots[id] || null },
    api: async url => responses[url],
    escapeHtml: value => String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`),
  });
  vm.runInContext(source, context);
  const room = { id: 10, activeTripId: 1, selectedRegion: null };
  await vm.runInContext('(room) => Promise.all([loadDestination(room, false, []), loadEasyRegions(room, false, [])])', context)(room);
  for (const html of [roots.destinationPanel.innerHTML, roots.easyRegions.innerHTML]) {
    assert.match(html, /출발지 미정\(계산 제외\): 고민중/);
    assert.doesNotMatch(html.replace(/출발지 미정\(계산 제외\): 고민중/, ''), /고민중/);
  }
  assert.match(roots.destinationPanel.innerHTML, /출발지를 아직 공유하지 않은 참석자: 아직 ·/);
  assert.match(roots.easyRegions.innerHTML, /1\/3명 기준 · 출발지 미입력: 아직</);
});
