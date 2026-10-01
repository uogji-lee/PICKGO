// 카카오 본인 인증 기반 가입 완료 · 아이디/비밀번호 찾기 · 비밀번호 변경 화면
function passwordFields(withCurrent) {
  return `${withCurrent ? '<label>현재 비밀번호<input type="password" name="currentPassword" autocomplete="current-password" required></label>' : ''}
    <label>새 비밀번호<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required placeholder="8자 이상"></label>
    <label>새 비밀번호 확인<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required></label>`;
}

function readPasswords(form) {
  const values = new FormData(form);
  if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('새 비밀번호가 서로 다릅니다.');
  return { currentPassword: values.get('currentPassword') || undefined, newPassword: values.get('newPassword') };
}

async function renderKakaoSignup() {
  appEl().innerHTML = '<div class="card">카카오 인증 정보를 확인하는 중…</div>';
  const back = () => { state.view = 'auth'; render(); };
  let pending;
  try { pending = await api('/auth/kakao/signup'); }
  catch (error) { pending = { pending: false }; }
  if (!pending.pending) {
    appEl().innerHTML = '<div class="card"><h1>카카오 인증이 만료됐어요</h1><p class="desc">인증 후 15분 안에 가입을 마쳐야 해요. 다시 인증해주세요.</p><a class="kakao-login-link" href="/api/auth/kakao/start">카카오로 다시 인증하기</a><button class="link-btn" id="signupBack">← 로그인 화면</button></div>';
    el('#signupBack').onclick = back;
    return;
  }
  appEl().innerHTML = `<div class="card account-form">
    <h1>✅ 카카오 인증 완료</h1>
    <p class="desc">PICKGO에서 쓸 닉네임과 비밀번호를 정하면 가입이 끝나요. 다음부터는 닉네임·비밀번호 또는 카카오로 로그인할 수 있어요.</p>
    <form id="kakaoSignupForm">
      <label>닉네임 (아이디)<input name="nickname" minlength="2" maxlength="12" required autocomplete="username" value="${escapeHtml(pending.nicknameHint)}"></label>
      ${passwordFields(false)}
      <button class="block">가입 완료</button>
      <p class="error-msg" id="kakaoSignupError" role="status"></p>
    </form>
    <button class="link-btn" id="signupBack">← 로그인 화면</button>
  </div>`;
  el('#signupBack').onclick = back;
  el('#kakaoSignupForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const { newPassword } = readPasswords(event.target);
      const { user } = await api('/auth/kakao/signup', { method: 'POST', body: { nickname: new FormData(event.target).get('nickname'), password: newPassword } });
      state.user = user;
      state.view = 'rooms';
      render();
    } catch (error) { el('#kakaoSignupError').textContent = error.message; button.disabled = false; }
  };
}

function renderFindAccount() {
  appEl().innerHTML = `<div class="card account-form">
    <h1>아이디·비밀번호 찾기</h1>
    <p class="desc">카카오로 본인 인증하면 내 닉네임(아이디)을 확인하고 새 비밀번호를 정할 수 있어요.</p>
    <a class="kakao-login-link" href="/api/auth/kakao/start?mode=recover">카카오로 본인 인증</a>
    <p class="desc">카카오 계정을 연결해 둔 PICKGO 계정만 찾을 수 있어요. 로그인할 수 있을 때 <strong>계정 · 친구</strong>에서 카카오 계정을 연결해 두세요.</p>
    <button class="link-btn" id="findBack">← 로그인 화면</button>
  </div>`;
  el('#findBack').onclick = () => { state.view = 'auth'; render(); };
}

function renderPasswordReset() {
  appEl().innerHTML = `<div class="card account-form">
    <h1>🔑 새 비밀번호 설정</h1>
    <p class="desc">카카오 본인 인증이 완료됐어요.</p>
    <p class="found-nickname">내 닉네임(아이디): <strong>${escapeHtml(state.user.nickname)}</strong></p>
    <form id="passwordResetForm">
      ${passwordFields(false)}
      <button class="block">비밀번호 바꾸기</button>
      <p class="desc">인증 후 15분 안에 바꿔주세요. 지나면 비밀번호 찾기를 다시 해야 해요.</p>
      <p class="error-msg" id="passwordResetStatus" role="status"></p>
    </form>
    <button class="link-btn" id="resetSkip">나중에 바꾸기 → 방 목록</button>
  </div>`;
  el('#resetSkip').onclick = () => { state.view = 'rooms'; render(); };
  el('#passwordResetForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      await api('/me/password', { method: 'POST', body: { newPassword: readPasswords(event.target).newPassword } });
      state.user = { ...state.user, hasPassword: true };
      state.view = 'rooms';
      state.roomsNotice = '새 비밀번호로 바꿨어요. 다음부터 새 비밀번호로 로그인하세요.';
      render();
    } catch (error) { el('#passwordResetStatus').textContent = error.message; button.disabled = false; }
  };
}

function renderPasswordCard(container) {
  if (!container) return;
  const hasPassword = state.user.hasPassword !== false;
  container.innerHTML = `<h2>🔑 비밀번호 ${hasPassword ? '변경' : '설정'}</h2>
    ${hasPassword ? '' : '<p class="desc">카카오 로그인으로만 쓰던 계정이에요. 비밀번호를 정하려면 로그인 화면의 \'아이디·비밀번호 찾기\'에서 카카오 인증을 해주세요.</p>'}
    ${hasPassword ? `<form id="passwordChangeForm">${passwordFields(true)}<button>비밀번호 변경</button><p role="status" id="passwordChangeStatus"></p></form>` : ''}`;
  const form = el('#passwordChangeForm', container);
  if (!form) return;
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await api('/me/password', { method: 'POST', body: readPasswords(form) });
      form.reset();
      el('#passwordChangeStatus', container).textContent = '비밀번호를 변경했습니다.';
    } catch (error) { el('#passwordChangeStatus', container).textContent = error.message; }
    finally { button.disabled = false; }
  };
}
