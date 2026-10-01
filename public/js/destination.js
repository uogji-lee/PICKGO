// 🎯 여행지 정하기: 완전 랜덤 / 가기 쉬운 곳(중간지점 TOP 5 투표) / 원하는 곳(검색 후보 투표) + 다시 뽑기 제한
function destinationVoteButton(item, data) {
  const mine = data.myVote === item.key;
  return `<div class="dest-vote">
    ${data.canVote ? `<button type="button" class="small ${mine ? '' : 'secondary'}" data-dest-vote="${escapeHtml(item.key)}" aria-pressed="${mine}">${mine ? '✓ 내 투표' : '투표'}</button>` : ''}
    <button type="button" class="poll-count" data-dest-voters="${escapeHtml(item.key)}" aria-expanded="false" aria-label="${escapeHtml(item.region.name)} 투표한 사람 보기">${item.voters.length}명 ▾</button>
    <ul class="poll-voters" data-dest-voter-list="${escapeHtml(item.key)}" hidden>${item.voters.length ? item.voters.map(name => `<li>${escapeHtml(name)}</li>`).join('') : '<li class="muted">아직 투표한 사람이 없어요</li>'}</ul>
  </div>`;
}

function destinationCandidateList(data) {
  const maxVotes = Math.max(0, ...data.candidates.map(item => item.voters.length));
  return `<ol class="dest-list">${data.candidates.map((item, index) => `
    <li class="dest-item ${data.selected?.key === item.key ? 'chosen' : ''}">
      <div class="dest-main">
        <span class="easy-region-rank">${index + 1}</span>
        <div class="dest-text">
          <strong>${escapeHtml(item.region.name)}</strong>
          <small>${item.averageMinutes != null ? `중간지점에서 ${item.distanceFromMidpointKm}km · 평균 ${formatTravelMinutes(item.averageMinutes)} · 최대 ${formatTravelMinutes(item.maxMinutes)}` : `${escapeHtml(item.creator || '')}님이 올림${item.region.builtin ? '' : ' · 검색 지역'}`}</small>
          ${data.selected?.key === item.key ? '<span class="badge host">현재 여행지</span>' : item.voters.length && item.voters.length === maxVotes ? '<span class="badge">최다 득표</span>' : ''}
        </div>
        ${destinationVoteButton(item, data)}
      </div>
      ${data.isHost || item.canDelete ? `<div class="dest-actions">
        ${data.isHost && data.selected?.key !== item.key ? `<button type="button" class="small secondary" data-dest-confirm="${escapeHtml(item.key)}">이 지역으로 확정</button>` : ''}
        ${item.canDelete ? `<button type="button" class="ghost small" data-dest-delete="${escapeHtml(item.key)}">후보 삭제</button>` : ''}
      </div>` : ''}
    </li>`).join('')}</ol>`;
}

