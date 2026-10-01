// 숙소 후보 링크 등록 · 참석자 투표 · 방장 확정
async function loadLodging(room) {
  const root = document.getElementById('lodgingPanel');
  if (!root || !room.activeTripId) return;
  let data;
  try { data = await api(`/rooms/${room.id}/lodging`); }
  catch (error) { if (root.isConnected) root.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p>`; return; }
  if (!root.isConnected) return;
  const maxVotes = Math.max(0, ...data.candidates.map(item => item.voterIds.length));
  const site = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  root.innerHTML = `
    <p class="desc">에어비앤비·호텔 예약 링크를 후보로 올리고 마음에 드는 숙소에 한 표씩 투표해요. 방장이 투표 결과를 보고 확정해요.</p>
    ${data.candidates.length ? `<ul class="lodging-list">${data.candidates.map(item => `
      <li class="lodging-item ${item.selected ? 'chosen' : ''}">
        <div class="lodging-head">
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(item.name)}</strong> <small>${escapeHtml(site(item.url))} ↗</small></a>
          ${item.selected ? '<span class="badge host">확정</span>' : item.voterIds.length && item.voterIds.length === maxVotes ? '<span class="badge">최다 득표</span>' : ''}
        </div>
        ${item.memo ? `<p class="lodging-memo">${escapeHtml(item.memo)}</p>` : ''}
        <small class="lodging-meta">${escapeHtml(item.creator)}님이 올림 · ${item.voterIds.length}표</small>
        <div class="lodging-actions">
          ${data.canEdit ? `<button class="small ${data.myVote === item.id ? '' : 'secondary'}" data-lodging-vote="${item.id}" aria-pressed="${data.myVote === item.id}">${data.myVote === item.id ? '✓ 내 투표' : '투표'}</button>` : ''}
          ${data.isHost && !item.selected ? `<button class="small secondary" data-lodging-select="${item.id}">이 숙소로 확정</button>` : ''}
          ${item.canDelete ? `<button class="ghost small" data-lodging-delete="${item.id}">삭제</button>` : ''}
        </div>
      </li>`).join('')}</ul>` : '<p class="empty-state">아직 숙소 후보가 없어요.</p>'}
    ${data.canEdit ? `<form id="lodgingForm" class="finance-form">
      <label class="finance-wide">숙소 링크<input name="url" type="url" required maxlength="500" placeholder="https://www.airbnb.co.kr/rooms/..."></label>
      <label>숙소 이름<input name="name" required maxlength="60" placeholder="바다뷰 독채"></label>
      <label>메모 (선택)<input name="memo" maxlength="100" placeholder="1박 18만원, 주차 가능"></label>
      <button class="secondary">후보 올리기</button>
    </form>` : '<p class="desc">이번 여행 참석자만 후보를 올리고 투표할 수 있어요.</p>'}
    <p id="lodgingStatus" role="status"></p>`;
  const status = text => { const box = document.getElementById('lodgingStatus'); if (box) box.textContent = text; };
  async function act(button, path, body = {}) {
    button.disabled = true;
    try { await api(`/rooms/${room.id}/lodging${path}`, { method: 'POST', body }); return true; }
    catch (error) { status(error.message); button.disabled = false; return false; }
  }
  root.querySelectorAll('[data-lodging-vote]').forEach(button => { button.onclick = async () => { if (await act(button, `/${button.dataset.lodgingVote}/vote`)) loadLodging(room); }; });
  root.querySelectorAll('[data-lodging-delete]').forEach(button => { button.onclick = async () => {
    if (!await confirmAction('이 숙소 후보를 삭제할까요? 받은 투표도 함께 지워져요.')) return;
    if (await act(button, `/${button.dataset.lodgingDelete}/delete`)) render();
  }; });
  root.querySelectorAll('[data-lodging-select]').forEach(button => { button.onclick = async () => {
    if (!await confirmAction('이 숙소로 확정할까요? 링크로 정한 숙소는 위치 좌표가 없어 코스는 여행지 중심으로 짜여요.')) return;
    if (await act(button, `/${button.dataset.lodgingSelect}/select`)) render();
  }; });
  const form = document.getElementById('lodgingForm');
  if (form) form.onsubmit = async event => {
    event.preventDefault();
    const values = new FormData(form);
    if (await act(form.querySelector('button'), '', { url: values.get('url'), name: values.get('name'), memo: values.get('memo') })) loadLodging(room);
  };
}
