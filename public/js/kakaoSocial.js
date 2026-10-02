async function loadKakaoPanel(container, room = null) {
  if (!container) return;
  try {
    const config = await api('/auth/kakao/status');
    if (!container.isConnected) return;
    container.innerHTML = `<h2>💬 카카오 계정 연결 · 친구</h2>
      ${state.authNotice ? `<p class="desc">${escapeHtml(state.authNotice)}</p>` : ''}
      <p>${config.linked ? '카카오 계정 연결됨' : '기존 PICKGO 계정에 카카오 계정을 연결할 수 있어요.'}</p>
      ${config.enabled ? (config.linked ? '' : '<a class="kakao-login-link" href="/api/auth/kakao/start?mode=link">카카오 계정 연결</a><p class="desc">연결해 두면 아이디·비밀번호를 잊었을 때 카카오 인증으로 찾을 수 있어요.</p>') : `<p class="desc">로그인 준비 중: ${config.missing.map(escapeHtml).join(', ')} 설정이 필요합니다.</p>`}
      <p data-social-status role="status" aria-live="polite"></p><form id="addNicknameFriend" class="finance-inline"><label>PICKGO 닉네임으로 친구 요청<input name="nickname" minlength="2" maxlength="12" required placeholder="친구의 정확한 닉네임"></label><button>요청 보내기</button></form><p class="desc">상대가 수락하면 서로의 친구 목록에 추가돼요.</p><div id="friendRequests"></div><div id="pickgoFriends"></div><div id="roomInvitations"></div>`;
    const status = text => { if (container.isConnected) el('[data-social-status]', container).textContent = text; };
    async function listFriends() {
      const { friends } = await api('/friends');
      if (!container.isConnected) return;
      el('#pickgoFriends', container).innerHTML = `<h3>내 PICKGO 친구 (${friends.length})</h3><ul class="finance-records">${friends.map(friend => `<li><span>${escapeHtml(friend.nickname)}</span><div>${room?.hostUserId === state.user.id ? `<button class="ghost small" data-invite-friend="${friend.id}">이 방에 초대</button>` : ''}<button class="ghost small" data-remove-friend="${friend.id}">친구 끊기</button></div></li>`).join('') || '<li>친구의 PICKGO 닉네임으로 요청을 보내 보세요.</li>'}</ul>`;
      container.querySelectorAll('[data-remove-friend]').forEach(button => { button.onclick = async () => {
        if (!await confirmAction('친구를 끊을까요? 서로의 친구 목록에서 모두 사라져요.')) return;
        button.disabled = true;
        try { await api(`/friends/${button.dataset.removeFriend}`, {method:'DELETE',body:{}}); await listFriends(); status('친구를 끊었어요. 다시 친구가 되려면 요청을 보내주세요.'); }
        catch(error) { status(error.message); button.disabled = false; }
      }; });
    }
    // 받은 요청은 수락·거절, 보낸 요청은 취소
    async function listRequests() {
      const { incoming, outgoing } = await api('/friends/requests');
      if (!container.isConnected) return;
      el('#friendRequests', container).innerHTML = `
        ${incoming.length ? `<h3>받은 친구 요청 <span class="notify-count">${incoming.length}</span></h3><ul class="finance-records">${incoming.map(request => `<li><span>${escapeHtml(request.nickname)}</span><div><button class="small" data-request-accept="${request.id}">수락</button><button class="ghost small" data-request-decline="${request.id}">거절</button></div></li>`).join('')}</ul>` : ''}
        ${outgoing.length ? `<h3>보낸 친구 요청</h3><ul class="finance-records">${outgoing.map(request => `<li><span>${escapeHtml(request.nickname)} <small class="muted">수락 대기 중</small></span><button class="ghost small" data-request-cancel="${request.id}">요청 취소</button></li>`).join('')}</ul>` : ''}`;
      const respond = async (button, path, body, message) => {
        button.disabled = true;
        try { await api(path, { method: 'POST', body }); await Promise.all([listRequests(), listFriends()]); refreshNotifications(); status(message); }
        catch (error) { status(error.message); button.disabled = false; }
      };
      container.querySelectorAll('[data-request-accept]').forEach(button => { button.onclick = () => respond(button, `/friends/requests/${button.dataset.requestAccept}/respond`, { accept: true }, '친구가 됐어요!'); });
      container.querySelectorAll('[data-request-decline]').forEach(button => { button.onclick = () => respond(button, `/friends/requests/${button.dataset.requestDecline}/respond`, { accept: false }, '요청을 거절했어요.'); });
      container.querySelectorAll('[data-request-cancel]').forEach(button => { button.onclick = () => respond(button, `/friends/requests/${button.dataset.requestCancel}/cancel`, {}, '보낸 요청을 취소했어요.'); });
      container.querySelectorAll('[data-invite-friend]').forEach(button => { button.onclick = async () => {
        button.disabled = true;
        try { await api(`/rooms/${room.id}/invites`, { method: 'POST', body: { userId: Number(button.dataset.inviteFriend) } }); status('PICKGO 안에 방 초대를 보냈습니다. 친구가 수락하면 입장해요.'); }
        catch (error) { status(error.message); button.disabled = false; }
      }; });
    }
    el('#addNicknameFriend',container).onsubmit = async event => {
      event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
      try {
        const result = await api('/friends/by-nickname',{method:'POST',body:{nickname:new FormData(event.target).get('nickname')}});
        await Promise.all([listRequests(), listFriends()]); refreshNotifications(); event.target.reset();
        status(result.accepted ? `${result.nickname}님도 요청을 보냈었어요. 바로 친구가 됐어요!` : `${result.nickname}님에게 친구 요청을 보냈어요. 수락하면 친구가 돼요.`);
      }
      catch(error) { status(error.message); } finally { button.disabled = false; }
    };
    await Promise.all([listRequests(), listFriends()]);
    const { invites } = await api('/invites');
    if (!container.isConnected) return;
    el('#roomInvitations', container).innerHTML = invites.length ? `<h3>받은 방 초대</h3><ul class="finance-records">${invites.map(invite => `<li><span>${escapeHtml(invite.title)} · ${escapeHtml(invite.sender)}</span><button data-invite-id="${invite.id}" data-accept="true">수락</button><button class="ghost" data-invite-id="${invite.id}" data-accept="false">거절</button></li>`).join('')}</ul>` : '';
    container.querySelectorAll('[data-invite-id]').forEach(button => { button.onclick = async () => {
      button.disabled = true;
      try { const result = await api(`/invites/${button.dataset.inviteId}/respond`, { method: 'POST', body: { accept: button.dataset.accept === 'true' } }); refreshNotifications(); if (button.dataset.accept === 'true') { state.roomId = result.roomId; state.view = 'room'; } render(); }
      catch (error) { status(error.message); button.disabled = false; }
    }; });
  } catch (error) { if (container.isConnected) container.textContent = error.message; }
}

async function configureKakaoLogin() {
  const button = el('#kakaoLoginLink');
  if (!button) return;
  const config = await api('/auth/kakao/status').catch(() => null);
  state.kakaoStatus = config;
  if (!button.isConnected) return;
  if (config?.enabled) { button.href = '/api/auth/kakao/start'; button.removeAttribute('aria-disabled'); }
  else { button.textContent = '카카오 로그인 설정 대기'; el('#kakaoLoginInfo').textContent = config ? `${config.missing.join(', ')} 설정이 필요합니다.` : '설정을 불러오지 못했습니다.'; }
}
