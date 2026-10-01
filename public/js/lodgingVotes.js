// 숙소 후보 투표: 링크 대표사진 + 특징 + 투표 인원(누르면 투표자 목록)
function lodgingFeatures(item) {
  return [
    item.bedrooms != null && `침실 ${item.bedrooms}`,
    item.beds != null && `침대 ${item.beds}`,
    item.bathrooms != null && `욕실 ${item.bathrooms}`,
    item.capacity != null && `최대 ${item.capacity}명`,
  ].filter(Boolean);
}
const lodgingSite = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '링크'; } };

async function loadLodging(room) {
  const root = document.getElementById('lodgingPanel');
  if (!root || !room.activeTripId) return;
  let data;
  try { data = await api(`/rooms/${room.id}/lodging`); }
  catch (error) { if (root.isConnected) root.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p>`; return; }
  if (!root.isConnected) return;
  const totalVotes = data.candidates.reduce((sum, item) => sum + item.voterIds.length, 0);
  const maxVotes = Math.max(0, ...data.candidates.map(item => item.voterIds.length));
  root.innerHTML = `
    <p class="desc">${data.canEdit ? '마음에 드는 숙소 카드를 누르면 투표돼요(1인 1표, 다시 누르면 취소).' : '이번 여행 참석자만 투표할 수 있어요.'} 오른쪽 인원수를 누르면 누가 투표했는지 볼 수 있어요. · 투표 ${data.voterCount}/${data.participantCount}명</p>
    ${data.candidates.length ? `<ul class="poll-list">${data.candidates.map(item => {
      const share = totalVotes ? Math.round(item.voterIds.length * 100 / totalVotes) : 0;
      const mine = data.myVote === item.id;
      const features = lodgingFeatures(item);
      return `<li class="poll-item ${mine ? 'mine' : ''} ${item.selected ? 'chosen' : ''}" style="--share:${share}%">
        <span class="poll-fill" aria-hidden="true"></span>
        <button type="button" class="poll-vote" data-lodging-vote="${item.id}" aria-pressed="${mine}" ${data.canEdit ? '' : 'disabled'}>
          ${item.imageUrl ? `<img class="poll-thumb" src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="poll-thumb placeholder" aria-hidden="true">🏠</span>'}
          <span class="poll-text">
            <strong>${mine ? '✓ ' : ''}${escapeHtml(item.name)}</strong>
            ${features.length ? `<span class="poll-chips">${features.map(text => `<span>${escapeHtml(text)}</span>`).join('')}</span>` : ''}
            ${item.memo ? `<span class="poll-memo">${escapeHtml(item.memo)}</span>` : ''}
            ${item.selected ? '<span class="badge host">확정 숙소</span>' : item.voterIds.length && item.voterIds.length === maxVotes ? '<span class="badge">최다 득표</span>' : ''}
          </span>
        </button>
        <div class="poll-side">
          <button type="button" class="poll-count" data-lodging-voters="${item.id}" aria-expanded="false" aria-label="${escapeHtml(item.name)} 투표한 사람 보기">${item.voterIds.length}명 ▾</button>
          <ul class="poll-voters" id="lodgingVoters-${item.id}" hidden>
            ${item.voters.length ? item.voters.map(name => `<li>${escapeHtml(name)}</li>`).join('') : '<li class="muted">아직 투표한 사람이 없어요</li>'}
          </ul>
        </div>
        <div class="poll-footer">
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lodgingSite(item.url))}에서 보기 ↗</a>
          <span>${escapeHtml(item.creator)}님이 올림</span>
          ${data.isHost && !item.selected ? `<button type="button" class="small secondary" data-lodging-select="${item.id}">이 숙소로 확정</button>` : ''}
          ${item.canDelete ? `<button type="button" class="ghost small" data-lodging-delete="${item.id}">삭제</button>` : ''}
        </div>
      </li>`;
    }).join('')}</ul>` : '<p class="empty-state">아직 숙소 후보가 없어요.</p>'}
    ${data.canEdit ? `<details class="nested-collapsible lodging-add" ${data.candidates.length ? '' : 'open'}><summary>➕ 숙소 후보 올리기</summary>
      <form id="lodgingForm" class="lodging-form">
        <div class="lodging-url"><input name="url" type="url" required maxlength="500" placeholder="숙소 링크 붙여넣기 (에어비앤비·호텔 등)" aria-label="숙소 링크"><button type="button" class="secondary" id="lodgingPreviewBtn">불러오기</button></div>
        <div id="lodgingPreview" class="lodging-preview" hidden>
          <span id="lodgingPreviewThumb" class="poll-thumb placeholder" aria-hidden="true">🏠</span>
          <p id="lodgingPreviewTitle" class="desc"></p>
        </div>
        <input type="hidden" name="imageUrl">
        <label class="lodging-wide">숙소 이름<input name="name" required maxlength="60" placeholder="바다뷰 독채"></label>
        <label>침실<input name="bedrooms" type="number" min="0" max="30" step="1"></label>
        <label>침대<input name="beds" type="number" min="0" max="50" step="1"></label>
        <label>욕실<input name="bathrooms" type="number" min="0" max="30" step="0.5"></label>
        <label>최대 인원<input name="capacity" type="number" min="0" max="60" step="1"></label>
        <label class="lodging-wide">메모 (선택)<input name="memo" maxlength="100" placeholder="1박 18만원, 주차 가능"></label>
        <button class="lodging-wide">후보 올리기</button>
      </form>
    </details>` : ''}
    <p id="lodgingStatus" role="status"></p>`;

  const status = text => { const box = document.getElementById('lodgingStatus'); if (box) box.textContent = text; };
  async function act(button, path, body = {}) {
    button.disabled = true;
    try { return await api(`/rooms/${room.id}/lodging${path}`, { method: 'POST', body }); }
    catch (error) { status(error.message); button.disabled = false; return null; }
  }
  root.querySelectorAll('[data-lodging-vote]').forEach(button => { button.onclick = async () => { if (await act(button, `/${button.dataset.lodgingVote}/vote`)) loadLodging(room); }; });
  root.querySelectorAll('[data-lodging-voters]').forEach(button => { button.onclick = () => {
    const list = document.getElementById(`lodgingVoters-${button.dataset.lodgingVoters}`);
    const open = list.hidden;
    root.querySelectorAll('.poll-voters').forEach(item => { item.hidden = true; });
    root.querySelectorAll('[data-lodging-voters]').forEach(item => item.setAttribute('aria-expanded', 'false'));
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }; });
  root.querySelectorAll('[data-lodging-delete]').forEach(button => { button.onclick = async () => {
    if (!await confirmAction('이 숙소 후보를 삭제할까요? 받은 투표도 함께 지워져요.')) return;
    if (await act(button, `/${button.dataset.lodgingDelete}/delete`)) render();
  }; });
  root.querySelectorAll('[data-lodging-select]').forEach(button => { button.onclick = async () => {
    if (!await confirmAction('이 숙소로 확정할까요? 링크로 정한 숙소는 위치 좌표가 없어 코스는 여행지 중심으로 짜여요.')) return;
    if (await act(button, `/${button.dataset.lodgingSelect}/select`)) render();
  }; });

  const form = document.getElementById('lodgingForm');
  if (!form) return;
  const previewButton = document.getElementById('lodgingPreviewBtn');
  previewButton.onclick = async () => {
    if (!form.elements.url.value.trim()) { status('숙소 링크를 먼저 붙여넣어 주세요.'); return; }
    status('링크에서 사진과 정보를 불러오는 중…');
    const preview = await act(previewButton, '/preview', { url: form.elements.url.value.trim() });
    previewButton.disabled = false;
    if (!preview) return;
    form.elements.url.value = preview.url;
    form.elements.imageUrl.value = preview.image || '';
    const thumb = document.getElementById('lodgingPreviewThumb');
    thumb.outerHTML = preview.image
      ? `<img id="lodgingPreviewThumb" class="poll-thumb" src="${escapeHtml(preview.image)}" alt="" referrerpolicy="no-referrer">`
      : '<span id="lodgingPreviewThumb" class="poll-thumb placeholder" aria-hidden="true">🏠</span>';
    document.getElementById('lodgingPreviewTitle').textContent = preview.title || '사진·정보를 찾지 못했어요. 직접 입력해주세요.';
    document.getElementById('lodgingPreview').hidden = false;
    if (!form.elements.name.value && preview.suggestedName) form.elements.name.value = preview.suggestedName;
    for (const key of ['bedrooms', 'beds', 'bathrooms', 'capacity']) {
      if (preview.features?.[key] != null && !form.elements[key].value) form.elements[key].value = preview.features[key];
    }
    status(preview.notice || '불러왔어요. 내용을 확인하고 후보 올리기를 눌러주세요.');
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const body = { url: values.url, name: values.name, memo: values.memo, imageUrl: values.imageUrl };
    for (const key of ['bedrooms', 'beds', 'bathrooms', 'capacity']) if (values[key] !== '') body[key] = Number(values[key]);
    if (await act(form.querySelector('button.lodging-wide'), '', body)) loadLodging(room);
  };
}
