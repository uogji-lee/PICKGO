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

  const { room, members, tally, bestDates, isHost, preferenceOptions } = data;
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
      <h2>✨ 내 여행 취향</h2>
      <p class="desc">최대 3개를 골라주세요. 멤버들의 선택을 합쳐 방문 장소를 추천해요.</p>
      <div class="preference-grid" id="preferenceGrid">
        ${preferenceOptions.map(option => `
          <label class="preference-option ${(me?.preferences || []).includes(option.id) ? 'selected' : ''}">
            <input type="checkbox" value="${option.id}" ${(me?.preferences || []).includes(option.id) ? 'checked' : ''} />
            <span>${escapeHtml(option.label)}</span>
          </label>
        `).join('')}
      </div>
      <button class="block secondary" id="savePreferencesBtn">내 취향 저장</button>
    </div>

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
            <span>${m.dresscode ? `<span class="dresscode-tag">${escapeHtml(m.dresscode)}</span>` : '<span style="color:#bbb">미입력</span>'} · 취향 ${m.preferences.length}개 · 가능일 ${m.availability.length}개</span>
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
    try {
      await api(`/rooms/${room.id}/preferences`, { method: 'POST', body: { preferences } });
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
        render();
      } catch (e) { alert(e.message); }
    };
  }

  if (room.status === 'decided') loadRecommendations(room.id);
}

function tripLengthLabel(nights) {
  return Number(nights) === 0 ? '당일치기' : `${nights}박 ${Number(nights) + 1}일`;
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
        ${room.selectedDresscode ? `<div class="dresscode-final">드레스코드: ${escapeHtml(room.selectedDresscode)}</div>` : ''}
      </div>
    </div>
    <div class="card" id="recommendationCard">
      <h2>📍 맞춤 방문 장소</h2>
      <p class="desc">멤버들의 여행 취향을 반영해 추천 장소를 불러오는 중...</p>
    </div>
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
    const notices = data.notices || (data.notice ? [data.notice] : []);
    const itineraryDays = data.itinerary?.days || [];
    const placeLink = item => item.placeUrl
      || `https://map.kakao.com/link/search/${encodeURIComponent(`${item.name} ${item.address || ''}`)}`;

    card.innerHTML = `
      <div class="recommendation-heading">
        <div>
          <h2>📍 맞춤 방문 장소</h2>
          <p class="desc">${voteSummary || '아직 취향 선택이 없어 다양한 장소를 추천했어요.'}</p>
        </div>
        <span class="source-badge">${escapeHtml(data.providerLabel)}</span>
      </div>
      <div class="integration-status">
        <span class="${data.integrationStatus?.tourApi?.connected ? 'connected' : ''}">TourAPI ${data.integrationStatus?.tourApi?.connected ? '연결됨' : data.integrationStatus?.tourApi?.configured ? '연결 오류' : '키 필요'}</span>
        <span class="${data.integrationStatus?.kakaoLocal?.connected ? 'connected' : ''}">카카오 로컬 ${data.integrationStatus?.kakaoLocal?.connected ? '연결됨' : data.integrationStatus?.kakaoLocal?.configured ? '연결 오류' : '키 필요'}</span>
      </div>
      ${notices.map(notice => `<div class="recommendation-notice">${escapeHtml(notice)}</div>`).join('')}
      ${itineraryDays.length ? `
        <section class="itinerary-section">
          <h3>🗓️ ${tripLengthLabel(data.itinerary.nights)} 추천 코스</h3>
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
                        <small>${escapeHtml(stop.place.reason)}${stop.travelKmFromPrevious !== null ? ` · 이전 장소에서 직선 약 ${stop.travelKmFromPrevious}km` : ''}</small>
                        <a href="${escapeHtml(placeLink(stop.place))}" target="_blank" rel="noopener noreferrer">카카오맵에서 보기 →</a>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : '<p class="itinerary-empty">추천 장소를 더 불러오면 이 날짜의 코스를 채울 수 있어요.</p>'}
            </div>
          `).join('')}
        </section>
      ` : ''}
      <h3 class="place-list-title">취향 기반 후보 장소</h3>
      <div class="recommendation-grid">
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
                <a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">카카오맵에서 보기 →</a>
              </div>
            </article>
          `;
        }).join('')}
      </div>
      <p class="source-note">장소 정보 출처: ${escapeHtml(data.providerLabel)} · 방문 전 운영시간과 휴무일을 확인해주세요.</p>
    `;
  } catch (error) {
    card.innerHTML = `
      <h2>📍 맞춤 방문 장소</h2>
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
