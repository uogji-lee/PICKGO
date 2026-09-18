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

// ---------- 초기화 ----------
async function init() {
  const oauthError = new URLSearchParams(location.hash.slice(1)).get('kakao_error');
  const oauthMessages = { state: '카카오 로그인 요청이 만료되었습니다. 다시 시도해주세요.', cancelled: '카카오 로그인을 취소했습니다.', configuration: '카카오 로그인 설정을 확인해주세요. Redirect URI·클라이언트 시크릿 설정이 필요합니다.', already_linked: '이미 다른 PICKGO 계정에 연결된 카카오 계정입니다.', login_required: 'PICKGO에 먼저 로그인해주세요.', friends_permission: '카카오 친구 목록 권한을 먼저 설정해주세요.' };
  state.authNotice = oauthMessages[oauthError] || (location.hash === '#kakao_connected' ? '카카오 계정이 연결되었습니다.' : '');
  if (location.hash.startsWith('#kakao')) history.replaceState(null, '', location.pathname);
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- 화면 렌더 ----------
function render() {
  renderUserBox();
  if (state.view === 'loading') {
    appEl().innerHTML = `<div class="card">불러오는 중...</div>`;
  } else if (state.view === 'auth') {
    renderAuth();
  } else if (state.view === 'rooms') {
    renderRoomList();
  } else if (state.view === 'room') {
    renderRoomDetail();
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
      <input type="text" id="nickname" placeholder="닉네임 (2~12자)" maxlength="12" />
      <input type="password" id="password" placeholder="비밀번호 (신규 가입은 8자 이상)" />
      <button class="block" id="submitBtn">로그인</button>
    </div>
  `;
  configureKakaoLogin();
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    el('#tabLogin').className = m === 'login' ? 'secondary' : '';
    el('#tabSignup').className = m === 'signup' ? 'secondary' : '';
    el('#submitBtn').textContent = m === 'login' ? '로그인' : '회원가입';
  };
  el('#tabLogin').onclick = () => setMode('login');
  el('#tabSignup').onclick = () => setMode('signup');
  el('#submitBtn').onclick = async () => {
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
}

// ---------- 방 목록 화면 ----------
async function renderRoomList() {
  appEl().innerHTML = `<div class="card">불러오는 중...</div>`;
  let rooms = [];
  try {
    const data = await api('/rooms/mine');
    rooms = data.rooms;
  } catch (e) { /* ignore */ }

  appEl().innerHTML = `
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

  loadKakaoPanel(el('#kakaoSocialPanel'));
  el('#createRoomBtn').onclick = async () => {
    const title = el('#newRoomTitle').value.trim();
    try {
      const { roomId } = await api('/rooms', { method: 'POST', body: { title } });
      state.roomId = roomId;
      state.view = 'room';
      render();
    } catch (e) { alert(e.message); }
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

async function renderRoomDetail() {
  appEl().innerHTML = `<div class="card">불러오는 중...</div>`;
  let data;
  try {
    data = await api(`/rooms/${state.roomId}`);
  } catch (e) {
    appEl().innerHTML = `<div class="card"><div class="error-msg">${escapeHtml(e.message)}</div>
      <button class="secondary" id="backBtn">방 목록으로</button></div>`;
    el('#backBtn').onclick = () => { state.view = 'rooms'; render(); };
    return;
  }

  const { room, members, tally, bestDates, isHost, preferenceOptions } = data;
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
          ${isHost ? `<button class="ghost small" id="editTitleBtn">방제 수정</button>` : ''}
        </div>
      </div>
      <div class="invite-box">
        초대코드 <span class="invite-code">${room.inviteCode}</span>
        <button class="ghost small" id="copyInviteBtn">복사</button>
      </div>
    </div>

    <nav class="room-tabs" role="tablist" aria-label="방 메뉴">
      ${[['course', '여행·코스'], ['conditions', '여행 조건'], ['finance', '회비·정산'], ['members', '멤버']].map(([key, label]) => `<button type="button" role="tab" id="tab-${key}" data-room-tab="${key}" aria-controls="panel-${key}" aria-selected="false" tabindex="-1">${label}</button>`).join('')}
    </nav>
    <p id="roomActionStatus" role="status" aria-live="polite"></p>
    <section id="panel-course" role="tabpanel" aria-labelledby="tab-course" tabindex="0" hidden>
    ${room.activeTripId && room.status === 'decided' ? renderResultCard(room) : ''}
    <div class="card"><p class="desc">${room.activeTripId ? '교통·숙소, 취향, 날짜와 재추첨은 여행 조건 탭에서 수정하세요.' : '같은 방에서 여행을 만들고 기록을 이어가세요.'}</p>${room.activeTripId ? '<button class="secondary" data-go-tab="conditions">여행 조건 수정</button>' : ''}<div id="tripManagement">여행 정보 불러오는 중…</div></div>
    </section>

    <section id="panel-finance" role="tabpanel" aria-labelledby="tab-finance" tabindex="0" hidden>
    <details class="card collapsible-card" open>
      <summary><h2>💰 회비 · 지출 · 정산</h2></summary>
      <div id="roomFinance" class="collapsible-card-content">공동금고 불러오는 중…</div>
    </details>
    </section>

    <section id="panel-conditions" role="tabpanel" aria-labelledby="tab-conditions" tabindex="0" hidden>
    ${!room.activeTripId ? '<div class="card"><p>먼저 여행·코스 탭에서 여행과 참석자를 정해주세요.</p><button class="secondary" data-go-tab="course">여행 만들러 가기</button></div>' : ''}
    <div ${room.activeTripId ? '' : 'hidden'}>
    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>🚗 교통·숙소 조건</h2></summary>
      <div class="collapsible-card-content">
      <p class="desc">인원과 이동수단, 숙소를 기준으로 하루 이동 범위와 방문 순서를 조정해요. 현재 참여 멤버는 ${members.length}명입니다.</p>
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
          <label class="trip-settings-wide">
            <span>숙소명 또는 주소</span>
            <input type="text" id="accommodationInput" maxlength="80" placeholder="예: 포항 라한호텔 또는 도로명 주소" value="${escapeHtml(room.accommodation?.name || '')}" />
          </label>
        </div>
        <button class="block secondary" id="saveTripSettingsBtn">교통·숙소 조건 저장</button>
      ` : `
        <div class="trip-settings-summary">
          <strong>${room.travelerCount}명 · ${room.transportMode === 'car' ? `차량 ${room.vehicleCount}대` : '대중교통·도보'}</strong>
          <span>${room.accommodation ? `숙소: ${escapeHtml(room.accommodation.name)}` : '숙소 미정'}</span>
        </div>
      `}
      ${room.accommodation ? `<p class="desc trip-settings-saved">📍 ${escapeHtml(room.accommodation.name)}${room.accommodation.address ? ` · ${escapeHtml(room.accommodation.address)}` : ''}</p>` : ''}
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
      <p class="desc">여행 갈 수 있는 날짜를 눌러서 표시해주세요. 굵은 테두리는 가장 많은 인원이 가능한 날짜예요.</p>
      <div class="month-nav">
        <button class="ghost small" id="prevMonth">◀</button>
        <span id="monthLabel"></span>
        <button class="ghost small" id="nextMonth">▶</button>
      </div>
      <div class="calendar-grid" id="calendarGrid"></div>
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
      <summary><h2>👗 드레스 코드 입력하기</h2></summary>
      <div class="collapsible-card-content">
      <p class="desc">원하는 드레스 코드를 자유롭게 적어주세요. (예: 하와이안 셔츠, 전신 블랙 등)</p>
      <input type="text" id="dresscodeInput" placeholder="원하는 드레스 코드" maxlength="40" value="${escapeHtml(me?.dresscode || '')}" />
      <button class="block secondary" id="saveDresscodeBtn">저장</button>
      </div>
    </details>

    </div>
    <div id="drawControls"></div>
    </section>
    <section id="panel-members" role="tabpanel" aria-labelledby="tab-members" tabindex="0" hidden>
    <details class="card collapsible-card" open><summary><h2>카카오 친구 · 방 초대</h2></summary><div id="kakaoSocialPanel" class="collapsible-card-content"></div></details>
    <details class="card collapsible-card" ${planningSectionsOpen}>
      <summary><h2>👥 참여 멤버 (${members.length}명)</h2></summary>
      <div class="collapsible-card-content">
      <ul class="member-list">
        ${members.map(m => `
          <li>
            <span>${escapeHtml(m.nickname)} <span class="badge ${m.role === 'host' ? 'host' : ''}">${roomRoles[m.role] || '멤버'}</span>${m.role === 'host' && m.isTreasurer ? '<span class="badge">💰 총무 겸임</span>' : ''}</span>
            <span>${m.dresscode ? `<span class="dresscode-tag">${escapeHtml(m.dresscode)}</span>` : '<span style="color:#bbb">미입력</span>'} · 취향 ${m.preferences.length}개${m.customPreference ? ` + 기타 “${escapeHtml(m.customPreference)}”` : ''} · 가능일 ${m.availability.length}개</span>
            ${memberManagementControls(m, room, isHost)}
          </li>
        `).join('')}
      </ul>
      </div>
    </details>
    </section>

    ${isHost && room.activeTripId ? `
      <details class="card collapsible-card" ${planningSectionsOpen}>
        <summary><h2>🎲 여행지 & 드레스코드 추첨</h2></summary>
        <div class="collapsible-card-content">
        <p class="desc">모든 인원이 다 모였다면, 지금 랜덤으로 여행지와 드레스코드를 뽑아보세요!</p>
        <button class="block" id="drawBtn">${room.status === 'decided' ? '다시 추첨하기' : '추첨하기'}</button>
        </div>
      </details>
    ` : ''}
  `;

  if (el('#drawBtn')) el('#drawControls').append(el('#drawBtn').closest('details'));
  bindRoomTabs(room);
  el('#backBtn').onclick = () => { state.view = 'rooms'; calendarCursor = null; render(); };

  el('#copyInviteBtn').onclick = () => {
    navigator.clipboard?.writeText(room.inviteCode).then(() => {
      el('#copyInviteBtn').textContent = '복사됨!';
      setTimeout(() => { el('#copyInviteBtn').textContent = '복사'; }, 1500);
    });
  };

  if (isHost) {
    const editBtn = el('#editTitleBtn');
    if (editBtn) editBtn.onclick = async () => {
      const newTitle = prompt('새 방제를 입력하세요', room.title);
      if (newTitle && newTitle.trim()) {
        try {
          await api(`/rooms/${room.id}/title`, { method: 'POST', body: { title: newTitle.trim() } });
          render();
        } catch (e) { alert(e.message); }
      }
    };
  }

  renderCalendar(tally, bestDates, room.selectedDate, room.selectedEndDate);
  el('#prevMonth').onclick = () => { shiftMonth(-1); renderCalendar(tally, bestDates, room.selectedDate, room.selectedEndDate); };
  el('#nextMonth').onclick = () => { shiftMonth(1); renderCalendar(tally, bestDates, room.selectedDate, room.selectedEndDate); };

  el('#saveAvailBtn').onclick = async () => {
    try {
      await api(`/rooms/${room.id}/availability`, { method: 'POST', body: { dates: Array.from(localSelectedDates) } });
      render();
    } catch (e) { alert(e.message); }
  };

  el('#saveDresscodeBtn').onclick = async () => {
    const text = el('#dresscodeInput').value.trim();
    try {
      await api(`/rooms/${room.id}/dresscode`, { method: 'POST', body: { text } });
      render();
    } catch (e) { alert(e.message); }
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
      const accommodationName = el('#accommodationInput').value.trim();
      try {
        const result = await api(`/rooms/${room.id}/trip-settings`, {
          method: 'POST',
          body: { travelerCount, transportMode, vehicleCount, accommodationName },
        });
        if (result.notice) alert(result.notice);
        render();
      } catch (e) { alert(e.message); }
    };
  }

  document.querySelectorAll('#preferenceGrid input[type=checkbox]').forEach(input => {
    input.onchange = () => {
      const checked = [...document.querySelectorAll('#preferenceGrid input:checked')];
      if (checked.length > 3) {
        input.checked = false;
        alert('여행 취향은 최대 3개까지 선택할 수 있어요.');
      }
      input.closest('.preference-option').classList.toggle('selected', input.checked);
    };
  });

  el('#savePreferencesBtn').onclick = async () => {
    const preferences = [...document.querySelectorAll('#preferenceGrid input:checked')].map(input => input.value);
    const customPreference = el('#customPreferenceInput').value.trim();
    try {
      await api(`/rooms/${room.id}/preferences`, { method: 'POST', body: { preferences, customPreference } });
      render();
    } catch (e) { alert(e.message); }
  };

  if (isHost) {
    const confirmBtn = el('#confirmDateBtn');
    if (confirmBtn) confirmBtn.onclick = async () => {
      const date = el('#finalDateSelect').value;
      const nights = Number(el('#tripNightsSelect').value);
      if (!date) { alert('날짜를 선택해주세요.'); return; }
      try {
        await api(`/rooms/${room.id}/select-date`, { method: 'POST', body: { date, nights } });
        render();
      } catch (e) { alert(e.message); }
    };
    const drawBtn = el('#drawBtn');
    if (drawBtn) drawBtn.onclick = async () => {
      if (!confirm('여행지와 드레스코드를 랜덤으로 추첨할까요?')) return;
      try {
        await api(`/rooms/${room.id}/draw`, { method: 'POST' });
        roomTabState.delete(room.id);
        render();
      } catch (e) { alert(e.message); }
    };
  }

  bindMemberManagement(room, members);
  loadRoomFinance(room, members);
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
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(javascriptKey)}&autoload=false`;
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
        <div style="font-size:13px;color:var(--muted)">🎉 추첨 결과</div>
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

function renderCalendar(tally, bestDates, selectedDate, selectedEndDate) {
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
    if (selectedDate && selectedEndDate && dateStr >= selectedDate && dateStr <= selectedEndDate) cell.classList.add('trip-range');
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
