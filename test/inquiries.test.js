const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
process.env.PICKGO_DB_PATH = ':memory:';
process.env.PICKGO_JWT_SECRET = 'isolated-test-secret';
process.env.PICKGO_ADMIN_USER_IDS = '';
const app = require('../server');
const db = require('../db');

let server, base, users, admin;
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
    const result = await request('/signup', null, { nickname: `문의${index}`, password: 'test-pass' });
    users.push({ ...result.data.user, cookie: result.cookie });
  }
  admin = users[3];
  process.env.PICKGO_ADMIN_USER_IDS = ` 9999, ${admin.id} `;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

test('문의 작성은 로그인이 필요하고 분류·내용 길이를 검증한다', async () => {
  assert.equal((await request('/inquiries', null, { category: 'bug', message: '로그인 안 한 문의' })).status, 401);
  assert.equal((await request('/inquiries', users[0], { category: 'complaint', message: '없는 분류입니다' })).status, 400);
  assert.equal((await request('/inquiries', users[0], { message: '분류 없이 보냄' })).status, 400);
  assert.equal((await request('/inquiries', users[0], { category: 'bug', message: '  짧은글  ' })).status, 400); // 앞뒤 공백 제외 3자
  assert.equal((await request('/inquiries', users[0], { category: 'bug', message: 'ㄱ'.repeat(2001) })).status, 400);
  assert.equal((await request('/inquiries', users[0], { category: 'bug', message: ['배열은', '안돼요'] })).status, 400);
  const created = await request('/inquiries', users[0], { category: 'bug', message: '  추첨 버튼이 안 눌려요  ' });
  assert.equal(created.status, 200);
  assert.ok(created.data.id);
  assert.equal((await request('/inquiries', users[0], { category: 'feature', message: 'ㄱ'.repeat(2000) })).status, 200);
  const { data } = await request('/inquiries/mine', users[0]);
  assert.deepEqual(data.inquiries.map(item => [item.category, item.status, item.reply]), [['feature', 'open', null], ['bug', 'open', null]]); // 최신순
  assert.equal(data.inquiries[1].message, '추첨 버튼이 안 눌려요');
  assert.ok(data.inquiries[1].createdAt);
  assert.deepEqual((await request('/inquiries/mine', users[1])).data.inquiries, []); // 다른 사람 문의는 보이지 않음
  assert.equal((await request('/inquiries/mine', null)).status, 401);
});

test('한 사람이 1시간에 5건을 넘게 보내면 429, 다른 사람과 1시간 지난 문의는 영향 없음', async () => {
  for (let index = 0; index < 5; index++) {
    assert.equal((await request('/inquiries', users[1], { category: 'other', message: `연속 문의 ${index}번` })).status, 200);
  }
  const limited = await request('/inquiries', users[1], { category: 'other', message: '여섯 번째 문의' });
  assert.equal(limited.status, 429);
  assert.match(limited.data.error, /1시간에 5건/);
  assert.equal((await request('/inquiries', users[2], { category: 'account', message: '다른 사람은 보낼 수 있어요' })).status, 200);
  db.prepare("UPDATE inquiries SET created_at = datetime('now', '-61 minutes') WHERE user_id = ? AND message = ?").run(users[1].id, '연속 문의 0번');
  assert.equal((await request('/inquiries', users[1], { category: 'other', message: '한 시간 지나서 다시' })).status, 200);
  assert.equal((await request('/inquiries/mine', users[1])).data.inquiries.length, 6);
});

test('운영자가 아니면 받은 문의 목록·답변·종료가 403이다', async () => {
  const { data: { id } } = await request('/inquiries', users[2], { category: 'bug', message: '운영자만 답변할 수 있나요' });
  assert.equal((await request('/admin/inquiries', users[0])).status, 403);
  assert.equal((await request(`/admin/inquiries/${id}/reply`, users[0], { reply: '몰래 답변' })).status, 403);
  assert.equal((await request(`/admin/inquiries/${id}/close`, users[2], {})).status, 403);
  assert.equal((await request('/admin/inquiries', null)).status, 401);
  const mine = (await request('/inquiries/mine', users[2])).data.inquiries.find(item => item.id === id);
  assert.deepEqual([mine.status, mine.reply], ['open', null]);
});

