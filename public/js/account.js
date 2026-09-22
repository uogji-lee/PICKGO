function renderAccount() {
  appEl().innerHTML = `<button id="accountBack" class="link-btn">← 방 목록</button><div class="card"><h1>내 계정</h1><form id="profileForm"><label>닉네임<input name="nickname" minlength="2" maxlength="12" required value="${escapeHtml(state.user.nickname)}"></label><p class="desc">닉네임·비밀번호 로그인 사용자는 다음부터 새 닉네임을 입력하세요. 카카오 로그인 방식과 기존 여행·납부 기록은 유지됩니다.</p><button>닉네임 저장</button><p role="status" id="profileStatus"></p></form></div><div class="card" id="accountFriends"></div>`;
  el('#accountBack').onclick = () => { state.view = 'rooms'; render(); };
  el('#profileForm').onsubmit = async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    try { const result = await api('/me/profile', { method:'POST', body:{nickname:new FormData(event.target).get('nickname')} }); state.user = {...state.user,...result.user}; renderUserBox(); el('#profileStatus').textContent = '닉네임을 변경했습니다.'; }
    catch (error) { el('#profileStatus').textContent = error.message; }
    finally { button.disabled = false; }
  };
  loadKakaoPanel(el('#accountFriends'));
}
