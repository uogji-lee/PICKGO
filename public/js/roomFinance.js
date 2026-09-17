const roomRoles = { host: '👑 방장', treasurer: '💰 총무', guide: '🧭 길잡이', photographer: '📸 사진사', member: '멤버' };
const won = amount => `${amount.toLocaleString('ko-KR')}원`;

function memberManagementControls(member, room, isHost) {
  if (!isHost || member.id === room.hostUserId) return '';
  return `<div class="member-actions">
    <select data-member-role="${member.id}" aria-label="${escapeHtml(member.nickname)} 역할">
      ${Object.entries(roomRoles).filter(([role]) => role !== 'host').map(([role, label]) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${label}</option>`).join('')}
    </select>
    <button class="ghost small" data-transfer-host="${member.id}">방장 위임</button>
    <button class="ghost small danger" data-kick-member="${member.id}">추방</button>
  </div>`;
}

function bindMemberManagement(room, members) {
  async function update(button, userId, action, body) {
    button.disabled = true;
    try { await api(`/rooms/${room.id}/members/${userId}/${action}`, { method: 'POST', body }); render(); }
    catch (error) { alert(error.message); button.disabled = false; render(); }
  }
  document.querySelectorAll('[data-member-role]').forEach(select => {
    select.onchange = () => {
      if (select.value === 'treasurer' && !confirm('이 멤버를 총무로 지정할까요? 기존 총무는 일반 멤버로 변경됩니다.')) {
        select.value = members.find(member => member.id === Number(select.dataset.memberRole)).role;
        return;
      }
      update(select, select.dataset.memberRole, 'role', { role: select.value });
    };
  });
  document.querySelectorAll('[data-transfer-host]').forEach(button => {
    button.onclick = () => {
      const person = members.find(member => member.id === Number(button.dataset.transferHost));
      if (confirm(`${person.nickname}님에게 방장을 위임할까요? 내 방장 권한은 없어지고 일반 멤버가 됩니다.`)) {
        update(button, person.id, 'role', { role: 'host' });
      }
    };
  });
  document.querySelectorAll('[data-kick-member]').forEach(button => {
    button.onclick = () => {
      const person = members.find(member => member.id === Number(button.dataset.kickMember));
      if (confirm(`${person.nickname}님을 추방할까요? 같은 초대코드로 재입장할 수 없습니다. 기존 납부·지출 기록은 정산을 위해 보존됩니다.`)) {
        update(button, person.id, 'kick', {});
      }
    };
  });
}

async function loadRoomFinance(room, members) {
  const container = el('#roomFinance');
  if (!container) return;
  try {
    const data = await api(`/rooms/${room.id}/finance`);
    if (!container.isConnected || state.roomId !== room.id) return;
    const { canManage, people, payments, expenses, refunds, nudges } = data;
    const names = new Map(people.map(person => [person.id, person.nickname]));
    const name = id => escapeHtml(names.get(id) || '멤버');
    const memberOptions = people.map(person => `<option value="${person.id}">${name(person.id)}${person.active ? '' : ' (퇴장)'}</option>`).join('');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const notice = message => { const status = el('[data-finance-status]', container); status.textContent = message; };
    const voidButton = (kind, id) => canManage ? `<button class="ghost small danger" data-void-kind="${kind}" data-record-id="${id}">기록 취소</button>` : '';
    container.innerHTML = `
      <div class="finance-heading"><div><h2>💸 우리 여행 공동금고</h2><p class="desc">${canManage ? '실제로 받은 회비와 결제한 지출을 기록해주세요.' : '방장과 총무가 회비·지출을 관리해요.'}</p></div><button class="ghost small" id="refreshFinanceBtn">새로고침</button></div>
      <p data-finance-status class="finance-status" role="status" aria-live="polite"></p>
      <div class="finance-stats">
        <div><span>모인 회비</span><strong>${won(data.collected)}</strong><small>목표 ${won(data.expected)}</small></div>
        <div><span>여행 총지출</span><strong>${won(data.spent)}</strong><small>개인 선결제 포함</small></div>
        <div><span>공동금고 잔액</span><strong>${won(data.poolBalance)}</strong><small>반환 완료 ${won(data.refunded)}</small></div>
      </div>
      <details class="nested-collapsible" open>
        <summary>회비 · 누가 아직 안 냈지? 👀</summary>
        <div class="finance-section">
          ${canManage && !data.settling ? `<form id="duesForm" class="finance-inline"><label>1인당 곗돈<input name="amount" type="number" min="0" max="100000000" step="1" value="${data.duesAmount}" required></label><button type="submit" class="secondary">회비 설정</button></form>` : `<p>${data.settling ? '🧮 최종 정산 중 · 약정 회비가 아닌 실제 지출로 계산해요.' : `1인당 곗돈 <strong>${won(data.duesAmount)}</strong>`}</p>`}
          <p class="desc">현재 방 멤버 ${members.length}명 기준 · 부분 납부 가능 · 여행 조건의 인원수와 별도로 계산해요.</p>
          <ul class="finance-people">${people.filter(person => person.active).map(person => `<li>
            <div><strong>${name(person.id)}</strong><small>${data.settling ? `내 부담액 ${won(person.share)}` : `납부 ${won(person.paid)} / 약정 ${won(data.duesAmount)}`}</small></div>
            <div class="finance-person-state">${person.unpaid ? `<span class="badge unpaid">${won(person.unpaid)} ${data.settling ? '추가 납부' : '미납'}</span>${canManage ? `<button class="ghost small" data-nudge="${person.id}" ${nudges.some(nudge => nudge.user_id === person.id && Date.now() - Date.parse(nudge.created_at.replace(' ', 'T') + 'Z') < 86400000) ? 'disabled' : ''}>회비 내라 👀</button>` : ''}` : `<span class="badge paid">${data.settling ? (person.balance > 0 ? '반환 대기' : '정산 완료') : (data.duesAmount ? '납부 완료' : '회비 미설정')}</span>`}</div>
          </li>`).join('')}</ul>
          ${canManage ? `<form id="paymentForm" class="finance-form"><h3>입금 확인</h3><label>납부자<select name="userId">${memberOptions}</select></label><label>이번에 받은 금액<input name="amount" type="number" min="1" max="100000000" step="1" placeholder="30000" required></label><button type="submit">납부 기록</button></form>` : ''}
          <p class="desc">알림은 방 안에만 표시돼요. 미납자당 하루 한 번, 방장·총무가 보낼 수 있어요.</p>
          ${nudges.length ? `<ul class="nudge-feed">${nudges.slice(0, 5).map(nudge => `<li><strong>${escapeHtml(nudge.target_name)}</strong>님, ${escapeHtml(nudge.message)}<small>${escapeHtml(nudge.sender_name)} · ${escapeHtml(nudge.created_at)} UTC</small></li>`).join('')}</ul>` : ''}
        </div>
      </details>
      <details class="nested-collapsible">
        <summary>🧾 지출 기록 (${expenses.length}건)</summary>
        <div class="finance-section">
          ${canManage ? `<form id="expenseForm" class="finance-form">
            <label class="finance-wide">어디에 썼나요?<input name="title" maxlength="80" placeholder="숙소, 고기 파티, 렌터카…" required></label>
            <label>금액<input name="amount" type="number" min="1" max="100000000" step="1" required></label>
            <label>지출 날짜<input name="date" type="date" value="${today}" required></label>
            <label class="finance-wide">결제한 돈<select name="payerUserId"><option value="pool">공동금고에서 결제</option>${members.map(member => `<option value="${member.id}">${escapeHtml(member.nickname)} 개인 선결제</option>`).join('')}</select></label>
            <fieldset class="finance-wide"><legend>함께 부담할 사람</legend><div class="expense-participants">${members.map(member => `<label><input type="checkbox" name="participantIds" value="${member.id}" checked>${escapeHtml(member.nickname)}</label>`).join('')}</div></fieldset>
            <button type="submit" class="finance-wide">지출 추가 · 자동 N빵</button>
          </form>` : ''}
          <p class="desc">선택한 사람끼리 균등 분담해요. 나누어떨어지지 않는 1원은 멤버 번호순으로 배분해요.</p>
          ${expenses.length ? `<ul class="finance-records">${expenses.map(expense => `<li><div><strong>${escapeHtml(expense.title)} · ${won(expense.amount)}</strong><small>${escapeHtml(expense.expense_date)} · ${expense.payer_user_id === null ? '공동금고' : name(expense.payer_user_id) + ' 선결제'} · ${JSON.parse(expense.participant_ids).map(name).join(', ')}</small></div>${voidButton('expenses', expense.id)}</li>`).join('')}</ul>` : '<p class="desc">아직 기록한 지출이 없어요.</p>'}
        </div>
      </details>
      <details class="nested-collapsible" open>
        <summary>🧮 여행 끝, 얼마 더 내면 돼?</summary>
        <div class="finance-section">
          ${canManage ? `<button id="financePhaseBtn" class="secondary">${data.settling ? '회비 모으기로 돌아가기' : '여행 끝 · 최종 정산 시작'}</button>` : ''}
          <p><strong>${data.settling ? '최종 정산 중' : '예상 정산'}</strong> · 추가 납부 합계 ${won(data.additionalTotal)} · 반환 합계 ${won(data.refundTotal)}</p>
          <p class="desc">현재 장부 기준 자동 정산 · 지출이 추가되면 즉시 다시 계산돼요. 추가 납부를 모은 뒤 공동금고에서 반환하면 됩니다.</p>
          <div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>멤버</th><th>낸 회비</th><th>개인 선결제</th><th>내 부담액</th><th>남은 정산</th></tr></thead><tbody>
          ${people.map(person => `<tr><th>${name(person.id)}${person.active ? '' : '<small>퇴장 · 기록 보존</small>'}</th><td>${won(person.paid)}</td><td>${won(person.advanced)}</td><td>${won(person.share)}</td><td class="${person.balance < 0 ? 'danger' : 'refund'}"><strong>${person.balance < 0 ? `${won(-person.balance)} 더 내기` : person.balance > 0 ? `${won(person.balance)} 받기` : '정산 완료'}</strong>${person.refunded ? `<small>반환받음 ${won(person.refunded)}</small>` : ''}
          ${canManage && person.balance !== 0 ? `<button class="ghost small" data-settle-id="${person.id}" data-settle-amount="${Math.abs(person.balance)}" data-settle-kind="${person.balance < 0 ? 'payments' : 'refunds'}">${person.balance < 0 ? '추가 입금 확인' : '반환 완료 기록'}</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="desc">내 부담액 − 낸 회비 − 개인 선결제 + 이미 반환받은 돈 = 남은 추가 납부액</p>
          <p class="desc">실제 송금은 별도로 진행해주세요. 위 확인 버튼은 송금한 금액을 장부에 기록합니다.</p>
        </div>
      </details>
      <details class="nested-collapsible"><summary>납부·반환 내역 (${payments.length + refunds.length}건)</summary><div class="finance-section">
        <ul class="finance-records">${[...payments.map(record => ({ ...record, kind: 'payments' })), ...refunds.map(record => ({ ...record, kind: 'refunds' }))].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(record => `<li><div><strong>${name(record.user_id)} · ${record.kind === 'payments' ? '납부' : '반환'} ${won(record.amount)}</strong><small>${escapeHtml(record.created_at)} UTC · 기록 ${name(record.created_by)}</small></div>${voidButton(record.kind, record.id)}</li>`).join('') || '<li>아직 내역이 없어요.</li>'}</ul>
        <p class="desc">잘못 입력한 내역은 기록 취소 후 다시 등록해주세요.</p>
      </div></details>`;

    async function mutate(button, suffix, body) {
      button.disabled = true;
      notice('저장 중…');
      const openSections = [...container.querySelectorAll('details')].map(section => section.open);
      try {
        await api(`/rooms/${room.id}/finance/${suffix}`, { method: 'POST', body });
        await loadRoomFinance(room, members);
        if (container.isConnected) {
          container.querySelectorAll('details').forEach((section, index) => { section.open = openSections[index]; });
          el('[data-finance-status]', container).textContent = '저장했습니다.';
        }
      } catch (error) { if (container.isConnected) notice(error.message); button.disabled = false; }
    }
    el('#refreshFinanceBtn', container).onclick = () => loadRoomFinance(room, members);
    const phaseButton = el('#financePhaseBtn', container);
    if (phaseButton) phaseButton.onclick = () => mutate(phaseButton, 'phase', { phase: data.settling ? 'collecting' : 'settling' });
    const bindForm = (selector, suffix, values) => {
      const form = el(selector, container);
      if (form) form.onsubmit = event => {
        event.preventDefault();
        mutate(form.querySelector('button[type="submit"]'), suffix, values(new FormData(form)));
      };
    };
    bindForm('#duesForm', 'dues', form => ({ amount: Number(form.get('amount')) }));
    bindForm('#paymentForm', 'payments', form => ({ userId: Number(form.get('userId')), amount: Number(form.get('amount')) }));
    bindForm('#expenseForm', 'expenses', form => ({
      title: form.get('title'), amount: Number(form.get('amount')), date: form.get('date'),
      payerUserId: form.get('payerUserId') === 'pool' ? null : Number(form.get('payerUserId')),
      participantIds: form.getAll('participantIds').map(Number),
    }));
    container.querySelectorAll('[data-nudge]').forEach(button => {
      button.onclick = () => mutate(button, 'nudges', { userId: Number(button.dataset.nudge) });
    });
    container.querySelectorAll('[data-void-kind]').forEach(button => {
      button.onclick = () => {
        if (confirm('이 기록을 취소하고 정산을 다시 계산할까요? 실제 송금은 취소되지 않습니다.')) mutate(button, `${button.dataset.voidKind}/${button.dataset.recordId}/void`, {});
      };
    });
    container.querySelectorAll('[data-settle-id]').forEach(button => {
      button.onclick = () => {
        const amount = Number(button.dataset.settleAmount);
        const action = button.dataset.settleKind === 'payments' ? '추가로 입금받은' : '돌려준';
        if (confirm(`${names.get(Number(button.dataset.settleId))}님에게 ${action} ${won(amount)}을 기록할까요? 실제 송금을 마친 뒤 눌러주세요.`)) {
          mutate(button, button.dataset.settleKind, { userId: Number(button.dataset.settleId), amount });
        }
      };
    });
  } catch (error) {
    if (container.isConnected) {
      container.innerHTML = `<h2>공동금고를 불러오지 못했어요</h2><p class="error-msg">${escapeHtml(error.message)}</p><button id="retryFinanceBtn">다시 시도</button>`;
      el('#retryFinanceBtn', container).onclick = () => loadRoomFinance(room, members);
    }
  }
}
