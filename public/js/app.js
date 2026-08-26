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

  const { room, members, tally, bestDates, isHost } = data;
  const me = members.find(m => m.id === state.user.id);
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

    ${room.status === 'decided' ? renderResultCard(room) : ''}

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
      ${bestDates.length ? `<p class="desc" style="margin-top:12px">🔥 최다 인원(${data.bestCount}명) 가능일: <strong>${bestDates.join(', ')}</strong></p>` : ''}
      ${isHost ? `
        <div class="row" style="margin-top:8px">
          <select id="finalDateSelect">
            <option value="">최종 날짜 선택...</option>
            ${bestDates.map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
          <button class="secondary" id="confirmDateBtn">이 날짜로 확정</button>
        </div>
      ` : ''}
      ${room.selectedDate ? `<p class="desc" style="margin-top:8px">✅ 확정된 날짜: <strong>${room.selectedDate}</strong></p>` : ''}
    </div>

    <div class="card">
      <h2>👗 드레스 코드 입력하기</h2>
      <p class="desc">원하는 드레스 코드를 자유롭게 적어주세요. (예: 하와이안 셔츠, 전신 블랙 등)</p>
      <input type="text" id="dresscodeInput" placeholder="원하는 드레스 코드" maxlength="40" value="${escapeHtml(me?.dresscode || '')}" />
      <button class="block secondary" id="saveDresscodeBtn">저장</button>
    </div>

    <div class="card">
      <h2>👥 참여 멤버 (${members.length}명)</h2>
      <ul class="member-list">
        ${members.map(m => `
          <li>
            <span>${escapeHtml(m.nickname)} ${m.id === room.hostUserId ? '<span class="badge host">방장</span>' : ''}</span>
            <span>${m.dresscode ? `<span class="dresscode-tag">${escapeHtml(m.dresscode)}</span>` : '<span style="color:#bbb">미입력</span>'} · 가능일 ${m.availability.length}개</span>
          </li>
        `).join('')}
      </ul>
    </div>

    ${isHost ? `
      <div class="card">
        <h2>🎲 여행지 & 드레스코드 추첨</h2>
        <p class="desc">모든 인원이 다 모였다면, 지금 랜덤으로 여행지와 드레스코드를 뽑아보세요!</p>
        <button class="block" id="drawBtn">${room.status === 'decided' ? '다시 추첨하기' : '추첨하기'}</button>
      </div>
    ` : ''}
  `;

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

  renderCalendar(tally, bestDates, room.selectedDate);
  el('#prevMonth').onclick = () => { shiftMonth(-1); renderCalendar(tally, bestDates, room.selectedDate); };
  el('#nextMonth').onclick = () => { shiftMonth(1); renderCalendar(tally, bestDates, room.selectedDate); };

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
    const confirmBtn = el('#confirmDateBtn');
    if (confirmBtn) confirmBtn.onclick = async () => {
      const date = el('#finalDateSelect').value;
      if (!date) { alert('날짜를 선택해주세요.'); return; }
      try {
        await api(`/rooms/${room.id}/select-date`, { method: 'POST', body: { date } });
        render();
      } catch (e) { alert(e.message); }
    };
    const drawBtn = el('#drawBtn');
    if (drawBtn) drawBtn.onclick = async () => {
      if (!confirm('여행지와 드레스코드를 랜덤으로 추첨할까요?')) return;
      try {
        await api(`/rooms/${room.id}/draw`, { method: 'POST' });
        render();
      } catch (e) { alert(e.message); }
    };
  }
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
