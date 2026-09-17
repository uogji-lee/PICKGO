const el = (sel, root = document) => root.querySelector(sel);
const appEl = () => document.getElementById('app');
const userBoxEl = () => document.getElementById('userBox');

let state = {
  user: null,
  view: 'loading', // loading | auth | rooms | room
  roomId: null,
};

// ---------- API 헬퍼 ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '오류가 발생했습니다.');
  return data;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function onEnter(inputEl, fn) {
  if (!inputEl) return;
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); });
}

// ---------- 다크모드 ----------
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function updateThemeToggleIcon() {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = currentTheme() === 'dark' ? '☀️' : '🌙';
}
function initTheme() {
  try {
    const saved = localStorage.getItem('pickgo_theme');
    if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
  } catch (e) { /* ignore */ }
  updateThemeToggleIcon();
  const btn = document.getElementById('themeToggle');
  if (btn) btn.onclick = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('pickgo_theme', next); } catch (e) { /* ignore */ }
    updateThemeToggleIcon();
  };
}

// ---------- 토스트 ----------
function ensureToastRoot() {
  let root = document.getElementById('toastRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toastRoot';
    root.className = 'toast-root';
    document.body.appendChild(root);
  }
  return root;
}
function showToast(message, type = 'info', duration = 2800) {
  const root = ensureToastRoot();
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, duration);
}

// ---------- 모달 (confirm / prompt 대체) ----------
function ensureModalRoot() {
  let root = document.getElementById('modalRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modalRoot';
    root.className = 'modal-root';
    document.body.appendChild(root);
  }
  return root;
}
function closeModal() {
  const root = document.getElementById('modalRoot');
  if (root) { root.classList.remove('open'); root.innerHTML = ''; }
}
function showConfirm({ title = '확인', message = '', okText = '확인', cancelText = '취소' } = {}) {
  return new Promise(resolve => {
    const root = ensureModalRoot();
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-box">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button class="ghost" id="modalCancel">${escapeHtml(cancelText)}</button>
            <button id="modalOk">${escapeHtml(okText)}</button>
          </div>
        </div>
      </div>`;
    root.classList.add('open');
    const finish = (val) => { closeModal(); resolve(val); };
    el('#modalOk', root).onclick = () => finish(true);
    el('#modalCancel', root).onclick = () => finish(false);
    el('.modal-backdrop', root).addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) finish(false);
    });
  });
}
function showPrompt({ title = '입력', message = '', defaultValue = '', okText = '확인', cancelText = '취소', maxlength = 30 } = {}) {
  return new Promise(resolve => {
    const root = ensureModalRoot();
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-box">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
          <input type="text" id="modalPromptInput" maxlength="${maxlength}" value="${escapeHtml(defaultValue)}" />
          <div class="modal-actions">
            <button class="ghost" id="modalCancel">${escapeHtml(cancelText)}</button>
            <button id="modalOk">${escapeHtml(okText)}</button>
          </div>
        </div>
      </div>`;
    root.classList.add('open');
    const input = el('#modalPromptInput', root);
    input.focus();
    input.select();
    const finish = (val) => { closeModal(); resolve(val); };
    el('#modalOk', root).onclick = () => finish(input.value.trim());
    el('#modalCancel', root).onclick = () => finish(null);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(input.value.trim());
      if (e.key === 'Escape') finish(null);
    });
  });
}

