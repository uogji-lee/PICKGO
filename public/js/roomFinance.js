const roomRoles = { host: '👑 방장', treasurer: '💰 총무', guide: '🧭 길잡이', photographer: '📸 사진사', member: '멤버' };
const won = amount => `${Number(amount || 0).toLocaleString('ko-KR')}원`;
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
function memberManagementControls(member, room, isHost) {
  if (!isHost || member.id === room.hostUserId) return '';
  return `<div class="member-actions"><select data-member-role="${member.id}" aria-label="${escapeHtml(member.nickname)} 역할">
    ${Object.entries(roomRoles).filter(([role]) => role !== 'host').map(([role, label]) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${label}</option>`).join('')}
    </select><button class="ghost small" data-transfer-host="${member.id}">방장 위임</button><button class="ghost small danger" data-kick-member="${member.id}">추방</button></div>`;
}
function bindMemberManagement(room, members) {
  async function update(button, id, action, body) {
    button.disabled = true;
    try { await api(`/rooms/${room.id}/members/${id}/${action}`, { method: 'POST', body }); render(); }
    catch (error) { alert(error.message); button.disabled = false; }
  }
  document.querySelectorAll('[data-member-role]').forEach(select => { select.onchange = () => {
    if (select.value === 'treasurer' && !confirm('총무를 변경할까요? 장부 편집 권한도 새 총무에게 이동합니다.')) {
      select.value = members.find(member => member.id === Number(select.dataset.memberRole)).role; return;
    }
    update(select, select.dataset.memberRole, 'role', { role: select.value });
  }; });
  document.querySelectorAll('[data-transfer-host]').forEach(button => { button.onclick = () => {
    if (confirm('방장을 위임할까요? 내 방장 권한이 없어집니다.')) update(button, button.dataset.transferHost, 'role', { role: 'host' });
  }; });
  document.querySelectorAll('[data-kick-member]').forEach(button => { button.onclick = () => {
    if (confirm('이 멤버를 추방할까요? 재입장은 차단되고 기존 납부·여행 기록은 보존됩니다.')) update(button, button.dataset.kickMember, 'kick', {});
  }; });
}

async function loadRoomFinance(room, members) {
  const container = el('#roomFinance');
  if (!container) return;
  try {
    const data = await api(`/rooms/${room.id}/finance`);
    if (!container.isConnected || state.roomId !== room.id) return;
    bindExpenseOverview(room, data);
    const { canManage, people, trips, dues, requests, history, nudges } = data;
    const isHost = room.hostUserId === state.user.id;
    const name = id => escapeHtml(people.find(person => person.id === id)?.nickname || '멤버');
    const current = trips.find(trip => trip.id === data.activeTripId);
    const expenseTrip = trips.find(trip => trip.id === expenseTripSelections.get(room.id)) || current || trips[0];
    const me = people.find(person => person.id === state.user.id);
    const options = people.map(person => `<option value="${person.id}">${name(person.id)} · 누적 ${won(person.paid)} · 잔액 ${won(person.balance)}${person.active ? '' : ' (퇴장)'}</option>`).join('');
    const checklist = (ids = members.map(member => member.id)) => members.map(member => `<label><input type="checkbox" name="participantIds" value="${member.id}" ${ids.includes(member.id) ? 'checked' : ''}>${escapeHtml(member.nickname)}</label>`).join('');
    const status = message => { el('[data-finance-status]', container).textContent = message; const notice = el('#roomActionStatus'); if (notice) notice.textContent = message; };
    const recordRow = (record, kind) => `<li class="${record.voided ? 'voided-record' : ''}"><div><strong>${kind === 'expenses' ? escapeHtml(record.title) : name(record.user_id)} · ${won(record.amount)} ${record.voided ? '(취소됨)' : ''}</strong>
      <small>${kind === 'expenses' ? `${escapeHtml(record.expense_date)} · ${record.payer_user_id === null ? '공동금고' : name(record.payer_user_id) + ' 선결제'} · ${JSON.parse(record.participant_ids).map(name).join(', ')}` : `${escapeHtml(record.billing_month || '')} ${escapeHtml(record.note || (kind === 'refunds' ? '반환' : '기존 납부'))}`}</small>
      <small>기록: ${name(record.created_by)} · ${escapeHtml(record.created_at)} UTC</small></div>
      ${canManage && !record.voided && (!record.trip_id || trips.find(trip => trip.id === record.trip_id)?.status !== 'completed') ? `<button class="ghost small" data-void="${kind}/${record.id}">기록 취소</button>` : ''}</li>`;
    container.innerHTML = `
      <div class="finance-heading"><div><h2>우리 모임 금고</h2><p class="desc">${data.treasurerUserId ? '총무 ' + name(data.treasurerUserId) : '총무 미지정 · 방장 ' + name(room.hostUserId) + ' 대행'} · ${canManage ? '장부 편집 가능' : '모든 내역 열람 가능 · 편집은 총무(미지정 시 방장)만'}</p></div><button id="refreshFinanceBtn" class="ghost small">새로고침</button></div>
      <p data-finance-status role="status" aria-live="polite" class="finance-status"></p>
      ${isHost ? `<details class="finance-admin"><summary>총무 · 멤버 관리</summary><form id="treasurerForm" class="finance-inline"><label>총무 지정 (방장 겸임 가능)<select name="userId">${members.map(member => `<option value="${member.id}" ${member.id === data.treasurerUserId ? 'selected' : ''}>${escapeHtml(member.nickname)}</option>`).join('')}</select></label><button class="secondary">지정</button></form>
        <p><button id="lockMembersBtn" class="ghost small">${data.membershipLocked ? '멤버 확정 해제' : '현재 멤버로 확정'}</button> <small>${data.membershipLocked ? '초대코드 신규 입장 잠금 · 방장 초대는 가능' : '친구를 모은 후 멤버를 확정하세요.'}</small></p></details>` : ''}
      <nav class="finance-actions" aria-label="장부 작업"><button class="secondary" data-finance-open="payments">회비 납부 · 설정</button><button class="secondary" data-finance-open="expenses">지출 · 추가 정산</button><button class="ghost" data-finance-open="history">여행 기록</button></nav><div class="finance-stats"><div><span>공동금고 현금</span><strong>${won(data.poolBalance)}</strong><small>다음 여행으로 계속 이월</small></div><div><span>누적 여행비</span><strong>${won(data.spent)}</strong><small>${trips.filter(trip => trip.status === 'completed').length}번의 여행 완료</small></div><div><span>내 적립금 잔액</span><strong>${won(me?.balance)}</strong><small>음수이면 추가 납부 필요</small></div></div>
      <p class="desc">개인별 적립금에서 참석한 여행 비용만 차감합니다. 불참자의 잔액과 남은 회비는 다음 여행을 위해 보존됩니다.</p>
      <details class="nested-collapsible" data-journey-controls open><summary>🗓️ 이번 여행과 다음 여행</summary><div class="finance-section">
        ${current ? `<h3>${escapeHtml(current.title)}</h3>${isHost || canManage ? `<form id="tripTitleForm" class="finance-inline"><label>여행 이름<input name="title" maxlength="60" required value="${escapeHtml(current.title)}"></label><button class="secondary">이름 저장</button></form>` : ''}<p>${escapeHtml(current.plan.selected_date || '날짜 미정')} · ${tripLengthLabel(current.plan.trip_nights)} · ${current.participantIds.map(name).join(', ')}</p>
          ${(isHost || canManage) && !current.spent ? `<form id="participantsForm"><fieldset><legend>이번 여행 참석자 변경</legend><div class="expense-participants">${checklist(current.participantIds)}</div></fieldset><button class="secondary">참석자 저장</button></form>` : ''}
          ${canManage ? '<button id="finishTripBtn" class="block">여행 종료 · 자동 정산 · 잔액 이월</button><div id="finishTripConfirm" hidden role="group" aria-label="여행 종료 확인"><p>누락된 지출이 없는지 확인해주세요. 종료 시점 정산은 보존되고 잔액은 이월됩니다. 뒤늦은 지출은 회비 탭에서 추가 정산할 수 있어요.</p><button id="confirmFinishTripBtn">확인 · 정산 확정</button> <button id="cancelFinishTripBtn" class="ghost">취소</button></div>' : '<p class="desc">총무가 여행 종료를 누르면 정산과 기록이 확정됩니다.</p>'}` : `<p>회비는 계속 모으고, 떠날 때 새 여행을 만드세요.</p>
          ${isHost || canManage ? `<form id="newTripForm" class="finance-form"><label class="finance-wide">여행 이름<input name="title" maxlength="60" placeholder="10월 강릉 여행" required></label><label>출발일<input type="date" name="date" value="${localDate()}" required></label><label>여행 기간<select name="nights">${Array.from({ length: 8 }, (_, n) => `<option value="${n}" ${n === 1 ? 'selected' : ''}>${tripLengthLabel(n)}</option>`).join('')}</select></label><fieldset class="finance-wide"><legend>이번에 함께 갈 사람</legend><div class="expense-participants">${checklist()}</div></fieldset><button>여행 만들기</button></form>` : ''}`}
      </div></details>
      <details class="nested-collapsible" data-finance-pane="payments"><summary>💸 월 회비 · 누적 납부 · 기존 금액 추가</summary><div class="finance-section">
        <p>월 ${won(data.monthlyAmount)}${data.monthlyStart ? ` · ${escapeHtml(data.monthlyStart)}부터` : ' · 아직 미설정'}</p>
        ${canManage ? `<form id="monthlyForm" class="finance-form"><label>1인당 월 회비<input name="amount" type="number" min="0" max="100000000" step="5000" value="${data.monthlyAmount}" required></label><label>적용 시작월<input name="startMonth" type="month" min="${data.currentMonth}" value="${data.currentMonth}" required></label><button class="secondary">월 회비 설정</button></form><p class="desc">이미 생성된 월 청구는 유지됩니다. 0원으로 설정하면 이후 자동 청구를 중단합니다.</p>
        <form id="paymentForm" class="finance-form"><label class="finance-wide">납부자 · 기존 금액<select name="userId" id="payerSelect">${options}</select></label><p id="payerExisting" class="finance-wide desc"></p><label>이번에 추가할 금액<input name="amount" id="paymentAmount" type="number" min="1" max="100000000" step="1" required></label><label>대상 월 (선택)<input type="month" name="month" value="${data.currentMonth}"></label><label class="finance-wide">메모<input name="note" maxlength="100" placeholder="월 회비 / 기존에 모아둔 돈 / 여행 추가 납부"></label><button>기존 납부액에 더하기</button></form><p class="desc">기존 적립금·추가 납부는 대상 월을 비워 입력하세요. 같은 돈을 중복 입력하지 않도록 누적 금액을 확인해주세요.</p>` : ''}
        <div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>멤버</th><th>누적 납부</th><th>참석 여행 부담</th><th>이월 잔액</th><th>월 회비 미납</th></tr></thead><tbody>${people.map(person => `<tr><th>${name(person.id)}${person.active ? '' : ' (퇴장)'}</th><td>${won(person.paid)}</td><td>${won(person.share)}</td><td class="${person.balance < 0 ? 'danger' : 'refund'}">${won(person.balance)}<small>선결제 ${won(person.advanced)} / 반환 ${won(person.refunded)}</small></td><td>${won(person.monthlyUnpaid)}${canManage && person.active && person.unpaid ? `<button class="ghost small" data-nudge="${person.id}">회비 내라 👀</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <details><summary>월별 납부 내역 (${dues.length}건)</summary><ul class="finance-records">${dues.map(due => `<li>${escapeHtml(due.month)} · ${name(due.user_id)} · ${won(due.paid)} / ${won(due.amount)} ${due.unpaid ? `· 미납 ${won(due.unpaid)}` : '✓'}</li>`).join('') || '<li>월 회비를 설정하면 해당 월의 청구가 생성됩니다.</li>'}</ul></details>
      </div></details>
      <details class="nested-collapsible" data-finance-pane="expenses"><summary>🧾 지출 추가 · ${escapeHtml(expenseTrip?.title || '여행 미선택')}</summary><div class="finance-section">
        ${canManage && expenseTrip ? `<form id="expenseForm" class="finance-form"><label class="finance-wide">지출 내용<input name="title" maxlength="80" placeholder="숙소, 저녁, 렌터카…" required></label><label>금액<input name="amount" type="number" min="1" max="100000000" step="1" required></label><label>지출일<input name="date" type="date" value="${localDate()}" required></label><label class="finance-wide">결제한 돈<select name="payerUserId"><option value="pool">공동금고</option>${expenseTrip.participantIds.map(id => `<option value="${id}">${name(id)} 개인 선결제</option>`).join('')}</select></label><fieldset class="finance-wide"><legend>같이 부담할 참석자</legend><div class="expense-participants">${expenseTrip.participantIds.map(id => `<label><input type="checkbox" name="participantIds" value="${id}" checked>${name(id)}</label>`).join('')}</div></fieldset><button>지출 기록 · 참석자끼리 N빵</button></form>` : '<p class="desc">여행을 선택하면 총무가 완료 후에도 지출을 추가할 수 있습니다.</p>'}
        <p>현재 추가 납부 필요액 <strong>${won(data.additionalTotal)}</strong></p><p class="desc">각자 적립금보다 여행비를 많이 썼을 때 부족액을 요청합니다. 월 회비 청구와 별도로 더해서 청구하는 금액이 아닙니다.</p>
        ${canManage ? '<form id="extraRequestForm" class="finance-inline"><label>추가 납부 사유<input name="reason" maxlength="100" placeholder="숙소비 초과분 정산" required></label><button>부족액 요청</button></form>' : ''}
        <ul class="finance-records">${requests.map(request => `<li><div><strong>${name(request.user_id)} · ${won(request.remaining)} ${request.remaining ? '납부 요청' : request.superseded ? '새 요청으로 갱신됨' : '해결됨'}</strong><small>${escapeHtml(request.reason)} · 최초 요청 ${won(request.amount)}</small></div></li>`).join('') || '<li>추가 납부 요청이 없습니다.</li>'}</ul>
        ${nudges.length ? `<ul class="nudge-feed">${nudges.slice(0, 5).map(nudge => `<li><strong>${escapeHtml(nudge.target_name)}</strong>님, ${escapeHtml(nudge.message)}</li>`).join('')}</ul>` : ''}
      </div></details>
      <details class="nested-collapsible" data-finance-pane="history"><summary>📚 우리 방 여행 기록 (${trips.length}회)</summary><div class="finance-section">
        ${trips.map(trip => `<details class="journey-history"><summary>${escapeHtml(trip.title)} · ${trip.status === 'completed' ? '여행 완료' : '진행 중'} · ${won(trip.spent)}</summary>${isHost || canManage ? `<form data-history-title="${trip.id}" class="finance-inline"><label>여행 이름<input name="title" value="${escapeHtml(trip.title)}" maxlength="60" required></label><button class="secondary">이름 저장</button></form>` : ''}<p>${escapeHtml(trip.plan.selected_date || '날짜 미정')} · ${tripLengthLabel(trip.plan.trip_nights)} · ${trip.participantIds.map(name).join(', ')}</p>
          <p class="desc">숙소 ${escapeHtml(trip.plan.accommodation_name || '미정')} · ${trip.plan.transport_mode === 'car' ? '차량' : '대중교통·도보'}</p>
          ${isHost ? `<details class="history-edit"><summary>여행 기록 수정</summary><form data-history-record="${trip.id}" class="finance-form"><label>여행 이름<input name="title" maxlength="60" required value="${escapeHtml(trip.title)}"></label><label>출발일<input name="date" type="date" required value="${escapeHtml(trip.plan.selected_date || '')}"></label><label>여행 기간<select name="nights">${Array.from({length:8},(_,n)=>`<option value="${n}" ${n===trip.plan.trip_nights?'selected':''}>${tripLengthLabel(n)}</option>`).join('')}</select></label><label class="finance-wide">여행 메모<textarea name="notes" maxlength="2000">${escapeHtml(trip.notes || '')}</textarea></label><p class="desc finance-wide">참석자·지출·최초 정산·저장된 코스는 바꾸지 않습니다.</p><button>여행 기록 저장</button></form></details>` : (trip.notes ? `<p>${escapeHtml(trip.notes)}</p>` : '')}
          ${trip.settlement ? `<p class="desc">최초 종료 시점 정산 (보존) · 추가 지출과 입금은 상단 최신 경비·현재 잔액에 반영됩니다.</p><ul class="finance-records">${trip.settlement.people.map(person => `<li>${escapeHtml(person.nickname)} · 여행 부담 ${won(person.tripShare)} · ${person.balance < 0 ? `추가 납부 ${won(-person.balance)}` : `다음 여행 이월 ${won(person.balance)}`}</li>`).join('')}</ul>` : ''}
          <ul class="finance-records">${history.expenses.filter(expense => expense.trip_id === trip.id).map(expense => recordRow(expense, 'expenses')).join('') || '<li>기록한 지출이 없습니다.</li>'}</ul>
          ${trip.itinerary_json ? `<details><summary>저장된 여행 코스</summary>${JSON.parse(trip.itinerary_json).days.map(day => `<p>${day.dayNumber}일차 · ${day.stops.map(stop => escapeHtml(stop.place.name)).join(' → ')}</p>`).join('')}</details>` : ''}
        </details>`).join('') || '<p class="desc">첫 여행을 만들면 이곳에 차곡차곡 쌓입니다.</p>'}
      </div></details>
      <details class="nested-collapsible"><summary>전체 납부·반환 장부</summary><div class="finance-section"><ul class="finance-records">${history.payments.map(record => recordRow(record, 'payments')).join('') || '<li>납부 내역이 없습니다.</li>'}${history.refunds.map(record => recordRow(record, 'refunds')).join('')}</ul>
        ${canManage ? `<details><summary>선결제 환급 / 탈퇴 정산 등 별도 반환</summary><p class="desc">잔액은 자동 반환하지 않습니다. 실제 반환한 경우에만 기록하세요.</p><form id="refundForm" class="finance-form"><label>반환받는 사람<select name="userId">${options}</select></label><label>반환 금액<input name="amount" type="number" min="1" max="100000000" required></label><button>반환 기록</button></form></details>` : ''}
      </div></details><p class="desc">총무가 실제 송금 후 입력하는 장부입니다. 다른 멤버의 변경사항은 새로고침으로 확인하세요.</p>`;

    async function mutate(button, suffix, body, full = false) {
      button.disabled = true; status('저장 중…');
      const open = [...container.querySelectorAll('details')].map(item => item.open);
      try {
        const response = await api(`/rooms/${room.id}/${suffix}`, { method: 'POST', body });
        if (full) { render(); return; }
        await loadRoomFinance(room, members);
        if (container.isConnected) { container.querySelectorAll('details').forEach((item, index) => { if (index < open.length) item.open = open[index]; }); status(response.message || '저장했습니다.'); }
      } catch (error) { if (container.isConnected) status(error.message); button.disabled = false; }
    }
    function form(selector, suffix, map, full = false) {
      const target = el(selector, container);
      if (target) target.onsubmit = event => { event.preventDefault(); mutate(target.querySelector('button'), typeof suffix === 'function' ? suffix(new FormData(target)) : suffix, map(new FormData(target)), full); };
    }
    el('#refreshFinanceBtn', container).onclick = () => loadRoomFinance(room, members);
    container.querySelectorAll('[data-history-title]').forEach(target => { target.onsubmit = event => { event.preventDefault(); mutate(target.querySelector('button'), `trips/${target.dataset.historyTitle}/title`, {title:new FormData(target).get('title')}); }; });
    container.querySelectorAll('[data-history-record]').forEach(target => { target.onsubmit = event => {
      event.preventDefault(); const values = new FormData(target);
      mutate(target.querySelector('button'), `trips/${target.dataset.historyRecord}/record`, {title:values.get('title'),date:values.get('date'),nights:Number(values.get('nights')),notes:values.get('notes')}, true);
    }; });
    form('#treasurerForm', values => `members/${values.get('userId')}/role`, () => ({ role: 'treasurer' }), true);
    const lock = el('#lockMembersBtn', container);
    if (lock) lock.onclick = () => mutate(lock, 'membership', { locked: !data.membershipLocked }, true);
    form('#monthlyForm', 'finance/dues', values => ({ amount: Number(values.get('amount')), startMonth: values.get('startMonth') }));
    form('#paymentForm', 'finance/payments', values => ({ userId: Number(values.get('userId')), amount: Number(values.get('amount')), month: values.get('month') || null, note: values.get('note') }));
    form('#newTripForm', 'trips', values => ({ title: values.get('title'), date: values.get('date'), nights: Number(values.get('nights')), participantIds: values.getAll('participantIds').map(Number) }), true);
    form('#tripTitleForm', `trips/${current?.id}/title`, values => ({title:values.get('title')}), true);
    form('#participantsForm', `trips/${current?.id}/participants`, values => ({ participantIds: values.getAll('participantIds').map(Number) }), true);
    form('#expenseForm', 'finance/expenses', values => ({ tripId: expenseTrip.id, title: values.get('title'), amount: Number(values.get('amount')), date: values.get('date'), payerUserId: values.get('payerUserId') === 'pool' ? null : Number(values.get('payerUserId')), participantIds: values.getAll('participantIds').map(Number) }));
    form('#extraRequestForm', 'finance/request-extra', values => ({ reason: values.get('reason') }));
    form('#refundForm', 'finance/refunds', values => ({ userId: Number(values.get('userId')), amount: Number(values.get('amount')) }));
    const finish = el('#finishTripBtn', container);
    if (finish) {
      const confirmation = el('#finishTripConfirm', container), confirmButton = el('#confirmFinishTripBtn', container);
      finish.onclick = () => { confirmation.hidden = false; finish.hidden = true; confirmButton.focus(); };
      el('#cancelFinishTripBtn', container).onclick = () => { confirmation.hidden = true; finish.hidden = false; finish.focus(); };
      confirmButton.onclick = () => mutate(confirmButton, `trips/${current.id}/finish`, {}, true);
    }
    container.querySelectorAll('[data-nudge]').forEach(button => { button.onclick = () => mutate(button, 'finance/nudges', { userId: Number(button.dataset.nudge) }); });
    container.querySelectorAll('[data-void]').forEach(button => { button.onclick = () => { if (confirm('이 기록을 취소할까요? 실제 송금은 취소되지 않으며 취소 이력은 보존됩니다.')) mutate(button, `finance/${button.dataset.void}/void`, {}); }; });
    const payer = el('#payerSelect', container), paymentAmount = el('#paymentAmount', container);
    if (payer) {
      const update = () => { const person = people.find(person => person.id === Number(payer.value)); el('#payerExisting', container).textContent = `기존 납부 ${won(person.paid)} + 이번 ${won(Number(paymentAmount.value))} = 누적 ${won(person.paid + Number(paymentAmount.value))}`; };
      payer.onchange = update; paymentAmount.oninput = update; update();
    }
    container.querySelectorAll('[data-finance-open]').forEach(button => { button.onclick = () => { const pane = container.querySelector(`[data-finance-pane="${button.dataset.financeOpen}"]`); container.querySelectorAll('[data-finance-pane]').forEach(item => { item.open = item === pane; }); pane.scrollIntoView({behavior:'smooth',block:'start'}); }; });
    if (finish) {
      const finishArea = document.createElement('section');
      finishArea.className = 'finance-section';
      finishArea.innerHTML = `<h3>여행 마무리 · ${escapeHtml(current.title)}</h3><p class="desc">지출을 모두 기록한 뒤 종료하세요. 종료 후 추가 지출도 이 탭에서 기록할 수 있어요.</p>`;
      finishArea.append(finish, el('#finishTripConfirm',container));
      container.querySelector('.finance-stats').after(finishArea);
    }
    const journeyControls = container.querySelector('[data-journey-controls]');
    const tripArea = el('#tripManagement');
    if (tripArea && journeyControls) tripArea.replaceChildren(journeyControls);
  } catch (error) {
    if (container.isConnected) { container.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p><button id="financeRetry">다시 불러오기</button>`; el('#financeRetry', container).onclick = () => loadRoomFinance(room, members); }
  }
}