test('운영자 답변·종료는 작성자의 내 문의 목록에 반영된다', async () => {
  const { data: { id } } = await request('/inquiries', users[0], { category: 'account', message: '비밀번호를 바꾸고 싶어요' });
  const open = await request('/admin/inquiries?status=open', admin);
  assert.equal(open.status, 200);
  const listed = open.data.inquiries.find(item => item.id === id);
  assert.deepEqual([listed.author, listed.category, listed.message, listed.status], [users[0].nickname, 'account', '비밀번호를 바꾸고 싶어요', 'open']);
  assert.ok(open.data.inquiries.every(item => item.status === 'open'));
  assert.equal(open.data.counts.open, open.data.inquiries.length);
  assert.equal((await request('/admin/inquiries?status=weird', admin)).status, 400);

  assert.equal((await request(`/admin/inquiries/${id}/reply`, admin, { reply: '   ' })).status, 400);
  assert.equal((await request(`/admin/inquiries/${id}/reply`, admin, { reply: 'ㄱ'.repeat(2001) })).status, 400);
  assert.equal((await request('/admin/inquiries/99999/reply', admin, { reply: '없는 문의' })).status, 404);
  assert.equal((await request(`/admin/inquiries/${id}/reply`, admin, { reply: ' 계정 화면에서 바꿀 수 있어요. ' })).status, 200);
  let mine = (await request('/inquiries/mine', users[0])).data.inquiries.find(item => item.id === id);
  assert.deepEqual([mine.status, mine.reply], ['answered', '계정 화면에서 바꿀 수 있어요.']);
  assert.ok(mine.repliedAt);
  assert.equal(db.prepare('SELECT replied_by FROM inquiries WHERE id = ?').get(id).replied_by, admin.id);
  assert.ok(!(await request('/admin/inquiries?status=open', admin)).data.inquiries.some(item => item.id === id));
  assert.ok((await request('/admin/inquiries?status=answered', admin)).data.inquiries.some(item => item.id === id));

  assert.equal((await request('/admin/inquiries/99999/close', admin, {})).status, 404);
  assert.equal((await request(`/admin/inquiries/${id}/close`, admin, {})).status, 200);
  mine = (await request('/inquiries/mine', users[0])).data.inquiries.find(item => item.id === id);
  assert.deepEqual([mine.status, mine.reply], ['closed', '계정 화면에서 바꿀 수 있어요.']);
  const all = await request('/admin/inquiries?status=all', admin);
  assert.equal(all.data.inquiries.find(item => item.id === id).status, 'closed');
  assert.equal(all.data.inquiries.length, Object.values(all.data.counts).reduce((sum, value) => sum + value, 0));
  assert.deepEqual((await request('/admin/inquiries', admin)).data.inquiries.map(item => item.id), all.data.inquiries.map(item => item.id)); // 기본값은 전체
});

test('/api/me의 isAdmin은 PICKGO_ADMIN_USER_IDS를 요청 시점에 읽는다', async () => {
  assert.equal((await request('/me', admin)).data.user.isAdmin, true);
  assert.equal((await request('/me', users[0])).data.user.isAdmin, false);
  assert.equal((await request('/me', null)).data.user, null);
  const previous = process.env.PICKGO_ADMIN_USER_IDS;
  try {
    process.env.PICKGO_ADMIN_USER_IDS = String(users[0].id);
    assert.equal((await request('/me', users[0])).data.user.isAdmin, true);
    assert.equal((await request('/me', admin)).data.user.isAdmin, false);
    assert.equal((await request('/admin/inquiries', admin)).status, 403);
    process.env.PICKGO_ADMIN_USER_IDS = 'abc,,0,-1';
    assert.equal((await request('/me', users[0])).data.user.isAdmin, false);
  } finally { process.env.PICKGO_ADMIN_USER_IDS = previous; }
});

test('문의 목록 화면은 내용을 이스케이프하고 상태 배지·답변을 보여준다', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/inquiry.js'), 'utf8');
  const context = vm.createContext({ escapeHtml: value => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  vm.runInContext(source, context);
  const item = { id: 7, category: 'bug', message: '<img src=x onerror=alert(1)>', status: 'answered', reply: '고쳤어요 <b>', repliedAt: '2026-10-02 03:00:00', createdAt: '2026-10-01 12:00:00', author: '작성<자>' };
  const mine = vm.runInContext('inquiryItemHtml', context)(item);
  assert.ok(!mine.includes('<img') && !mine.includes('<b>'));
  assert.match(mine, /inquiry-status answered">답변 완료</);
  assert.match(mine, /운영자 답변/);
  assert.ok(!mine.includes('inquiry-reply-form') && !mine.includes('작성'));
  const adminHtml = vm.runInContext('inquiryItemHtml', context)({ ...item, status: 'open', reply: null, repliedAt: null }, true);
  assert.match(adminHtml, /inquiry-status open">답변 대기</);
  assert.match(adminHtml, /data-close="7"/);
  assert.match(adminHtml, />답변 보내기</);
  assert.ok(!adminHtml.includes('<자>'));
  const closed = vm.runInContext('inquiryItemHtml', context)({ ...item, status: 'closed' }, true);
  assert.ok(!closed.includes('data-close') && closed.includes('>답변 수정<'));
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /id="inquiryBtn"/);
  assert.ok(html.indexOf('/js/inquiry.js') < html.indexOf('/js/app.js'));
});
