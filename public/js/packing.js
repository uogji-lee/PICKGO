const packingFilters = new Map();
const packingTrips = new Map();
async function loadPacking(room) {
  const root = document.getElementById('packingContent');
  if (!root) return;
  try {
    const ledger = await api(`/rooms/${room.id}/finance`);
    if (!root.isConnected) return;
    const tripId = packingTrips.get(room.id) || room.activeTripId || ledger.trips[0]?.id;
    if (!tripId) { root.innerHTML = '<p class="desc">여행·코스 탭에서 여행을 만들면 준비물을 관리할 수 있어요.</p>'; return; }
    const data = await api(`/rooms/${room.id}/trips/${tripId}/packing`);
    if (!root.isConnected) return;
    const filter = packingFilters.get(tripId) || 'all';
    const done = data.items.filter(item => item.checked).length;
    const percent = data.items.length ? Math.round(done * 100 / data.items.length) : 0;
    const categories = { essential: '필수 준비', shared: '공용', personal: '내 짐' };
    root.innerHTML = `<label>준비물 여행 선택<select id="packingTripSelect">${ledger.trips.map(trip => `<option value="${trip.id}" ${trip.id === tripId ? 'selected' : ''}>${escapeHtml(trip.title)}${trip.status === 'completed' ? ' · 완료(읽기 전용)' : ''}</option>`).join('')}</select></label><div class="packing-progress"><strong>준비 진행률</strong><span>${done} / ${data.items.length} · ${percent}%</span></div><progress max="100" value="${percent}" aria-label="준비 진행률"></progress><p class="desc">공용 체크는 동행과 공유해요. 내 짐은 나에게만 보여요.</p>
      ${data.canEdit && !data.initialized ? '<button id="packingDefaults" class="secondary">국내 여행 기본 준비물 넣기</button>' : ''}
      <div class="packing-filters" role="group" aria-label="준비물 필터">${Object.entries({all:'전체',...categories,done:'완료'}).map(([key,label]) => `<button class="ghost small" data-packing-filter="${key}" aria-pressed="${filter === key}">${label}</button>`).join('')}</div>
      <p id="packingStatus" role="status"></p>
      ${Object.entries(categories).map(([category,label]) => {
        const all = data.items.filter(item => item.category === category);
        const items = all.filter(item => filter === 'all' || filter === category || filter === 'done' && item.checked);
        if (!items.length) return '';
        return `<h3>${label} · ${all.filter(item => item.checked).length}/${all.length}</h3><ul class="packing-list">${items.map(item => `<li>
          <label class="${item.checked ? 'packed' : ''}"><input type="checkbox" data-packing-check="${item.id}" ${item.checked ? 'checked' : ''} ${data.canEdit ? '' : 'disabled'}>${escapeHtml(item.title)}</label>
          ${category !== 'personal' ? `<select data-packing-assignee="${item.id}" aria-label="${escapeHtml(item.title)} 담당자" ${data.canEdit ? '' : 'disabled'}><option value="">미지정</option>${data.participants.map(person => `<option value="${person.id}" ${person.id === item.assignee_id ? 'selected' : ''}>${escapeHtml(person.nickname)}</option>`).join('')}</select>` : ''}
          ${data.canEdit && item.canDelete ? `<button class="ghost small" data-packing-delete="${item.id}" aria-label="${escapeHtml(item.title)} 삭제">×</button>` : ''}</li>`).join('')}</ul>`;
      }).join('') || '<p class="empty-state">표시할 준비물이 없어요. 필요한 물건을 추가해보세요.</p>'}
      ${data.canEdit ? '<form id="packingForm" class="finance-inline"><label>종류<select name="category"><option value="essential">필수 준비</option><option value="shared">공용</option><option value="personal">내 짐</option></select></label><label>준비물<input name="title" maxlength="100" placeholder="준비물 추가하기…" required></label><button>추가</button></form>' : ''}`;
    async function change(suffix, body, control) {
      control.disabled = true;
      try { await api(`/rooms/${room.id}/trips/${tripId}/packing${suffix}`, {method:'POST',body}); await loadPacking(room); }
      catch (error) { if (root.isConnected) document.getElementById('packingStatus').textContent = error.message; control.disabled = false; if (control.type === 'checkbox') control.checked = !control.checked; }
    }
    root.querySelector('#packingTripSelect').onchange = event => { packingTrips.set(room.id,Number(event.target.value)); loadPacking(room); };
    root.querySelectorAll('[data-packing-filter]').forEach(button => { button.onclick = () => { packingFilters.set(tripId,button.dataset.packingFilter); loadPacking(room); }; });
    root.querySelectorAll('[data-packing-check]').forEach(input => { input.onchange = () => change('/'+input.dataset.packingCheck,{checked:input.checked},input); });
    root.querySelectorAll('[data-packing-assignee]').forEach(select => { select.onchange = () => change('/'+select.dataset.packingAssignee,{assigneeId:select.value ? Number(select.value) : null},select); });
    root.querySelectorAll('[data-packing-delete]').forEach(button => { button.onclick = () => change('/'+button.dataset.packingDelete,{deleted:true},button); });
    const defaults = root.querySelector('#packingDefaults'); if (defaults) defaults.onclick = () => change('/defaults',{},defaults);
    const form = root.querySelector('#packingForm'); if (form) form.onsubmit = event => { event.preventDefault(); const values = new FormData(form); change('',{title:values.get('title'),category:values.get('category')},form.querySelector('button')); };
  } catch (error) { if (root.isConnected) root.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p><button id="retryPacking">다시 불러오기</button>`; const retry = root.querySelector('#retryPacking'); if (retry) retry.onclick = () => loadPacking(room); }
}
