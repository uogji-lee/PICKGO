const expenseTripSelections = new Map();
function renderExpenseOverview(room, data, userId) {
  const tripId = expenseTripSelections.get(room.id) || data.activeTripId || data.trips[0]?.id;
  const trip = data.trips.find(item => item.id === tripId);
  const expenses = data.expenses.filter(item => item.trip_id === tripId);
  const total = expenses.reduce((sum,item) => sum + item.amount,0);
  const paid = expenses.filter(item => item.payer_user_id === userId).reduce((sum,item) => sum + item.amount,0);
  const dates = [...new Set(expenses.map(item => item.expense_date))].sort().reverse();
  const name = id => escapeHtml(data.people.find(person => person.id === id)?.nickname || '멤버');
  return `<div class="expense-overview"><h2>여행 경비</h2><label>여행 선택<select id="expenseTripSelect">${data.trips.map(item => `<option value="${item.id}" ${item.id === tripId ? 'selected' : ''}>${escapeHtml(item.title)}${item.status === 'completed' ? ' · 완료' : ''}</option>`).join('') || '<option>아직 여행이 없어요</option>'}</select></label>
    <div class="expense-summary"><article><p>여행 총사용액 · 지출 ${expenses.length}건</p><strong>${won(total)}</strong><details><summary>통화별 내역</summary><p>KRW ${won(total)}</p><small>현재 원화 지출을 지원합니다.</small></details></article><article><p>내가 낸 금액</p><strong>${won(paid)}</strong><p class="desc">직접 선결제한 금액으로, 회비 납부액·정산 후 부담액과 달라요.</p></article></div>
    <div class="finance-heading"><h3>지출 내역</h3><button id="expandExpenseDates" class="ghost small">날짜별 전체 보기</button></div>
    ${dates.map(date => `<details class="expense-date" open><summary>${escapeHtml(date)} · ${won(expenses.filter(item => item.expense_date === date).reduce((sum,item) => sum + item.amount,0))}</summary><ul class="finance-records">${expenses.filter(item => item.expense_date === date).map(item => `<li><div><strong>${escapeHtml(item.title)}</strong><small>${item.payer_user_id === null ? '공동금고' : name(item.payer_user_id) + ' 선결제'} · ${JSON.parse(item.participant_ids).map(name).join(', ')}</small></div><strong>${won(item.amount)}</strong></li>`).join('')}</ul></details>`).join('') || '<p class="empty-state">아직 지출 기록이 없어요.<br>지출 추가 버튼으로 기록해보세요.</p>'}
    ${data.canManage && trip?.id === data.activeTripId ? '<button id="addExpenseShortcut" class="block">+ 지출 추가</button>' : '<p class="desc">진행 중인 여행의 지출은 총무(미지정 시 방장)가 입력합니다.</p>'}</div>`;
}
function bindExpenseOverview(room, data) {
  const root = document.getElementById('expenseOverview');
  if (!root) return;
  root.innerHTML = renderExpenseOverview(room, data, state.user.id);
  root.querySelector('#expenseTripSelect').onchange = event => { expenseTripSelections.set(room.id,Number(event.target.value)); bindExpenseOverview(room,data); };
  root.querySelector('#expandExpenseDates').onclick = () => root.querySelectorAll('.expense-date').forEach(item => { item.open = true; });
  const add = root.querySelector('#addExpenseShortcut');
  if (add) add.onclick = () => { const form = document.getElementById('expenseForm'); if (form) { let parent = form.parentElement; while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; } form.scrollIntoView({behavior:'smooth',block:'center'}); form.querySelector('input').focus({preventScroll:true}); } };
}
