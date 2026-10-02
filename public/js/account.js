// 닉네임(아이디) 입력 중 400ms 뒤 중복 확인 → 필드 아래 안내, 쓸 수 없으면 제출 버튼 비활성화
function watchNicknameAvailability(input, button, { enabled = () => true } = {}) {
  const status = document.createElement('p');
  status.className = 'field-status';
  status.id = `${input.id || input.name}Availability`;
  status.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', status.id);
  (input.closest('label') || input).after(status);
  let timer, last = null, blocked = false;
  // 버튼은 이 확인 때문에 막은 경우에만 다시 풀어 줌 (제출 중 비활성화와 겹치지 않게)
  const block = value => { if (value !== blocked) { blocked = value; button.disabled = value; } };
  const clear = () => { clearTimeout(timer); status.textContent = ''; input.removeAttribute('aria-invalid'); block(false); };
  const show = result => {
    const saved = result.available && result.nickname !== input.value.trim() ? ` (저장될 닉네임: ${result.nickname})` : '';
    status.className = `field-status ${result.available ? 'ok' : 'bad'}`;
    status.textContent = result.available ? `✓ ${result.message}${saved}` : result.message;
    if (result.available) input.removeAttribute('aria-invalid'); else input.setAttribute('aria-invalid', 'true');
    block(!result.available);
  };
  // 지금 값을 바로 확인해 사용 가능 여부를 돌려줌. 확인 요청이 실패하면 서버의 가입 검증에 맡김
  const check = () => {
    clearTimeout(timer);
    const value = input.value;
    if (!enabled() || !value.trim()) { clear(); return Promise.resolve(true); }
    if (last?.value !== value) last = { value, request: api('/nickname-available?nickname=' + encodeURIComponent(value)).catch(() => null) };
    const current = last;
    return current.request.then(result => {
      if (!result) return true;
      if (last === current && input.value === value) show(result);
      return result.available;
    });
  };
  input.addEventListener('input', () => { clear(); if (enabled()) timer = setTimeout(check, 400); });
  return { check, clear };
}

function renderAccount() {
  appEl().innerHTML = `<button id="accountBack" class="link-btn">← 방 목록</button><div class="card"><h1>내 계정</h1><form id="profileForm"><label>닉네임<input name="nickname" minlength="2" maxlength="12" required value="${escapeHtml(state.user.nickname)}"></label><p class="desc">닉네임·비밀번호 로그인 사용자는 다음부터 새 닉네임을 입력하세요. 카카오 로그인 방식과 기존 여행·납부 기록은 유지됩니다.</p><button>닉네임 저장</button><p role="status" id="profileStatus"></p></form></div><div class="card account-form" id="passwordCard"></div><div class="card" id="accountFriends"></div>`;
  el('#accountBack').onclick = () => { state.view = 'rooms'; render(); };
  const nicknameInput = el('#profileForm input[name=nickname]');
  const nicknameCheck = watchNicknameAvailability(nicknameInput, el('#profileForm button'));
  el('#profileForm').onsubmit = async event => {
    event.preventDefault(); const button = event.target.querySelector('button');
    if (button.disabled || !(await nicknameCheck.check())) return;
    button.disabled = true;
    try { const result = await api('/me/profile', { method:'POST', body:{nickname:nicknameInput.value} }); state.user = {...state.user,...result.user}; renderUserBox(); nicknameInput.value = result.user.nickname; nicknameCheck.clear(); el('#profileStatus').textContent = '닉네임을 변경했습니다.'; }
    catch (error) { el('#profileStatus').textContent = error.message; }
    finally { button.disabled = false; }
  };
  renderPasswordCard(el('#passwordCard'));
  loadKakaoPanel(el('#accountFriends'));
}
