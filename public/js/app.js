const el = (sel, root = document) => root.querySelector(sel);
const appEl = () => document.getElementById('app');
const userBoxEl = () => document.getElementById('userBox');

function confirmAction(message, requireName = false) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'action-dialog';
    dialog.innerHTML = `<form method="dialog"><h2>확인해주세요</h2><p>${escapeHtml(message)}</p>${requireName ? '<label>방 이름<input name="confirmation" required autocomplete="off"></label>' : ''}<div class="dialog-actions"><button value="cancel" class="ghost" formnovalidate>취소</button><button value="confirm">확인</button></div></form>`;
    dialog.addEventListener('close', () => { const result = dialog.returnValue === 'confirm' ? (requireName ? dialog.querySelector('input').value : true) : null; dialog.remove(); resolve(result); }, {once:true});
    document.body.append(dialog); dialog.showModal();
  });
}

let state = {
  user: null,
  view: 'loading', // loading | auth | rooms | room
  roomId: null,
};

// ---------- API 헬퍼 ----------
async function api(path, opts = {}) {
  let res;
  try { res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }); } catch { throw new Error('서버에 연결할 수 없습니다. 페이지 주소와 서버 실행 상태를 확인해주세요.'); }
  const data = await res.json().catch(() => { throw new Error('서버 응답을 읽지 못했습니다. 새로고침 후 다시 시도해주세요.'); });
  if (!res.ok) { const error = new Error(data.error || '오류가 발생했습니다.'); error.status = res.status; error.code = data.code; throw error; }
  return data;
}

// ---------- 초기화 ----------
async function init() {
  initTheme();
  const oauthError = new URLSearchParams(location.hash.slice(1)).get('kakao_error');
  const oauthMessages = { state: '카카오 로그인 요청이 만료되었습니다. 다시 시도해주세요.', cancelled: '카카오 로그인을 취소했습니다.', configuration: '카카오 로그인 설정을 확인해주세요. Redirect URI·클라이언트 시크릿 설정이 필요합니다.', already_linked: '이미 다른 PICKGO 계정에 연결된 카카오 계정입니다.', login_required: 'PICKGO에 먼저 로그인해주세요.', friends_permission: '카카오 친구 목록 권한을 먼저 설정해주세요.', not_linked: '이 카카오 계정과 연결된 PICKGO 계정이 없어요. 카카오를 연결하지 않은 계정은 찾을 수 없어요.' };
  const kakaoHash = location.hash;
  const fromKakao = location.hash.startsWith('#kakao');
  state.autoLoadFriends = location.hash === '#kakao_friends_connected';
  state.authNotice = oauthMessages[oauthError] || (state.autoLoadFriends ? '친구 목록 동의를 완료했습니다. 목록을 불러옵니다.' : location.hash === '#kakao_connected' ? '카카오 계정이 연결되었습니다.' : '');
  if (location.hash.startsWith('#kakao')) history.replaceState(null, '', location.pathname);
  try {
    const { user } = await api('/me');
    state.user = user;
    state.view = user
      ? (kakaoHash === '#kakao_recover' ? 'passwordReset' : fromKakao ? 'account' : 'rooms')
      : (kakaoHash === '#kakao_signup' ? 'kakaoSignup' : 'auth');
  } catch (e) {
    state.view = 'auth';
    state.authNotice = e.message;
  }
  render();
  document.getElementById('helpGuide').onclick = () => showQuickGuide(true);
  showQuickGuide();
}