// ---------- 추첨 연출 ----------
let allRegionNames = [];
async function ensureRegionNames() {
  if (allRegionNames.length) return allRegionNames;
  try {
    const { regions } = await api('/regions');
    allRegionNames = regions.map(r => r.name);
  } catch (e) { allRegionNames = []; }
  return allRegionNames;
}
function showDrawOverlay() {
  const root = ensureModalRoot();
  root.innerHTML = `
    <div class="modal-backdrop draw-backdrop">
      <div class="draw-box">
        <div class="draw-label">🎲 여행지를 뽑는 중...</div>
        <div class="draw-region" id="drawRegionText">???</div>
        <div class="draw-dresscode" id="drawDresscodeText"></div>
      </div>
    </div>`;
  root.classList.add('open');
}
function runSlotAnimation({ names, finalName, dresscodeCandidates, finalDresscode, duration = 2600 }) {
  return new Promise(resolve => {
    const regionEl = document.getElementById('drawRegionText');
    const dresscodeEl = document.getElementById('drawDresscodeText');
    const pool = names.length ? names : [finalName];
    const dPool = dresscodeCandidates.length ? dresscodeCandidates : (finalDresscode ? [finalDresscode] : []);
    const start = Date.now();
    let timer = null;
    function tick() {
      const elapsed = Date.now() - start;
      if (elapsed >= duration) {
        if (regionEl) { regionEl.textContent = finalName; regionEl.classList.add('landed'); }
        if (dresscodeEl) dresscodeEl.textContent = finalDresscode ? `👗 ${finalDresscode}` : '';
        setTimeout(resolve, 500);
        return;
      }
      if (regionEl) regionEl.textContent = pool[Math.floor(Math.random() * pool.length)];
      if (dresscodeEl && dPool.length) dresscodeEl.textContent = `👗 ${dPool[Math.floor(Math.random() * dPool.length)]}`;
      const progress = elapsed / duration;
      const delay = 40 + progress * progress * 260; // 점점 느려지는 슬롯머신 효과
      timer = setTimeout(tick, delay);
    }
    tick();
  });
}

// ---------- 초기화 ----------
async function init() {
  initTheme();
  try {
    const { user } = await api('/me');
    state.user = user;
    state.view = user ? 'rooms' : 'auth';
  } catch (e) {
    state.view = 'auth';
  }
  render();
}