async function loadDestination(room, isHost, tripMembers) {
  const root = document.getElementById('destinationPanel');
  if (!root || !room.activeTripId) return;
  let data;
  try { data = await api(`/rooms/${room.id}/destination`); }
  catch (error) { if (root.isConnected) root.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p>`; return; }
  if (!root.isConnected) return;
  const drawLabel = data.method === 'random' ? '🎲 전국에서 추첨하기' : '🎲 후보 중에서 뽑기';
  const drawText = data.drawCount ? `${drawLabel.replace('추첨하기', '다시 추첨').replace('뽑기', '다시 뽑기')} (${data.drawsLeft}번 남음)` : drawLabel;
  const methodHelp = {
    random: '전국 인기 여행지 48곳 중에서 랜덤으로 뽑아요.',
    easy: '참석자들이 공유한 출발지의 중간지점 근처에서 모두가 가기 공평한 5곳을 추천해요. 투표하고 방장이 확정하거나 그중에서 뽑아요.',
    wish: '가고 싶은 지역을 검색해서 후보로 올리고 투표해요. 방장이 확정하거나 후보 중에서 뽑아요.',
  }[data.method];
  root.innerHTML = `
    <div class="dest-head">
      ${data.isHost
        ? `<label class="dest-method">정하는 방식<select id="destMethodSelect">${Object.entries(data.methods).map(([key, label]) => `<option value="${key}" ${key === data.method ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>`
        : `<p class="dest-method-label">정하는 방식: <strong>${escapeHtml(data.methods[data.method])}</strong></p>`}
      <span class="dest-draws">뽑기 ${data.drawsLeft}번 남음 <small>(처음 1번 + 다시 뽑기 ${data.drawLimit}번)</small></span>
    </div>
    <p class="desc">${methodHelp}</p>
    ${data.selected ? `<p class="dest-selected">✅ 현재 여행지: <strong>${escapeHtml(data.selected.name)}</strong></p>` : ''}
    ${data.method === 'easy' ? `
      ${data.missingOrigins.length ? `<p class="recommendation-notice">출발지를 아직 공유하지 않은 참석자: ${data.missingOrigins.map(escapeHtml).join(', ')} · 위 <button type="button" class="link-btn" data-scroll-origin>📍 출발지 공유</button>에서 입력해주세요.</p>` : ''}
      ${data.midpoint ? `<p class="midpoint-label">📍 참석자 중간지점: <strong>${escapeHtml(data.midpoint.label)}</strong></p>` : ''}
      ${data.candidates.length ? destinationCandidateList(data) : '<p class="empty-state">출발지가 모이면 후보 5곳이 나타나요.</p>'}` : ''}
    ${data.method === 'wish' ? `
      ${data.canVote || data.isHost ? `<form id="destSearchForm" class="origin-search dest-search"><input id="destSearchInput" maxlength="30" placeholder="가고 싶은 지역 검색 (예: 정선, 군산, 남해)" aria-label="지역 검색"><button class="secondary">검색</button></form>
        <ul id="destSearchResults" class="origin-results"></ul>
        ${data.searchProvider === 'builtin' ? '<p class="desc">카카오 키를 설정하면 전국 어느 지역이든 검색돼요. 지금은 인기 여행지 48곳 안에서만 검색돼요.</p>' : ''}` : '<p class="desc">이번 여행 참석자만 후보를 올리고 투표할 수 있어요.</p>'}
      ${data.candidates.length ? destinationCandidateList(data) : '<p class="empty-state">아직 올라온 후보가 없어요.</p>'}` : ''}
    ${data.isHost ? `<button type="button" class="block" id="destDrawBtn" ${data.drawsLeft && (data.method === 'random' || data.candidates.length) ? '' : 'disabled'}>${data.drawsLeft ? drawText : '뽑기를 모두 썼어요'}</button>` : (data.method === 'random' ? '<p class="desc">방장이 추첨하면 모두의 화면에 결과가 떠요.</p>' : '')}
    <p id="destStatus" role="status"></p>`;

  const status = text => { const box = document.getElementById('destStatus'); if (box) box.textContent = text; };
  const post = async (button, path, body = {}) => {
    if (button) button.disabled = true;
    try { return await api(`/rooms/${room.id}/destination${path}`, { method: 'POST', body }); }
    catch (error) { showToast(error.message, 'error'); if (button) button.disabled = false; return null; }
  };
  const scrollOrigin = root.querySelector('[data-scroll-origin]');
  if (scrollOrigin) scrollOrigin.onclick = () => document.getElementById('originForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const methodSelect = document.getElementById('destMethodSelect');
  if (methodSelect) methodSelect.onchange = async () => {
    if (!await confirmAction('여행지 정하는 방식을 바꿀까요? 지금까지의 투표는 초기화돼요. 뽑기 횟수는 그대로예요.')) { methodSelect.value = data.method; return; }
    if (await post(methodSelect, '/method', { method: methodSelect.value })) { showToast('방식을 바꿨어요.', 'success'); render(); }
  };

  root.querySelectorAll('[data-dest-vote]').forEach(button => { button.onclick = async () => {
    if (await post(button, '/vote', { key: button.dataset.destVote })) loadDestination(room, isHost, tripMembers);
  }; });
  root.querySelectorAll('[data-dest-voters]').forEach(button => { button.onclick = () => {
    const list = root.querySelector(`[data-dest-voter-list="${CSS.escape(button.dataset.destVoters)}"]`);
    const open = list.hidden;
    root.querySelectorAll('[data-dest-voter-list]').forEach(item => { item.hidden = true; });
    root.querySelectorAll('[data-dest-voters]').forEach(item => item.setAttribute('aria-expanded', 'false'));
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }; });
  root.querySelectorAll('[data-dest-confirm]').forEach(button => { button.onclick = async () => {
    const name = button.closest('.dest-item').querySelector('strong').textContent;
    if (!await confirmAction(`${name}(으)로 여행지를 확정할까요? 뽑기 횟수는 쓰지 않아요.`)) return;
    const result = await post(button, '/confirm', { key: button.dataset.destConfirm });
    if (!result) return;
    showToast(`🎉 여행지: ${result.region.name}`, 'success');
    state.roomSummary = { roomId: room.id, regionId: result.region.id };
    roomTabState.delete(room.id);
    render();
  }; });
  root.querySelectorAll('[data-dest-delete]').forEach(button => { button.onclick = async () => {
    if (!await confirmAction('이 후보를 삭제할까요? 받은 투표도 지워져요.')) return;
    if (await post(button, '/candidates/delete', { key: button.dataset.destDelete })) loadDestination(room, isHost, tripMembers);
  }; });

  const drawButton = document.getElementById('destDrawBtn');
  if (drawButton) drawButton.onclick = async () => {
    const left = data.drawsLeft - 1;
    if (!await confirmAction(`${data.method === 'random' ? '전국 인기 여행지에서' : '후보 중에서'} 여행지를 뽑을까요? 뽑고 나면 ${left ? `다시 뽑기가 ${left}번 남아요.` : '더 이상 다시 뽑을 수 없어요.'}`)) return;
    const result = await post(drawButton, '/draw');
    if (!result) return;
    await runDrawAnimation({ pool: result.pool, final: result.region.name, subPool: tripMembers.map(member => member.dresscode).filter(Boolean), subFinal: result.dresscode });
    state.roomSummary = { roomId: room.id, regionId: result.region.id }; // 내가 뽑은 결과는 다시 연출하지 않음
    roomTabState.delete(room.id);
    render();
  };

  const searchForm = document.getElementById('destSearchForm');
  if (searchForm) searchForm.onsubmit = async event => {
    event.preventDefault();
    const query = document.getElementById('destSearchInput').value.trim();
    const results = document.getElementById('destSearchResults');
    if (!query) { status('검색어를 입력해주세요.'); return; }
    status('검색 중…');
    try {
      const found = await api(`/regions/search?q=${encodeURIComponent(query)}`);
      results.replaceChildren();
      status(found.regions.length ? '' : '검색 결과가 없어요. 다른 이름으로 찾아보세요.');
      for (const region of found.regions) {
        const item = document.createElement('li');
        const already = data.candidates.some(candidate => candidate.region.name === region.name);
        item.innerHTML = `<button type="button" class="ghost" ${already ? 'disabled' : ''}><strong>${escapeHtml(region.name)}</strong><small>${already ? '이미 후보에 있어요' : region.sample ? `예: ${escapeHtml(region.sample)} 근처` : '인기 여행지'} · 후보로 올리기</small></button>`;
        item.querySelector('button').onclick = async event => {
          if (await post(event.currentTarget, '/candidates', { region })) { showToast(`${region.name}을(를) 후보로 올렸어요.`, 'success'); loadDestination(room, isHost, tripMembers); }
        };
        results.append(item);
      }
    } catch (error) { status(error.message); }
  };
}