function renderUserBox() {
  const box = userBoxEl();
  if (!state.user) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <span>👤 ${escapeHtml(state.user.nickname)}님</span>
    <button class="ghost small" id="accountBtn">계정 · 친구</button>
    <button class="ghost small" id="logoutBtn">로그아웃</button>
  `;
  el('#accountBtn', box).onclick = () => { state.view = 'account'; render(); };
  el('#logoutBtn', box).onclick = async () => {
    await api('/logout', { method: 'POST' });
    state.user = null;
    state.view = 'auth';
    render();
  };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- 실시간 동기화 ----------
let syncTimer = null;
let syncedVersion = null;
let editingSinceRender = false;
const regionNameCache = [];
async function regionNames() {
  if (!regionNameCache.length) {
    try { regionNameCache.push(...(await api('/regions')).regions.map(region => region.name)); } catch { /* 연출용이라 실패해도 무시 */ }
  }
  return regionNameCache;
}
function stopRoomSync() { if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } }
function startRoomSync(roomId) {
  stopRoomSync();
  syncTimer = setInterval(async () => {
    if (state.view !== 'room' || state.roomId !== roomId || document.hidden || isDrawing || document.querySelector('dialog[open]')) return;
    try {
      const { version } = await api(`/rooms/${roomId}/version`);
      if (version === syncedVersion) return;
      // 입력 중이면 쓰던 내용이 사라지지 않게 바로 덮어쓰지 않고 안내만 표시
      if (editingSinceRender || document.activeElement?.matches?.('#app input:not([type=checkbox]):not([type=radio]), #app textarea')) { showSyncBanner(); return; }
      state.remoteRender = true;
      render();
    } catch { /* 일시적 오류는 다음 확인 때 재시도 */ }
  }, 6000);
}
function showSyncBanner() {
  if (document.getElementById('syncBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'syncBanner';
  banner.className = 'sync-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML = '<span>다른 멤버가 내용을 바꿨어요. 입력을 마친 뒤 반영해주세요.</span><button type="button" class="small">지금 반영</button>';
  banner.querySelector('button').onclick = () => { state.remoteRender = true; render(); };
  appEl().querySelector('.room-tabs')?.before(banner);
}
document.addEventListener('input', event => { if (event.target.closest?.('#app')) editingSinceRender = true; });

// ---------- 화면 렌더 ----------
function render() {
  renderUserBox();
  if (state.view !== 'room') { stopRoomSync(); state.roomSummary = null; }
  if (state.view === 'loading') {
    appEl().innerHTML = skeletonCard(3);
  } else if (state.view === 'auth') {
    renderAuth();
  } else if (state.view === 'rooms') {
    renderRoomList();
  } else if (state.view === 'account') {
    renderAccount();
  } else if (state.view === 'room') {
    renderRoomDetail();
  } else if (state.view === 'kakaoSignup') {
    renderKakaoSignup();
  } else if (state.view === 'findAccount') {
    renderFindAccount();
  } else if (state.view === 'passwordReset') {
    renderPasswordReset();
  }
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
      ${state.authNotice ? `<p class="error-msg">${escapeHtml(state.authNotice)}</p>` : ''}
      <a id="kakaoLoginLink" class="kakao-login-link" aria-disabled="true">카카오로 로그인</a>
      <p id="kakaoLoginInfo" class="desc"></p>
      <form id="loginForm"><input type="text" id="nickname" name="username" autocomplete="username" aria-label="닉네임" placeholder="닉네임 (2~12자)" maxlength="12" required />
      <input type="password" id="password" name="password" autocomplete="current-password" aria-label="비밀번호" placeholder="비밀번호 (신규 가입은 8자 이상)" required />
      <button type="submit" class="block" id="submitBtn">로그인</button></form>
      <div id="kakaoSignupGuide" hidden>
        <p class="desc">PICKGO는 카카오 본인 인증 후 가입해요. 인증이 끝나면 사용할 닉네임과 비밀번호를 정하면 돼요. 카카오 인증을 해 두면 아이디·비밀번호를 잊어도 찾을 수 있어요.</p>
        <a class="kakao-login-link" href="/api/auth/kakao/start">카카오로 인증하고 가입하기</a>
      </div>
      <button type="button" class="link-btn" id="findAccountBtn">아이디·비밀번호 찾기</button>
    </div>
  `;
  let mode = 'login';
  configureKakaoLogin().then(() => { if (el('#loginForm')) setMode(mode); });
  el('#findAccountBtn').onclick = () => { state.view = 'findAccount'; render(); };
  const setMode = (m) => {
    mode = m;
    // 카카오가 설정된 서버는 카카오 본인 인증으로만 신규 가입
    const kakaoSignup = m === 'signup' && Boolean(state.kakaoStatus?.signupRequired);
    el('#loginForm').hidden = kakaoSignup;
    el('#kakaoSignupGuide').hidden = !kakaoSignup;
    el('#kakaoLoginLink').hidden = kakaoSignup;
    el('#tabLogin').className = m === 'login' ? 'secondary' : '';
    el('#tabSignup').className = m === 'signup' ? 'secondary' : '';
    el('#submitBtn').textContent = m === 'login' ? '로그인' : '회원가입';
    el('#password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  };
  el('#tabLogin').onclick = () => setMode('login');
  el('#tabSignup').onclick = () => setMode('signup');
  el('#loginForm').onsubmit = async event => {
    event.preventDefault();
    const submit = el('#submitBtn');
    if (submit.disabled) return;
    submit.disabled = true;
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
    } finally { submit.disabled = false; }
  };
}

// ---------- 방 목록 화면 ----------
async function renderRoomList() {
  appEl().innerHTML = skeletonCard(4);
  let rooms = [], deletedRooms = [];
  try {
    const data = await api('/rooms/mine');
    rooms = data.rooms; deletedRooms = data.deletedRooms || [];
  } catch (e) {
    if (e.status === 401) { state.user = null; state.view = 'auth'; state.authNotice = '로그인이 만료되었습니다. 다시 로그인해주세요.'; render(); return; }
    appEl().innerHTML = `<div class="card"><p class="error-msg">${escapeHtml(e.message)}</p><button id="retryRooms">다시 불러오기</button></div>`;
    el('#retryRooms').onclick = renderRoomList;
    return;
  }

  const roomsNotice = state.roomsNotice;
  state.roomsNotice = '';
  appEl().innerHTML = `
    ${roomsNotice ? `<div class="card notice-card" role="status">${escapeHtml(roomsNotice)}</div>` : ''}
    <details class="card collapsible-card"><summary><h2>카카오 연결 · 친구 · 받은 초대</h2></summary><div id="kakaoSocialPanel" class="collapsible-card-content"></div></details>
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
            <span>모임 기록 보기 →</span>
          </li>
        `).join('') + `</ul>`
        : `<p class="desc">아직 참여한 방이 없어요. 방을 만들거나 초대코드로 입장해보세요.</p>`}
    </div>
  `;

  const trash = document.createElement('details');
  trash.className = 'card';
  trash.innerHTML = '<summary>삭제한 방 · 방장만 복구 가능</summary>' + (deletedRooms.map(room => `<p>${escapeHtml(room.title)} <button class="ghost small" data-restore-room="${room.id}">복구</button></p>`).join('') || '<p class="desc">삭제한 방이 없습니다.</p>');
  appEl().append(trash);
  trash.querySelectorAll('[data-restore-room]').forEach(button => { button.onclick = async () => {
    button.disabled = true;
    try { await api(`/rooms/${button.dataset.restoreRoom}/restore`, {method:'POST',body:{}}); render(); }
    catch(error) { showToast(error.message, 'error'); button.disabled = false; }
  }; });
  loadKakaoPanel(el('#kakaoSocialPanel'));
  el('#createRoomBtn').onclick = async () => {
    const title = el('#newRoomTitle').value.trim();
    try {
      const { roomId } = await api('/rooms', { method: 'POST', body: { title } });
      state.roomId = roomId;
      state.view = 'room';
      render();
    } catch (e) { showToast(e.message, 'error'); }
  };

  el('#joinRoomBtn').onclick = async () => {
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

// 같은 방을 다시 그릴 때(저장 버튼 등) 화면을 비우지 않고, 스크롤 위치와 카드 접힘 상태를 이어서 보여줌
const LIVE_SECTIONS = ['tripManagement', 'roomFinance', 'expenseOverview', 'settleExpenses', 'settleFinish', 'memberAdmin', 'tripRecords', 'packingContent', 'lodgingPanel', 'easyRegions', 'kakaoSocialPanel', 'pastTrips'];
function captureRoomView() {
  if (state.renderedRoomId !== state.roomId || !appEl().querySelector('.room-tabs')) return null;
  return {
    scrollY: window.scrollY,
    closed: [...appEl().querySelectorAll('details')].filter(item => !item.open).map(item => item.querySelector('summary')?.textContent.trim()).filter(Boolean),
    sections: Object.fromEntries(LIVE_SECTIONS.map(id => [id, document.getElementById(id)?.innerHTML]).filter(([, html]) => html)),
  };
}
function restoreRoomView(snapshot) {
  if (!snapshot) return;
  for (const [id, html] of Object.entries(snapshot.sections)) {
    const target = document.getElementById(id);
    if (target) target.innerHTML = html; // 새로 불러오기 전까지 이전 내용으로 높이 유지
  }
  appEl().querySelectorAll('details').forEach(item => {
    if (snapshot.closed.includes(item.querySelector('summary')?.textContent.trim())) item.open = false;
  });
  window.scrollTo(0, snapshot.scrollY);
}

async function renderRoomDetail() {
  const snapshot = captureRoomView();
  if (!snapshot) appEl().innerHTML = skeletonCard(5);
  let data;
  try {
    data = await api(`/rooms/${state.roomId}`);
  } catch (e) {
    if (e.status === 401) { state.user = null; state.view = 'auth'; state.authNotice = '로그인이 만료되었습니다. 다시 로그인해주세요.'; render(); return; }
    appEl().innerHTML = `<div class="card"><div class="error-msg">${escapeHtml(e.message)}</div>
      <button class="secondary" id="backBtn">방 목록으로</button></div>`;
    el('#backBtn').onclick = () => { state.view = 'rooms'; render(); };
    return;
  }

  const { room, members, tally, bestDates, isHost, preferenceOptions } = data;
  const mapKey = data.kakaoMapKey || null;
  state.renderedRoomId = room.id;
  syncedVersion = data.version;
  editingSinceRender = false;
  const remote = state.remoteRender;
  state.remoteRender = false;
  const previousSummary = state.roomSummary?.roomId === room.id ? state.roomSummary : null;
  state.roomSummary = { roomId: room.id, regionId: room.selectedRegion?.id || null };
  const originOptions = data.originOptions || [];
  const originModes = data.originModes || {};
  const originLabel = id => originOptions.find(option => option.id === id)?.label;
  const tripMembers = room.tripParticipantIds?.length ? members.filter(m => room.tripParticipantIds.includes(m.id)) : members;
  const votersByDate = {};
  for (const m of tripMembers) for (const date of m.availability) (votersByDate[date] ||= []).push(m.nickname);
  const me = members.find(m => m.id === state.user.id);
  const planningSectionsOpen = 'open';
  localSelectedDates = new Set(me ? me.availability : []);

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
          ${isHost ? `<button class="ghost small" id="editTitleBtn">방제 수정</button><button class="ghost small danger" id="deleteRoomBtn">방 삭제</button>` : ''}
        </div>
      </div>
      <div class="invite-box">
        초대코드 <span class="invite-code">${room.inviteCode}</span>
        <button class="ghost small" id="copyInviteBtn">복사</button>
      </div>
    </div>

    <nav class="room-tabs" role="tablist" aria-label="방 메뉴">
      ${[['trip', '🧳 여행'], ['members', '👥 멤버 관리'], ['dues', '💰 회비'], ['history', '📚 지난 여행']].map(([key, label]) => `<button type="button" role="tab" id="tab-${key}" data-room-top="${key}" ${key === 'trip' ? 'aria-controls="tripSubnav"' : `aria-controls="panel-${key}"`} aria-selected="false" tabindex="-1">${label}</button>`).join('')}
    </nav>
    <div id="tripSubnav" class="trip-subnav" hidden>
      <p class="trip-subnav-title">${room.trip ? `<strong>${escapeHtml(room.trip.title)}</strong><span class="badge">진행 중</span>` : '<strong>진행 중인 여행이 없어요</strong><span class="desc">준비 탭에서 새 여행을 만들어 보세요.</span>'}</p>
      <nav class="room-subtabs" role="tablist" aria-label="이번 여행 메뉴">
        ${[['conditions', '준비'], ['course', '코스'], ['settle', '정산'], ['packing', '준비물']].map(([key, label]) => `<button type="button" role="tab" id="tab-${key}" data-room-tab="${key}" aria-controls="panel-${key}" aria-selected="false" tabindex="-1">${label}</button>`).join('')}
      </nav>
    </div>
    <p id="roomActionStatus" role="status" aria-live="polite"></p>
    <section id="panel-course" role="tabpanel" aria-labelledby="tab-course" tabindex="0" hidden>
    ${room.activeTripId && room.status === 'decided' ? renderResultCard(room) : ''}
    <div class="card"><p class="desc">준비 탭에서 일정·여행지·숙소·취향을 정하면 여기에서 코스를 확인할 수 있어요.</p><button class="secondary" data-go-tab="conditions">준비로 가기</button></div>
    </section>

    <section id="panel-settle" role="tabpanel" aria-labelledby="tab-settle" tabindex="0" hidden>
    <div id="expenseOverview" class="card">여행 경비 불러오는 중…</div>
    <div class="card"><div id="settleExpenses">지출 기록 불러오는 중…</div></div>
    <div class="card" id="settleFinishCard"><div id="settleFinish"></div></div>
    </section>

    <section id="panel-dues" role="tabpanel" aria-labelledby="tab-dues" tabindex="0" hidden>
    <div class="card"><div id="roomFinance">공동금고 불러오는 중…</div></div>
    </section>

    <section id="panel-packing" role="tabpanel" aria-labelledby="tab-packing" tabindex="0" hidden><div class="card"><h2>여행 준비물</h2><div id="packingContent">준비물 불러오는 중…</div></div></section>
    <section id="panel-conditions" role="tabpanel" aria-labelledby="tab-conditions" tabindex="0" hidden>
    <div class="card"><div id="tripManagement">여행 정보 불러오는 중…</div></div>
    <div ${room.activeTripId ? '' : 'hidden'}>
    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>📍 출발지 공유</h2></summary>
      <div class="collapsible-card-content">
      <p class="desc">어디서 출발하는지 멤버들과 공유해요. 집 대신 역·동네처럼 대략적인 위치를 골라도 괜찮아요.</p>
      <form id="originForm" class="origin-form">
        ${mapKey ? `
          <div class="origin-search"><input id="originQuery" placeholder="장소·주소 검색 (예: 강남역)" maxlength="60" /><button type="button" class="secondary" id="originSearchBtn">검색</button></div>
          <ul id="originResults" class="origin-results"></ul>
          <div id="originMap" class="origin-map" aria-label="출발 위치를 고르는 지도"></div>
          <p id="originPicked" class="origin-picked">${me?.origin ? `선택한 위치: ${escapeHtml(me.origin.label)}` : '지도를 누르거나 검색해서 출발 위치를 고르세요.'}</p>
        ` : `
          <label class="origin-wide">
            <span>내 출발 지역</span>
            <select name="originId">
              <option value="">출발 지역 선택…</option>
              ${[...new Set(originOptions.map(option => option.group))].map(group => `<optgroup label="${escapeHtml(group)}">${originOptions.filter(option => option.group === group).map(option => `<option value="${escapeHtml(option.id)}" ${!me?.origin && me?.originId === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</optgroup>`).join('')}
            </select>
            <small>카카오 지도 키를 설정하면 지도에서 정확한 위치를 고를 수 있어요.</small>
          </label>
        `}
        <label>
          <span>이동수단</span>
          <select name="mode">
            ${Object.entries(originModes).map(([value, label]) => `<option value="${value}" ${(me?.originMode || 'public') === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </label>
        <div class="origin-actions">
          <button type="button" class="ghost small" id="originLocate">📍 내 위치</button>
          <button type="submit" class="secondary">출발지 저장</button>
        </div>
        <span id="originStatus" role="status"></span>
      </form>
      <h3 class="origin-list-title">멤버별 출발지</h3>
      <ul class="origin-list">
        ${tripMembers.map(m => {
          const where = m.origin?.label || (m.originId ? originLabel(m.originId) : '');
          return `<li class="${where ? '' : 'missing'}"><strong>${escapeHtml(m.nickname)}</strong><span>${where ? `${escapeHtml(where)} · ${escapeHtml(originModes[m.originMode] || '')}` : '미입력'}</span></li>`;
        }).join('')}
      </ul>
      </div>
    </details>

    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>🧭 가기 쉬운 여행지 추천</h2></summary>
      <div class="collapsible-card-content">
      <label class="dresscode-toggle"><input type="checkbox" id="easyToggle" /><span>참석자 중간지점 기준으로 추천 보기</span></label>
      <p class="desc">공유한 출발지의 중간지점을 찾고, 그 근처에서 모두가 가기 공평한 여행지를 보여줘요.</p>
      <div id="easyRegions" hidden></div>
      </div>
    </details>

    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>🚗 교통 조건</h2></summary>
      <div class="collapsible-card-content">
      <p class="desc">인원과 이동수단을 기준으로 하루 이동 범위와 방문 순서를 조정해요. 숙소는 아래 숙소 후보 투표에서 정해요.</p>
      ${isHost ? `
        <div class="trip-settings-grid">
          <label>
            <span>실제 여행 인원</span>
            <input type="number" id="travelerCountInput" min="1" max="30" value="${room.travelerCount || members.length || 1}" readonly />
          </label>
          <label>
            <span>주요 교통수단</span>
            <select id="transportModeSelect">
              <option value="public" ${room.transportMode !== 'car' ? 'selected' : ''}>대중교통·도보</option>
              <option value="car" ${room.transportMode === 'car' ? 'selected' : ''}>차량</option>
            </select>
          </label>
          <label id="vehicleCountField" ${room.transportMode === 'car' ? '' : 'hidden'}>
            <span>사용 가능한 차량</span>
            <input type="number" id="vehicleCountInput" min="1" max="10" value="${Math.max(room.vehicleCount || 1, 1)}" />
          </label>
        </div>
        <button class="block secondary" id="saveTripSettingsBtn">교통 조건 저장</button>
      ` : `
        <div class="trip-settings-summary">
          <strong>${room.travelerCount}명 · ${room.transportMode === 'car' ? `차량 ${room.vehicleCount}대` : '대중교통·도보'}</strong>
        </div>
      `}
      </div>
    </details>

    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>🏠 숙소 후보 · 투표</h2></summary>
      <div class="collapsible-card-content">
      ${room.accommodation ? `<p class="trip-settings-saved">📍 확정 숙소: ${room.accommodation.url ? `<a href="${escapeHtml(room.accommodation.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(room.accommodation.name)} ↗</a>` : escapeHtml(room.accommodation.name)}${room.accommodation.address ? ` · ${escapeHtml(room.accommodation.address)}` : ''}</p>` : ''}
      <div id="lodgingPanel">숙소 후보 불러오는 중…</div>
      </div>
    </details>

    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>✨ 내 여행 취향</h2></summary>
      <div class="collapsible-card-content">
      <p class="desc">최대 3개를 골라주세요. 같은 취향을 선택한 인원이 많을수록 코스에 더 강하게 반영돼요.</p>
      <div class="preference-grid" id="preferenceGrid">
        ${preferenceOptions.map(option => `
          <label class="preference-option ${(me?.preferences || []).includes(option.id) ? 'selected' : ''}">
            <input type="checkbox" value="${option.id}" ${(me?.preferences || []).includes(option.id) ? 'checked' : ''} />
            <span>${escapeHtml(option.label)}</span>
          </label>
        `).join('')}
      </div>
      <label class="custom-preference-field">
        <span>기타 취향</span>
        <input type="text" id="customPreferenceInput" maxlength="80" placeholder="예: 조용한 산책, 인생샷 카페, 반려견 동반" value="${escapeHtml(me?.customPreference || '')}" />
        <small>자유롭게 적으면 핵심 의도를 찾아 장소 검색과 일정 우선순위에 반영합니다.</small>
        ${(me?.customPreferenceKeywords || []).length ? `<small class="interpreted-preference">이해한 키워드: ${me.customPreferenceKeywords.map(escapeHtml).join(', ')}</small>` : ''}
      </label>
      <button class="block secondary" id="savePreferencesBtn">내 취향 저장</button>
      </div>
    </details>

    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>📅 가능한 날짜 표시하기</h2></summary>
      <div class="collapsible-card-content">
      <p class="desc">여행 갈 수 있는 날짜를 눌러서 표시해주세요. 날짜 아래 인원수를 누르면 누가 가능한지 볼 수 있어요.</p>
      <div class="month-nav">
        <button class="ghost small" id="prevMonth">◀</button>
        <span id="monthLabel"></span>
        <button class="ghost small" id="nextMonth">▶</button>
      </div>
      <div class="calendar-grid" id="calendarGrid"></div>
      <div class="calendar-legend" aria-hidden="true">
        <span><i class="legend-mine"></i>내가 가능한 날</span>
        <span><b class="legend-best">유력!</b>가장 많이 가능한 날</span>
        <span><i class="legend-final"></i>확정 일정</span>
      </div>
      <p id="dateVoters" class="date-voters" role="status" hidden></p>
      <button class="block" id="saveAvailBtn">내 가능 날짜 저장</button>
      ${bestDates.length ? `<p class="desc" style="margin-top:12px">🔥 최다 인원(${data.bestCount}명) 가능일: <strong>${bestDates.join(', ')}</strong></p>` : ''}
      ${isHost ? `
        <div class="trip-confirm-controls" style="margin-top:8px">
          <select id="finalDateSelect">
            <option value="">최종 날짜 선택...</option>
            ${bestDates.map(d => `<option value="${d}" ${room.selectedDate === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
          <select id="tripNightsSelect" aria-label="여행 기간">
            ${Array.from({ length: 8 }, (_, nights) => `<option value="${nights}" ${room.tripNights === nights ? 'selected' : ''}>${tripLengthLabel(nights)}</option>`).join('')}
          </select>
          <button class="secondary" id="confirmDateBtn">일정 확정</button>
        </div>
      ` : ''}
      ${room.selectedDate ? `<p class="desc" style="margin-top:8px">✅ 확정 일정: <strong>${room.selectedDate}${room.selectedEndDate !== room.selectedDate ? ` ~ ${room.selectedEndDate}` : ''} · ${tripLengthLabel(room.tripNights)}</strong></p>` : ''}
      </div>
    </details>

    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>👗 드레스 코드${room.dresscodeEnabled ? '' : ' · 사용 안 함'}</h2></summary>
      <div class="collapsible-card-content">
      ${isHost ? `<label class="dresscode-toggle"><input type="checkbox" id="dresscodeToggle" ${room.dresscodeEnabled ? 'checked' : ''} /><span>이번 여행에 드레스코드 뽑기 사용</span></label>` : ''}
      ${room.dresscodeEnabled ? `
        <p class="desc">원하는 드레스코드 컨셉을 적어주세요. 모두가 적은 컨셉 중에서 하나를 랜덤으로 뽑아요. (예: 하와이안 셔츠, 전신 블랙)</p>
        <input type="text" id="dresscodeInput" placeholder="원하는 컨셉" maxlength="40" value="${escapeHtml(me?.dresscode || '')}" />
        <button class="block secondary" id="saveDresscodeBtn">컨셉 저장</button>
        <ul class="dresscode-concepts">
          ${tripMembers.map(m => `<li><strong>${escapeHtml(m.nickname)}</strong>${m.dresscode ? `<span class="dresscode-tag">${escapeHtml(m.dresscode)}</span>` : '<span class="muted">미입력</span>'}</li>`).join('')}
        </ul>
        ${room.selectedDresscode ? `<p class="dresscode-final">🎉 뽑힌 드레스코드: ${escapeHtml(room.selectedDresscode)}</p>` : ''}
        ${isHost && room.activeTripId ? `<button class="block" id="drawDresscodeBtn">${room.selectedDresscode ? '드레스코드 다시 뽑기' : '드레스코드 뽑기'}</button>` : ''}
      ` : `<p class="desc">${isHost ? '켜면 멤버들이 원하는 컨셉을 입력하고, 그중 하나를 랜덤으로 뽑을 수 있어요.' : '이번 여행은 드레스코드를 정하지 않아요.'}</p>`}
      </div>
    </details>

    </div>
    <div id="drawControls"></div>
    </section>
    <section id="panel-history" role="tabpanel" aria-labelledby="tab-history" tabindex="0" hidden>
      <div class="card"><h2>🧳 지난 여행</h2><p class="desc">끝난 여행만 모아 보여줘요. 진행 중인 여행은 여행 탭에서 확인하세요.</p><div id="pastTrips">불러오는 중…</div></div>
      <div class="card"><div id="tripRecords">여행 기록 불러오는 중…</div></div>
    </section>
    <section id="panel-members" role="tabpanel" aria-labelledby="tab-members" tabindex="0" hidden>
    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>👥 참여 멤버 (${members.length}명)</h2></summary>
      <div class="collapsible-card-content">
      <ul class="member-list">
        ${members.map(m => `
          <li>
            <span>${escapeHtml(m.nickname)} <span class="badge ${m.role === 'host' ? 'host' : ''}">${roomRoles[m.role] || '멤버'}</span>${m.role === 'host' && m.isTreasurer ? '<span class="badge">💰 총무 겸임</span>' : ''}</span>
            <span>${room.dresscodeEnabled ? `${m.dresscode ? `<span class="dresscode-tag">${escapeHtml(m.dresscode)}</span>` : '<span style="color:#bbb">컨셉 미입력</span>'} · ` : ''}취향 ${m.preferences.length}개${m.customPreference ? ` + 기타 “${escapeHtml(m.customPreference)}”` : ''} · 가능일 ${m.availability.length}개 · 출발 ${m.origin || m.originId ? `${escapeHtml(m.origin?.label || originLabel(m.originId) || '')}(${escapeHtml(originModes[m.originMode] || '')})` : '미입력'}</span>
            ${memberManagementControls(m, room, isHost)}
          </li>
        `).join('')}
      </ul>
      <div id="memberAdmin"></div>
      </div>
    </details>
    <details class="card collapsible-card" open><summary><h2>카카오 친구 · 방 초대</h2></summary><div id="kakaoSocialPanel" class="collapsible-card-content"></div></details>
    </section>

    ${isHost && room.activeTripId ? `
      <details class="card collapsible-card" ${planningSectionsOpen}>
        <summary><h2>🎲 여행지${room.dresscodeEnabled ? ' & 드레스코드' : ''} 추첨</h2></summary>
        <div class="collapsible-card-content">
        <p class="desc">모든 인원이 다 모였다면, 지금 랜덤으로 여행지${room.dresscodeEnabled ? '와 드레스코드' : ''}를 뽑아보세요!</p>
        <button class="block" id="drawBtn">${room.status === 'decided' ? '다시 추첨하기' : '추첨하기'}</button>
        </div>
      </details>
    ` : ''}
  `;

  if (el('#drawBtn')) el('#drawControls').append(el('#drawBtn').closest('details'));
  bindRoomTabs(room);
  restoreRoomView(snapshot);
  el('#backBtn').onclick = () => { state.view = 'rooms'; calendarCursor = null; render(); };
  const deleteButton = el('#deleteRoomBtn');
  if (deleteButton) deleteButton.onclick = async () => {
    const title = await confirmAction('삭제하면 모든 멤버에게서 숨겨집니다. 기록은 보존되며 방 목록에서 복구할 수 있어요. 방 이름을 정확히 입력하세요: ' + room.title, true);
    if (title === null) return;
    try { await api(`/rooms/${room.id}/delete`, {method:'POST',body:{title}}); state.view='rooms'; state.roomId=null; render(); }
    catch(error) { showToast(error.message, 'error'); }
  };

  el('#copyInviteBtn').onclick = () => {
    navigator.clipboard?.writeText(room.inviteCode).then(() => {
      el('#copyInviteBtn').textContent = '복사됨!';
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
          showToast('방제를 바꿨어요.', 'success');
          render();
        } catch (e) { showToast(e.message, 'error'); }
      }
    };
  }

  const drawCalendar = () => renderCalendar(tally, bestDates, room.selectedDate, room.selectedEndDate, votersByDate);
  drawCalendar();
  el('#prevMonth').onclick = () => { shiftMonth(-1); drawCalendar(); };
  el('#nextMonth').onclick = () => { shiftMonth(1); drawCalendar(); };

  el('#saveAvailBtn').onclick = async () => {
    try {
      await api(`/rooms/${room.id}/availability`, { method: 'POST', body: { dates: Array.from(localSelectedDates) } });
      showToast('가능한 날짜를 저장했어요.', 'success');
      render();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const dresscodeToggle = el('#dresscodeToggle');
  if (dresscodeToggle) dresscodeToggle.onchange = async () => {
    dresscodeToggle.disabled = true;
    try {
      await api(`/rooms/${room.id}/dresscode-settings`, { method: 'POST', body: { enabled: dresscodeToggle.checked } });
      render();
    } catch (e) { showToast(e.message, 'error'); dresscodeToggle.checked = !dresscodeToggle.checked; dresscodeToggle.disabled = false; }
  };
  const drawDresscodeBtn = el('#drawDresscodeBtn');
  if (drawDresscodeBtn) drawDresscodeBtn.onclick = async () => {
    drawDresscodeBtn.disabled = true;
    try {
      const { dresscode } = await api(`/rooms/${room.id}/draw-dresscode`, { method: 'POST', body: {} });
      await runDrawAnimation({ label: '👗 드레스코드를 뽑는 중…', pool: tripMembers.map(m => m.dresscode).filter(Boolean), final: dresscode, duration: 2000 });
      render();
    } catch (e) { showToast(e.message, 'error'); drawDresscodeBtn.disabled = false; }
  };
  if (el('#saveDresscodeBtn')) el('#saveDresscodeBtn').onclick = async () => {
    const text = el('#dresscodeInput').value.trim();
    try {
      await api(`/rooms/${room.id}/dresscode`, { method: 'POST', body: { text } });
      showToast('컨셉을 저장했어요.', 'success');
      render();
    } catch (e) { showToast(e.message, 'error'); }
  };

  if (isHost) {
    const transportModeSelect = el('#transportModeSelect');
    const vehicleCountField = el('#vehicleCountField');
    transportModeSelect.onchange = () => {
      vehicleCountField.hidden = transportModeSelect.value !== 'car';
    };
    el('#saveTripSettingsBtn').onclick = async () => {
      const travelerCount = Number(el('#travelerCountInput').value);
      const transportMode = transportModeSelect.value;
      const vehicleCount = transportMode === 'car' ? Number(el('#vehicleCountInput').value) : 0;
      try {
        const result = await api(`/rooms/${room.id}/trip-settings`, {
          method: 'POST',
          body: { travelerCount, transportMode, vehicleCount },
        });
        if (result.notice) showToast(result.notice);
        render();
      } catch (e) { showToast(e.message, 'error'); }
    };
  }

  document.querySelectorAll('#preferenceGrid input[type=checkbox]').forEach(input => {
    input.onchange = () => {
      const checked = [...document.querySelectorAll('#preferenceGrid input:checked')];
      if (checked.length > 3) {
        input.checked = false;
        showToast('여행 취향은 최대 3개까지 선택할 수 있어요.', 'error');
      }
      input.closest('.preference-option').classList.toggle('selected', input.checked);
    };
  });

  el('#savePreferencesBtn').onclick = async () => {
    const preferences = [...document.querySelectorAll('#preferenceGrid input:checked')].map(input => input.value);
    const customPreference = el('#customPreferenceInput').value.trim();
    try {
      await api(`/rooms/${room.id}/preferences`, { method: 'POST', body: { preferences, customPreference } });
      showToast('취향을 저장했어요.', 'success');
      render();
    } catch (e) { showToast(e.message, 'error'); }
  };

  if (isHost) {
    const confirmBtn = el('#confirmDateBtn');
    if (confirmBtn) confirmBtn.onclick = async () => {
      const date = el('#finalDateSelect').value;
      const nights = Number(el('#tripNightsSelect').value);
      if (!date) { showToast('날짜를 선택해주세요.', 'error'); return; }
      try {
        await api(`/rooms/${room.id}/select-date`, { method: 'POST', body: { date, nights } });
        render();
      } catch (e) { showToast(e.message, 'error'); }
    };
    const drawBtn = el('#drawBtn');
    if (drawBtn) drawBtn.onclick = async () => {
      if (!await confirmAction(room.dresscodeEnabled ? '여행지와 드레스코드를 랜덤으로 추첨할까요?' : '여행지를 랜덤으로 추첨할까요?')) return;
      try {
        const names = await regionNames();
        const result = await api(`/rooms/${room.id}/draw`, { method: 'POST' });
        await runDrawAnimation({ pool: names, final: result.region.name, subPool: tripMembers.map(m => m.dresscode).filter(Boolean), subFinal: result.dresscode });
        roomTabState.delete(room.id);
        state.roomSummary = { roomId: room.id, regionId: result.region.id }; // 내가 뽑은 결과는 다시 연출하지 않음
        render();
      } catch (e) { showToast(e.message, 'error'); }
    };
  }

  startRoomSync(room.id);
  // 다른 멤버(방장)가 여행지를 정했으면 같은 추첨 연출로 결과를 보여줌
  if (remote && previousSummary && room.selectedRegion && previousSummary.regionId !== room.selectedRegion.id) {
    regionNames().then(names => runDrawAnimation({ label: '🎉 여행지가 정해졌어요!', pool: names, final: room.selectedRegion.name, subFinal: room.selectedDresscode, duration: 1800 }));
  }

  bindMemberManagement(room, members);
  loadRoomFinance(room, members);
  loadPacking(room);
  loadLodging(room);
  loadPastTrips(room);
  bindOriginForm(room, isHost, me, tripMembers, mapKey);
  if (room.activeTripId) bindEasyRegions(room, isHost, tripMembers, mapKey);
  loadKakaoPanel(el('#kakaoSocialPanel'), room);
  if (room.activeTripId && room.status === 'decided') loadRecommendations(room.id);
}

function tripLengthLabel(nights) {
  return Number(nights) === 0 ? '당일치기' : `${nights}박 ${Number(nights) + 1}일`;
}

function travelMinutesLabel(minutes) {
  if (!Number.isFinite(Number(minutes))) return '';
  const value = Number(minutes);
  if (value < 60) return `약 ${value}분`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `약 ${hours}시간 ${rest}분` : `약 ${hours}시간`;
}

let kakaoMapsLoader = null;

function loadKakaoMapsSdk(javascriptKey) {
  if (window.kakao?.maps) return Promise.resolve(window.kakao.maps);
  if (kakaoMapsLoader) return kakaoMapsLoader;

  kakaoMapsLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(javascriptKey)}&libraries=services&autoload=false`;
    script.onload = () => window.kakao.maps.load(() => resolve(window.kakao.maps));
    script.onerror = () => reject(new Error('카카오 지도 SDK를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
  return kakaoMapsLoader;
}

async function renderKakaoCourseMap(container, itineraryDays, javascriptKey) {
  const maps = await loadKakaoMapsSdk(javascriptKey);
  const mappedDays = itineraryDays.map(day => ({
    dayNumber: day.dayNumber,
    stops: day.stops.filter(stop => ['kakao', 'tourapi'].includes(stop.place.source)
      && Number.isFinite(Number(stop.place.mapX)) && Number.isFinite(Number(stop.place.mapY))),
  })).filter(day => day.stops.length);
  const firstStop = mappedDays[0]?.stops[0];
  if (!firstStop) throw new Error('카카오 지도에 표시할 좌표가 없습니다.');

  const center = new maps.LatLng(Number(firstStop.place.mapY), Number(firstStop.place.mapX));
  const map = new maps.Map(container, { center, level: 7 });
  const bounds = new maps.LatLngBounds();
  const colors = ['#ff6b35', '#4d77ff', '#16a085', '#9b59b6', '#e67e22', '#2c3e50', '#c0392b', '#00897b'];

  for (const day of mappedDays) {
    const path = day.stops.map(stop => {
      const position = new maps.LatLng(Number(stop.place.mapY), Number(stop.place.mapX));
      bounds.extend(position);
      new maps.Marker({ map, position, title: `${day.dayNumber}일차 · ${stop.place.name}` });
      return position;
    });
    if (path.length > 1) {
      new maps.Polyline({
        map,
        path,
        strokeWeight: 4,
        strokeColor: colors[(day.dayNumber - 1) % colors.length],
        strokeOpacity: 0.8,
        strokeStyle: 'solid',
      });
    }
  }
  map.setBounds(bounds);
}

function renderResultCard(room) {
  const region = room.selectedRegion;
  if (!region) return '';
  return `
    <div class="card">
      <div class="region-result">
        <div style="font-size:13px;color:var(--muted)">🎉 우리 여행지</div>
        <div class="region-name">${escapeHtml(region.name)}</div>
        ${room.selectedDate ? `<div class="trip-period-result">${escapeHtml(room.selectedDate)}${room.selectedEndDate !== room.selectedDate ? ` ~ ${escapeHtml(room.selectedEndDate)}` : ''} · ${tripLengthLabel(room.tripNights)}</div>` : ''}
        <div class="trip-period-result">${room.travelerCount}명 · ${room.transportMode === 'car' ? `차량 ${room.vehicleCount}대` : '대중교통·도보'} · ${room.accommodation ? `숙소 ${escapeHtml(room.accommodation.name)}` : '숙소 미정'}</div>
        ${room.selectedDresscode ? `<div class="dresscode-final">드레스코드: ${escapeHtml(room.selectedDresscode)}</div>` : ''}
      </div>
    </div>
    <details class="card collapsible-card" open>
      <summary><h2>📍 맞춤 방문 장소</h2></summary>
      <div class="collapsible-card-content" id="recommendationCard">
        <p class="desc">멤버들의 여행 취향을 반영해 추천 장소를 불러오는 중...</p>
      </div>
    </details>
  `;
}

async function loadRecommendations(roomId) {
  const card = el('#recommendationCard');
  if (!card) return;

  try {
    const data = await api(`/rooms/${roomId}/recommendations`);
    if (state.roomId !== roomId || !el('#recommendationCard')) return;

    const voteSummary = data.preferences
      .filter(preference => preference.votes > 0)
      .sort((a, b) => b.votes - a.votes)
      .map(preference => `${escapeHtml(preference.label)} ${preference.votes}표`)
      .join(' · ');
    const customVoteSummary = (data.customPreferences || [])
      .slice(0, 4)
      .map(preference => `기타 “${escapeHtml(preference.keyword)}” ${preference.votes}표`)
      .join(' · ');
    const combinedPreferenceSummary = [voteSummary, customVoteSummary].filter(Boolean).join(' · ');
    const notices = data.notices || (data.notice ? [data.notice] : []);
    const itineraryDays = data.itinerary?.days || [];
    const hasKakaoMapPlaces = itineraryDays.some(day => day.stops.some(stop =>
      ['kakao', 'tourapi'].includes(stop.place.source)
      && Number.isFinite(Number(stop.place.mapX)) && Number.isFinite(Number(stop.place.mapY))));
    const placeLink = item => item.placeUrl
      || `https://map.kakao.com/link/search/${encodeURIComponent(`${item.name} ${item.address || ''}`)}`;
    const placeLinkLabel = item => item.source === 'google'
      ? 'Google Maps에서 보기'
      : item.source === 'naver' ? '네이버 지도에서 보기' : '카카오맵에서 보기';

    card.innerHTML = `
      <div class="recommendation-heading">
        <div>
          <p class="desc">${combinedPreferenceSummary || '아직 취향 선택이 없어 다양한 장소를 추천했어요.'}</p>
        </div>
        <span class="source-badge">${escapeHtml(data.providerLabel)}</span>
      </div>
      <div class="integration-status">
        <span class="${data.integrationStatus?.tourApi?.connected ? 'connected' : ''}">TourAPI ${data.integrationStatus?.tourApi?.connected ? '연결됨' : data.integrationStatus?.tourApi?.configured ? '연결 오류' : '키 필요'}</span>
        <span class="${data.integrationStatus?.kakaoLocal?.connected ? 'connected' : ''}">카카오 로컬 ${data.integrationStatus?.kakaoLocal?.connected ? '연결됨' : data.integrationStatus?.kakaoLocal?.configured ? '연결 오류' : '키 필요'}</span>
        <span class="${data.integrationStatus?.naverLocal?.connected ? 'connected' : ''}">네이버 지역검색 ${data.integrationStatus?.naverLocal?.connected ? '연결됨' : data.integrationStatus?.naverLocal?.configured ? '연결 오류' : '키 필요'}</span>
      </div>
      ${notices.map(notice => `<div class="recommendation-notice">${escapeHtml(notice)}</div>`).join('')}
      <div class="route-context">
        <strong>${data.itinerary.planning.travelerCount}명 · ${escapeHtml(data.itinerary.planning.transportLabel)}</strong>
        <span>${data.itinerary.planning.accommodation
          ? `숙소 ${escapeHtml(data.itinerary.planning.accommodation.name)}에서 출발·복귀 · 반경 ${data.itinerary.planning.maxDistanceFromAccommodationKm}km 이내`
          : '숙소를 저장하면 숙소 출발·복귀 동선으로 다시 구성합니다.'}</span>
        ${data.itinerary.planning.seatWarning ? `<small>⚠️ ${escapeHtml(data.itinerary.planning.seatWarning)}</small>` : ''}
      </div>
      ${data.kakaoMap?.configured && hasKakaoMapPlaces ? `
        <div class="course-map-actions">
          <button class="secondary" id="toggleCourseMapBtn">카카오맵으로 코스 보기</button>
          <div class="course-map" id="courseMap" hidden></div>
        </div>
      ` : ''}
      ${itineraryDays.length ? `
        <details class="itinerary-section nested-collapsible" open>
          <summary><h3>🗓️ ${tripLengthLabel(data.itinerary.nights)} 추천 코스</h3></summary>
          <div class="itinerary-days">
          ${itineraryDays.map(day => `
            <div class="itinerary-day">
              <h4>${day.dayNumber}일차${day.date ? ` · ${escapeHtml(day.date)}` : ''}</h4>
              ${day.stops.length ? `
                <div class="itinerary-list">
                  ${day.stops.map(stop => `
                    <div class="itinerary-stop">
                      <div class="itinerary-time">${escapeHtml(stop.time)}</div>
                      <div class="itinerary-dot"></div>
                      <div class="itinerary-content">
                        <span>${escapeHtml(stop.title)}</span>
                        <strong>${escapeHtml(stop.place.name)}</strong>
                        <small>${escapeHtml(stop.place.reason)}${stop.travelKmFromPrevious !== null ? ` · ${stop.travelOrigin === 'accommodation' ? '숙소에서' : '이전 장소에서'} 직선 약 ${stop.travelKmFromPrevious}km · ${escapeHtml(data.itinerary.planning.transportLabel)} ${travelMinutesLabel(stop.travelMinutesFromPrevious)}` : ''}</small>
                        <a href="${escapeHtml(placeLink(stop.place))}" target="_blank" rel="noopener noreferrer">${escapeHtml(placeLinkLabel(stop.place))} →</a>
                      </div>
                    </div>
                  `).join('')}
                </div>
                ${day.returnKmToAccommodation !== null ? `<div class="itinerary-return">↩ 숙소 복귀 직선 약 ${day.returnKmToAccommodation}km · ${travelMinutesLabel(day.returnMinutesToAccommodation)} · 하루 이동 예상 ${day.estimatedTravelKm}km</div>` : ''}
              ` : '<p class="itinerary-empty">추천 장소를 더 불러오면 이 날짜의 코스를 채울 수 있어요.</p>'}
            </div>
          `).join('')}
          </div>
        </details>
      ` : ''}
      <div class="place-list-heading">
        <h3 class="place-list-title">취향 기반 후보 장소 <span>${data.items.length}곳</span></h3>
        <button class="ghost small" id="toggleCandidatePlacesBtn" aria-expanded="false" aria-controls="candidatePlaces">펼쳐보기</button>
      </div>
      <div class="recommendation-grid" id="candidatePlaces" hidden>
        ${data.items.map(item => {
          const mapUrl = placeLink(item);
          return `
            <article class="place-card">
              ${item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="${escapeHtml(item.name)}" loading="lazy" />` : '<div class="place-image-placeholder">🧭</div>'}
              <div class="place-card-body">
                <div class="place-meta"><span class="place-category">${escapeHtml(item.category)}</span><span>${escapeHtml(item.sourceLabel || '')}</span></div>
                <h3>${escapeHtml(item.name)}</h3>
                <p class="place-reason">${escapeHtml(item.reason)}</p>
                ${item.address ? `<p class="place-address">${escapeHtml(item.address)}</p>` : ''}
                <a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(placeLinkLabel(item))} →</a>
              </div>
            </article>
          `;
        }).join('')}
      </div>
      <p class="source-note">장소 정보 출처: ${escapeHtml(data.providerLabel)} · 방문 전 운영시간과 휴무일을 확인해주세요.</p>
    `;

    const mapButton = el('#toggleCourseMapBtn');
    if (mapButton) {
      mapButton.onclick = async () => {
        const container = el('#courseMap');
        if (!container.hidden) {
          container.hidden = true;
          mapButton.textContent = '카카오맵으로 코스 보기';
          return;
        }
        container.hidden = false;
        mapButton.disabled = true;
        mapButton.textContent = '지도를 불러오는 중...';
        try {
          await renderKakaoCourseMap(container, itineraryDays, data.kakaoMap.javascriptKey);
          mapButton.textContent = '코스 지도 접기';
        } catch (error) {
          container.innerHTML = `<div class="error-msg">${escapeHtml(error.message)}</div>`;
          mapButton.textContent = '지도 다시 불러오기';
        } finally {
          mapButton.disabled = false;
        }
      };
    }
    const candidateButton = el('#toggleCandidatePlacesBtn');
    const candidatePlaces = el('#candidatePlaces');
    candidateButton.onclick = () => {
      const willOpen = candidatePlaces.hidden;
      candidatePlaces.hidden = !willOpen;
      candidateButton.setAttribute('aria-expanded', String(willOpen));
      candidateButton.textContent = willOpen ? '접기' : '펼쳐보기';
    };
  } catch (error) {
    card.innerHTML = `
      <div class="error-msg">${escapeHtml(error.message)}</div>
      <button class="secondary" id="retryRecommendationsBtn">다시 불러오기</button>
    `;
    el('#retryRecommendationsBtn').onclick = () => loadRecommendations(roomId);
  }
}

function shiftMonth(delta) {
  let { year, month } = calendarCursor;
  month += delta;
  if (month < 0) { month = 11; year -= 1; }
  if (month > 11) { month = 0; year += 1; }
  calendarCursor = { year, month };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function renderCalendar(tally, bestDates, selectedDate, selectedEndDate, votersByDate = {}) {
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
    const isBest = bestDates.includes(dateStr) && count > 0;
    if (localSelectedDates.has(dateStr)) cell.classList.add('selected');
    if (selectedDate && selectedEndDate && dateStr >= selectedDate && dateStr <= selectedEndDate) cell.classList.add('trip-range');
    if (selectedDate === dateStr) cell.classList.add('final');
    // 확정 가능성이 가장 높은 날은 색 대신 숫자 위 '유력!' 글씨로 표시
    cell.innerHTML = `${isBest ? '<span class="best-label">유력!</span>' : ''}<span>${d}</span>${count ? `<button type="button" class="count" aria-label="${month + 1}월 ${d}일 가능한 사람 보기">${count}명</button>` : ''}`;
    cell.onclick = () => {
      editingSinceRender = true; // 저장 전 날짜 선택이 실시간 반영으로 사라지지 않게
      if (localSelectedDates.has(dateStr)) localSelectedDates.delete(dateStr);
      else localSelectedDates.add(dateStr);
      cell.classList.toggle('selected');
    };
    const countButton = cell.querySelector('.count');
    if (countButton) countButton.onclick = event => {
      event.stopPropagation();
      const box = el('#dateVoters');
      box.hidden = false;
      box.innerHTML = `<strong>${month + 1}월 ${d}일 가능 (${count}명)</strong> ${(votersByDate[dateStr] || []).map(escapeHtml).join(', ')}`;
    };
    grid.appendChild(cell);
  }
}

init();