function renderUserBox() {
  const box = userBoxEl();
  if (!state.user) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <span>👤 ${escapeHtml(state.user.nickname)}님</span>
    <button class="ghost small" id="logoutBtn">로그아웃</button>
  `;
  el('#logoutBtn', box).onclick = async () => {
    await api('/logout', { method: 'POST' });
    state.user = null;
    state.view = 'auth';
    render();
  };
}

// ---------- 화면 렌더 ----------
function render() {
  renderUserBox();
  if (state.view !== 'room') { stopPolling(); lastRoomSnapshot = null; }
  appEl().classList.toggle('wide', state.view === 'room');
  if (state.view === 'loading') {
    appEl().innerHTML = skeletonCard(3);
  } else if (state.view === 'auth') {
    renderAuth();
  } else if (state.view === 'rooms') {
    renderRoomList();
  } else if (state.view === 'room') {
    renderRoomDetail();
  }
}

function skeletonCard(lines = 3) {
  return `<div class="card skeleton-card">${'<div class="skeleton-line"></div>'.repeat(lines)}</div>`;
}

// ---------- 인증 화면 ----------
function renderAuth() {
  appEl().innerHTML = `
    <div class="card">
      <h1>🧭 PICKGO</h1>
      <p class="desc">친구들과 함께 여행 날짜, 여행지, 드레스코드까지 랜덤으로 정해보세요!</p>
      <div class="tabs">
        <button id="tabLogin" class="secondary">로그인</button>
        <button id="tabSignup">회원가입</button>
      </div>
      <div id="authError"></div>
      <input type="text" id="nickname" placeholder="닉네임 (2~12자)" maxlength="12" />
      <input type="password" id="password" placeholder="비밀번호 (4자 이상)" />
      <button class="block" id="submitBtn">로그인</button>
    </div>
  `;
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    el('#tabLogin').className = m === 'login' ? 'secondary' : '';
    el('#tabSignup').className = m === 'signup' ? 'secondary' : '';
    el('#submitBtn').textContent = m === 'login' ? '로그인' : '회원가입';
  };
  el('#tabLogin').onclick = () => setMode('login');
  el('#tabSignup').onclick = () => setMode('signup');
  const submit = async () => {
    const nickname = el('#nickname').value.trim();
    const password = el('#password').value;
    const errBox = el('#authError');
    errBox.innerHTML = '';
    try {
      const { user } = await api(mode === 'login' ? '/login' : '/signup', {
        method: 'POST', body: { nickname, password }
      });
      state.user = user;
      state.view = 'rooms';
      render();
    } catch (e) {
      errBox.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
    }
  };
  el('#submitBtn').onclick = submit;
  onEnter(el('#nickname'), submit);
  onEnter(el('#password'), submit);
}

// ---------- 방 목록 화면 ----------
async function renderRoomList() {
  appEl().innerHTML = skeletonCard(4);
  let rooms = [];
  try {
    const data = await api('/rooms/mine');
    rooms = data.rooms;
  } catch (e) { /* ignore */ }

  appEl().innerHTML = `
    <div class="card">
      <h2>방 만들기</h2>
      <input type="text" id="newRoomTitle" placeholder="방제 (예: 여름 휴가)" maxlength="30" />
      <button class="block" id="createRoomBtn">방 만들기</button>
    </div>
    <div class="card">
      <h2>초대코드로 입장</h2>
      <input type="text" id="inviteCodeInput" placeholder="초대코드 입력" maxlength="8" style="text-transform:uppercase" />
      <button class="block secondary" id="joinRoomBtn">입장하기</button>
      <div id="joinError"></div>
    </div>
    <div class="card">
      <h2>내 방 목록</h2>
      ${rooms.length ? `<ul class="member-list" id="roomList">` +
        rooms.map(r => `
          <li class="room-list-item" data-id="${r.id}">
            <span>${escapeHtml(r.title)} ${r.host_user_id === state.user.id ? '<span class="badge host">방장</span>' : '<span class="badge">멤버</span>'}</span>
            <span>${r.status === 'decided' ? '✅ 결정완료' : '📅 진행중'}</span>
          </li>
        `).join('') + `</ul>`
        : `<p class="desc">아직 참여한 방이 없어요. 방을 만들거나 초대코드로 입장해보세요.</p>`}
    </div>
  `;

  const createRoom = async () => {
    const title = el('#newRoomTitle').value.trim();
    try {
      const { roomId } = await api('/rooms', { method: 'POST', body: { title } });
      state.roomId = roomId;
      state.view = 'room';
      render();
    } catch (e) { showToast(e.message, 'error'); }
  };
  el('#createRoomBtn').onclick = createRoom;
  onEnter(el('#newRoomTitle'), createRoom);

  const joinRoom = async () => {
    const inviteCode = el('#inviteCodeInput').value.trim();
    const errBox = el('#joinError');
    errBox.innerHTML = '';
    try {
      const { roomId } = await api('/rooms/join', { method: 'POST', body: { inviteCode } });
      state.roomId = roomId;
      state.view = 'room';
      render();
    } catch (e) {
      errBox.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
    }
  };
  el('#joinRoomBtn').onclick = joinRoom;
  onEnter(el('#inviteCodeInput'), joinRoom);

  document.querySelectorAll('.room-list-item').forEach(li => {
    li.onclick = () => {
      state.roomId = Number(li.dataset.id);
      state.view = 'room';
      render();
    };
  });
}

// ---------- 방 상세 화면 ----------
let calendarCursor = null; // {year, month} 0-indexed month
let localSelectedDates = new Set();
let pollTimer = null;
let isDrawing = false;
let lastRoomSnapshot = null;

function snapshotOf(data) {
  return JSON.stringify({
    members: data.members.map(m => ({ id: m.id, availability: m.availability, dresscode: m.dresscode })),
    tally: data.tally,
    bestDates: data.bestDates,
    bestCount: data.bestCount,
    status: data.room.status,
    selectedDate: data.room.selectedDate,
    selectedRegion: data.room.selectedRegion,
    selectedDresscode: data.room.selectedDresscode,
    title: data.room.title
  });
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
function startPolling(roomId) {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (state.view !== 'room' || state.roomId !== roomId || isDrawing) return;
    try {
      const data = await api(`/rooms/${roomId}`);
      applyRoomUpdate(data);
    } catch (e) {
      // 방을 나갔거나 일시적 오류 → 조용히 무시, 다음 틱에 재시도
    }
  }, 5000);
}

function renderMembersListHtml(members, hostUserId) {
  return members.map(m => `
    <li>
      <span>${escapeHtml(m.nickname)} ${m.id === hostUserId ? '<span class="badge host">방장</span>' : ''}</span>
      <span>${m.dresscode ? `<span class="dresscode-tag">${escapeHtml(m.dresscode)}</span>` : '<span style="color:var(--muted)">미입력</span>'} · 가능일 ${m.availability.length}개</span>
    </li>
  `).join('');
}
function renderBestDatesInfoHtml(bestDates, bestCount) {
  return bestDates.length ? `🔥 최다 인원(${bestCount}명) 가능일: <strong>${bestDates.join(', ')}</strong>` : '';
}
function renderFinalDateInfoHtml(selectedDate) {
  return selectedDate ? `✅ 확정된 날짜: <strong>${selectedDate}</strong>` : '';
}

function applyRoomUpdate(data) {
  const snapshotKey = snapshotOf(data);
  if (snapshotKey === lastRoomSnapshot) return; // 변경 없음
  const prevStatus = lastRoomSnapshot ? JSON.parse(lastRoomSnapshot).status : null;
  lastRoomSnapshot = snapshotKey;
  if (isDrawing) return; // 애니메이션 중엔 화면을 건드리지 않음 (완료 후 render()가 반영)

  const memberListEl = document.getElementById('memberList');
  if (memberListEl) memberListEl.innerHTML = renderMembersListHtml(data.members, data.room.hostUserId);
  const memberCountEl = document.getElementById('memberCount');
  if (memberCountEl) memberCountEl.textContent = `👥 참여 멤버 (${data.members.length}명)`;

  if (document.getElementById('calendarGrid')) {
    renderCalendar(data.tally, data.bestDates, data.room.selectedDate);
  }
  const bestInfoEl = document.getElementById('bestDatesInfo');
  if (bestInfoEl) bestInfoEl.innerHTML = renderBestDatesInfoHtml(data.bestDates, data.bestCount);

  const finalDateSelect = document.getElementById('finalDateSelect');
  if (finalDateSelect && document.activeElement !== finalDateSelect) {
    finalDateSelect.innerHTML = `<option value="">최종 날짜 선택...</option>` +
      data.bestDates.map(d => `<option value="${d}">${d}</option>`).join('');
  }
  const finalDateInfoEl = document.getElementById('finalDateInfo');
  if (finalDateInfoEl) finalDateInfoEl.innerHTML = renderFinalDateInfoHtml(data.room.selectedDate);

  const titleEl = document.getElementById('roomTitle');
  if (titleEl && titleEl.textContent !== data.room.title) titleEl.textContent = data.room.title;

  const drawBtnEl = document.getElementById('drawBtn');
  if (drawBtnEl) drawBtnEl.textContent = data.room.status === 'decided' ? '다시 추첨하기' : '추첨하기';

  const resultContainer = document.getElementById('resultCardContainer');
  if (resultContainer) resultContainer.innerHTML = data.room.status === 'decided' ? renderResultCard(data.room) : '';

  if (prevStatus && prevStatus !== 'decided' && data.room.status === 'decided') {
    showToast('🎉 여행지가 결정되었어요! 결과를 확인해보세요.', 'success', 4000);
  }
}

async function renderRoomDetail() {
  appEl().innerHTML = skeletonCard(5);
  let data;
  try {
    data = await api(`/rooms/${state.roomId}`);
  } catch (e) {
    appEl().innerHTML = `<div class="card"><div class="error-msg">${escapeHtml(e.message)}</div>
      <button class="secondary" id="backBtn">방 목록으로</button></div>`;
    el('#backBtn').onclick = () => { state.view = 'rooms'; render(); };
    return;
  }

  const { room, members, tally, bestDates, bestCount, isHost } = data;
  const me = members.find(m => m.id === state.user.id);
  localSelectedDates = new Set(me ? me.availability : []);
  lastRoomSnapshot = snapshotOf(data);

  if (!calendarCursor) {
    const now = new Date();
    calendarCursor = { year: now.getFullYear(), month: now.getMonth() };
  }

  appEl().innerHTML = `
    <button class="link-btn" id="backBtn">← 방 목록</button>
    <div class="card">
      <div class="room-header">
        <div>
          <h1 id="roomTitle">${escapeHtml(room.title)}</h1>
          ${isHost ? `<button class="ghost small" id="editTitleBtn">방제 수정</button>` : ''}
        </div>
      </div>
      <div class="invite-box">
        초대코드 <span class="invite-code">${room.inviteCode}</span>
        <button class="ghost small" id="copyInviteBtn">복사</button>
      </div>
    </div>

    <div class="room-grid">
      <div class="col col-left">
        <div class="card">
          <h2>📅 가능한 날짜 표시하기</h2>
          <p class="desc">여행 갈 수 있는 날짜를 눌러서 표시해주세요. 굵은 테두리는 가장 많은 인원이 가능한 날짜예요.</p>
          <div class="month-nav">
            <button class="ghost small" id="prevMonth">◀</button>
            <span id="monthLabel"></span>
            <button class="ghost small" id="nextMonth">▶</button>
          </div>
          <div class="calendar-grid" id="calendarGrid"></div>
          <button class="block" id="saveAvailBtn">내 가능 날짜 저장</button>
          <p class="desc" id="bestDatesInfo" style="margin-top:12px">${renderBestDatesInfoHtml(bestDates, bestCount)}</p>
          ${isHost ? `
            <div class="row" style="margin-top:8px">
              <select id="finalDateSelect">
                <option value="">최종 날짜 선택...</option>
                ${bestDates.map(d => `<option value="${d}">${d}</option>`).join('')}
              </select>
              <button class="secondary" id="confirmDateBtn">이 날짜로 확정</button>
            </div>
          ` : ''}
          <p class="desc" id="finalDateInfo" style="margin-top:8px">${renderFinalDateInfoHtml(room.selectedDate)}</p>
        </div>

        <div class="card">
          <h2>👗 드레스 코드 입력하기</h2>
          <p class="desc">원하는 드레스 코드를 자유롭게 적어주세요. (예: 하와이안 셔츠, 전신 블랙 등)</p>
          <input type="text" id="dresscodeInput" placeholder="원하는 드레스 코드" maxlength="40" value="${escapeHtml(me?.dresscode || '')}" />
          <button class="block secondary" id="saveDresscodeBtn">저장</button>
        </div>
      </div>

      <div class="col col-right">
        <div id="resultCardContainer">${room.status === 'decided' ? renderResultCard(room) : ''}</div>

        <div class="card">
          <h2 id="memberCount">👥 참여 멤버 (${members.length}명)</h2>
          <ul class="member-list" id="memberList">${renderMembersListHtml(members, room.hostUserId)}</ul>
        </div>

        ${isHost ? `
          <div class="card">
            <h2>🎲 여행지 & 드레스코드 추첨</h2>
            <p class="desc">모든 인원이 다 모였다면, 지금 랜덤으로 여행지와 드레스코드를 뽑아보세요!</p>
            <button class="block" id="drawBtn">${room.status === 'decided' ? '다시 추첨하기' : '추첨하기'}</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  el('#backBtn').onclick = () => { state.view = 'rooms'; calendarCursor = null; render(); };

  el('#copyInviteBtn').onclick = () => {
    navigator.clipboard?.writeText(room.inviteCode).then(() => {
      el('#copyInviteBtn').textContent = '복사됨!';
      showToast('초대코드가 복사되었습니다.', 'success', 1800);
      setTimeout(() => { el('#copyInviteBtn').textContent = '복사'; }, 1500);
    });
  };

  if (isHost) {
    const editBtn = el('#editTitleBtn');
    if (editBtn) editBtn.onclick = async () => {
      const newTitle = await showPrompt({ title: '방제 수정', message: '새 방제를 입력하세요', defaultValue: room.title, maxlength: 30 });
      if (newTitle) {
        try {
          await api(`/rooms/${room.id}/title`, { method: 'POST', body: { title: newTitle } });
          showToast('방제가 변경되었습니다.', 'success');
          render();
        } catch (e) { showToast(e.message, 'error'); }
      }
    };
  }

  renderCalendar(tally, bestDates, room.selectedDate);
  el('#prevMonth').onclick = () => { shiftMonth(-1); renderCalendar(tally, bestDates, room.selectedDate); };
  el('#nextMonth').onclick = () => { shiftMonth(1); renderCalendar(tally, bestDates, room.selectedDate); };

  el('#saveAvailBtn').onclick = async () => {
    try {
      await api(`/rooms/${room.id}/availability`, { method: 'POST', body: { dates: Array.from(localSelectedDates) } });
      showToast('가능한 날짜가 저장되었습니다.', 'success');
      render();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const dresscodeInput = el('#dresscodeInput');
  const saveDresscode = async () => {
    const text = dresscodeInput.value.trim();
    try {
      await api(`/rooms/${room.id}/dresscode`, { method: 'POST', body: { text } });
      showToast('드레스코드가 저장되었습니다.', 'success');
      render();
    } catch (e) { showToast(e.message, 'error'); }
  };
  el('#saveDresscodeBtn').onclick = saveDresscode;
  onEnter(dresscodeInput, saveDresscode);

  if (isHost) {
    const confirmBtn = el('#confirmDateBtn');
    if (confirmBtn) confirmBtn.onclick = async () => {
      const date = el('#finalDateSelect').value;
      if (!date) { showToast('날짜를 선택해주세요.', 'error'); return; }
      try {
        await api(`/rooms/${room.id}/select-date`, { method: 'POST', body: { date } });
        showToast('여행 날짜가 확정되었습니다!', 'success');
        render();
      } catch (e) { showToast(e.message, 'error'); }
    };
    const drawBtn = el('#drawBtn');
    if (drawBtn) drawBtn.onclick = async () => {
      const ok = await showConfirm({
        title: '추첨하기',
        message: '여행지와 드레스코드를 랜덤으로 추첨할까요?',
        okText: '추첨!'
      });
      if (!ok) return;
      isDrawing = true;
      try {
        await ensureRegionNames();
        const memberDresscodes = members.map(m => m.dresscode).filter(Boolean);
        showDrawOverlay();
        const result = await api(`/rooms/${room.id}/draw`, { method: 'POST' });
        await runSlotAnimation({
          names: allRegionNames,
          finalName: result.region.name,
          dresscodeCandidates: memberDresscodes,
          finalDresscode: result.dresscode,
          duration: 2600
        });
        closeModal();
        showToast('🎉 여행지가 결정되었습니다!', 'success');
        render();
      } catch (e) {
        closeModal();
        showToast(e.message, 'error');
      } finally {
        isDrawing = false;
      }
    };
  }

  startPolling(room.id);
}

function renderResultCard(room) {
  const region = room.selectedRegion;
  if (!region) return '';
  return `
    <div class="card">
      <div class="region-result">
        <div style="font-size:13px;color:var(--muted)">🎉 추첨 결과</div>
        <div class="region-name">${escapeHtml(region.name)}</div>
        ${room.selectedDresscode ? `<div class="dresscode-final">드레스코드: ${escapeHtml(room.selectedDresscode)}</div>` : ''}
        <h2 style="margin-top:20px">가볼만한 명소</h2>
        <div class="tag-list" style="justify-content:center">
          ${region.attractions.map(a => `<span class="tag">📍 ${escapeHtml(a)}</span>`).join('')}
        </div>
        <h2 style="margin-top:20px">즐길거리 추천</h2>
        <div class="tag-list" style="justify-content:center">
          ${region.activities.map(a => `<span class="tag">✨ ${escapeHtml(a)}</span>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function shiftMonth(delta) {
  let { year, month } = calendarCursor;
  month += delta;
  if (month < 0) { month = 11; year -= 1; }
  if (month > 11) { month = 0; year += 1; }
  calendarCursor = { year, month };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function renderCalendar(tally, bestDates, selectedDate) {
  const { year, month } = calendarCursor;
  const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  el('#monthLabel').textContent = `${year}년 ${monthNames[month]}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid = el('#calendarGrid');
  grid.innerHTML = '';

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'day-cell empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    const count = tally[dateStr] || 0;
    if (localSelectedDates.has(dateStr)) cell.classList.add('selected');
    if (bestDates.includes(dateStr) && count > 0) cell.classList.add('best');
    if (selectedDate === dateStr) cell.classList.add('final');
    cell.innerHTML = `<span>${d}</span>${count ? `<span class="count">${count}명</span>` : ''}`;
    cell.onclick = () => {
      if (localSelectedDates.has(dateStr)) localSelectedDates.delete(dateStr);
      else localSelectedDates.add(dateStr);
      cell.classList.toggle('selected');
    };
    grid.appendChild(cell);
  }
}

init();
