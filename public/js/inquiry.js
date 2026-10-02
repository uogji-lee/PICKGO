// 문의하기: 운영자에게 문의를 남기고 답변 확인. 운영자(isAdmin)는 받은 문의에 답변·종료
const INQUIRY_CATEGORIES = { bug: '🐞 버그 신고', feature: '💡 기능 제안', account: '🔐 계정 문제', other: '💬 기타' };
const INQUIRY_STATUS = { open: '답변 대기', answered: '답변 완료', closed: '종료' };
let myInquiryTicket = 0, adminInquiryTicket = 0; // 늦게 도착한 이전 응답이 최신 목록을 덮지 않게

function openInquiry() {
  if (state.view !== 'inquiry') state.inquiryBack = state.view;
  state.view = 'inquiry';
  render();
  window.scrollTo(0, 0);
}

function leaveInquiry() {
  const previous = state.inquiryBack;
  state.view = !state.user ? 'auth' : previous === 'account' || (previous === 'room' && state.roomId) ? previous : 'rooms';
  render();
}

// 로그인이 만료됐으면 로그인 화면으로 보냄
function inquiryAuthLost(error) {
  if (error.status !== 401) return false;
  state.user = null; state.view = 'auth'; state.authNotice = '로그인이 만료되었습니다. 다시 로그인해주세요.';
  render();
  return true;
}

// SQLite UTC 시각(YYYY-MM-DD HH:MM:SS)을 내 시간대로 짧게 표시
function formatInquiryTime(value) {
  const date = new Date(String(value || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  const year = date.getFullYear() !== new Date().getFullYear() ? `${date.getFullYear()}년 ` : '';
  return `${year}${date.getMonth() + 1}월 ${date.getDate()}일 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inquiryItemHtml(item, admin = false) {
  const time = value => `<time datetime="${escapeHtml(String(value).replace(' ', 'T') + 'Z')}">${escapeHtml(formatInquiryTime(value))}</time>`;
  const id = Number(item.id);
  return `<li class="inquiry-item">
    <div class="inquiry-meta">
      <span class="badge inquiry-status ${escapeHtml(item.status)}">${escapeHtml(INQUIRY_STATUS[item.status] || item.status)}</span>
      <span>${escapeHtml(INQUIRY_CATEGORIES[item.category] || item.category)}</span>
      ${admin ? `<strong>${escapeHtml(item.author)}</strong>` : ''}
      ${time(item.createdAt)}
    </div>
    <p class="inquiry-message">${escapeHtml(item.message)}</p>
    ${admin ? `<form class="inquiry-reply-form" data-id="${id}">
      <label class="inquiry-reply-label"><span>${item.repliedAt ? `보낸 답변 · ${time(item.repliedAt)}` : '답변'}</span>
        <textarea name="reply" rows="3" maxlength="2000" placeholder="작성자에게 보여줄 답변을 입력하세요">${escapeHtml(item.reply || '')}</textarea></label>
      <div class="inquiry-actions">
        ${item.status !== 'closed' ? `<button type="button" class="small ghost" data-close="${id}">종료</button>` : ''}
        <button type="submit" class="small">${item.reply ? '답변 수정' : '답변 보내기'}</button>
      </div>
    </form>` : item.reply ? `<div class="inquiry-reply">
      <div class="inquiry-meta"><strong>운영자 답변</strong>${item.repliedAt ? time(item.repliedAt) : ''}</div>
      <p class="inquiry-message">${escapeHtml(item.reply)}</p>
    </div>` : ''}
  </li>`;
}

async function renderInquiry() {
  appEl().innerHTML = skeletonCard(4);
  try {
    const { user } = await api('/me'); // 운영자 여부(isAdmin)를 최신 상태로 확인
    state.user = user ? { ...state.user, ...user } : null;
  } catch (error) {
    if (state.view !== 'inquiry') return;
    appEl().innerHTML = `<div class="card"><p class="error-msg">${escapeHtml(error.message)}</p><button id="retryInquiry">다시 불러오기</button></div>`;
    el('#retryInquiry').onclick = render;
    return;
  }
  if (state.view !== 'inquiry') return;
  renderUserBox();
  const back = '<button id="inquiryBack" class="link-btn">← 돌아가기</button>';
  if (!state.user) {
    appEl().innerHTML = `${back}<div class="card"><h1>문의하기</h1><p class="desc">문의를 남기고 답변을 받으려면 로그인이 필요해요.</p><button id="inquiryLogin" class="block">로그인하러 가기</button></div>`;
    el('#inquiryBack').onclick = leaveInquiry;
    el('#inquiryLogin').onclick = () => { state.view = 'auth'; render(); };
    return;
  }

  const draft = state.inquiryDraft || { category: '', message: '' };
  appEl().innerHTML = `${back}
    <div class="card">
      <h1>문의하기</h1>
      <p class="desc">불편한 점이나 바라는 기능을 남겨주세요. 운영자가 확인하고 이 화면에서 답변드려요.</p>
      <form id="inquiryForm" class="inquiry-form" novalidate>
        <fieldset class="inquiry-categories"><legend>분류</legend>
          ${Object.entries(INQUIRY_CATEGORIES).map(([value, label]) => `<label class="inquiry-chip"><input type="radio" name="category" value="${value}"${draft.category === value ? ' checked' : ''}>${label}</label>`).join('')}
        </fieldset>
        <label class="inquiry-label" for="inquiryMessage">내용</label>
        <textarea id="inquiryMessage" name="message" rows="6" maxlength="2000" aria-describedby="inquiryCount"
          placeholder="어떤 화면에서 무엇을 하다가 생긴 일인지 적어주시면 더 빨리 확인할 수 있어요.">${escapeHtml(draft.message)}</textarea>
        <div class="inquiry-form-foot"><span id="inquiryCount" class="inquiry-count"></span><button type="submit">보내기</button></div>
      </form>
    </div>
    <div class="card"><h2>내 문의</h2><div id="myInquiries">${skeletonCard(2)}</div></div>
    ${state.user.isAdmin ? `<div class="card"><h2>📮 받은 문의 (운영자)</h2>
      <div id="adminInquiryFilter" class="inquiry-filter" role="group" aria-label="문의 상태"></div>
      <div id="adminInquiries">${skeletonCard(2)}</div></div>` : ''}`;
  el('#inquiryBack').onclick = leaveInquiry;

  const form = el('#inquiryForm'), textarea = el('#inquiryMessage'), count = el('#inquiryCount');
  const updateCount = () => {
    const short = textarea.value.trim().length < 5;
    count.textContent = `${short ? '5자 이상 · ' : ''}${textarea.value.length} / 2000자`;
    count.classList.toggle('short', short && textarea.value.length > 0);
  };
  updateCount();
  form.oninput = () => { state.inquiryDraft = { category: form.category.value, message: textarea.value }; updateCount(); };
  form.onsubmit = async event => {
    event.preventDefault();
    const category = form.category.value, message = textarea.value.trim();
    if (!category) return showToast('문의 분류를 골라주세요.', 'error');
    if (message.length < 5) { textarea.focus(); return showToast('문의 내용을 5자 이상 입력해주세요.', 'error'); }
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api('/inquiries', { method: 'POST', body: { category, message } });
      state.inquiryDraft = null;
      textarea.value = '';
      form.querySelectorAll('input[name=category]').forEach(input => { input.checked = false; });
      updateCount();
      showToast('문의를 보냈어요. 답변이 오면 여기에서 확인할 수 있어요.', 'success');
      loadMyInquiries();
      if (state.user?.isAdmin) loadAdminInquiries();
    } catch (error) { if (!inquiryAuthLost(error)) showToast(error.message, 'error'); }
    finally { button.disabled = false; }
  };
  loadMyInquiries();

  if (!state.user.isAdmin) return;
  el('#adminInquiryFilter').onclick = event => {
    const button = event.target.closest('button[data-status]');
    if (!button) return;
    state.inquiryFilter = button.dataset.status;
    loadAdminInquiries();
  };
  const adminRoot = el('#adminInquiries');
  adminRoot.onsubmit = event => {
    event.preventDefault();
    const replyForm = event.target, reply = replyForm.reply.value.trim();
    if (!reply) { replyForm.reply.focus(); return showToast('답변 내용을 입력해주세요.', 'error'); }
    sendInquiryAdminAction(replyForm, `/admin/inquiries/${replyForm.dataset.id}/reply`, { reply }, '답변을 보냈어요.');
  };
  adminRoot.onclick = async event => {
    const button = event.target.closest('button[data-close]');
    if (!button || !(await confirmAction('이 문의를 종료할까요? 작성자에게 \'종료\'로 표시돼요.'))) return;
    sendInquiryAdminAction(button.closest('form'), `/admin/inquiries/${button.dataset.close}/close`, {}, '문의를 종료했어요.');
  };
  loadAdminInquiries();
}

async function loadMyInquiries() {
  const root = document.getElementById('myInquiries');
  if (!root) return;
  const ticket = ++myInquiryTicket;
  let inquiries;
  try { ({ inquiries } = await api('/inquiries/mine')); }
  catch (error) {
    if (root.isConnected && ticket === myInquiryTicket && !inquiryAuthLost(error)) root.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!root.isConnected || ticket !== myInquiryTicket) return;
  root.innerHTML = inquiries.length
    ? `<ul class="inquiry-list">${inquiries.map(item => inquiryItemHtml(item)).join('')}</ul>`
    : '<p class="empty-state">아직 남긴 문의가 없어요.</p>';
}

async function loadAdminInquiries() {
  const root = document.getElementById('adminInquiries'), filter = document.getElementById('adminInquiryFilter');
  if (!root) return;
  const status = state.inquiryFilter || 'open';
  const ticket = ++adminInquiryTicket;
  let data;
  try { data = await api(`/admin/inquiries?status=${encodeURIComponent(status)}`); }
  catch (error) {
    if (root.isConnected && ticket === adminInquiryTicket && !inquiryAuthLost(error)) root.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!root.isConnected || ticket !== adminInquiryTicket) return;
  const total = Object.values(data.counts).reduce((sum, value) => sum + value, 0);
  filter.innerHTML = [...Object.entries(INQUIRY_STATUS), ['all', '전체']].map(([value, label]) =>
    `<button type="button" class="small${value === status ? '' : ' ghost'}" data-status="${value}" aria-pressed="${value === status}">${label} ${value === 'all' ? total : data.counts[value] || 0}</button>`).join('');
  root.innerHTML = data.inquiries.length
    ? `<ul class="inquiry-list">${data.inquiries.map(item => inquiryItemHtml(item, true)).join('')}</ul>`
    : `<p class="empty-state">${status === 'all' ? '받은 문의가 없어요.' : `'${INQUIRY_STATUS[status]}' 문의가 없어요.`}</p>`;
}

async function sendInquiryAdminAction(form, path, body, message) {
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    await api(path, { method: 'POST', body });
    showToast(message, 'success');
    loadAdminInquiries();
    loadMyInquiries(); // 운영자 본인이 남긴 문의일 수도 있음
  } catch (error) {
    if (inquiryAuthLost(error)) return;
    showToast(error.message, 'error');
    buttons.forEach(button => { button.disabled = false; });
  }
}
