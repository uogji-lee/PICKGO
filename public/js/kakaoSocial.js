async function loadKakaoPanel(container, room = null) {
  if (!container) return;
  try {
    const config = await api('/auth/kakao/status');
    if (!container.isConnected) return;
    container.innerHTML = `<h2>💬 카카오 연결 · 친구</h2>
      ${state.authNotice ? `<p class="desc">${escapeHtml(state.authNotice)}</p>` : ''}
      <p>${config.linked ? '카카오 계정 연결됨' : '기존 PICKGO 계정에 카카오 계정을 연결할 수 있어요.'}</p>
      ${config.enabled ? (!config.linked || config.friendsEnabled ? `<a class="kakao-login-link" href="/api/auth/kakao/start?mode=${config.linked ? 'friends' : 'link'}">${config.linked ? '카카오 친구 목록 동의' : '카카오 계정 연결'}</a>` : '') : `<p class="desc">로그인 준비 중: ${config.missing.map(escapeHtml).join(', ')} 설정이 필요합니다.</p>`}
      <p class="desc">PICKGO 가입과 친구 제공에 동의한 카카오 친구만 조회됩니다. 휴대폰 연락처 전체나 카카오톡의 모든 친구가 표시되지는 않습니다.</p>
      <button id="fetchKakaoFriends" class="secondary" ${!config.linked || !config.friendsEnabled ? 'disabled' : ''}>카카오 친구 불러오기</button>
      ${!config.friendsEnabled ? '<p class="desc">친구 목록은 카카오 개발자 콘솔의 권한·동의항목 설정 후 이용할 수 있습니다.</p>' : ''}
      <p data-social-status role="status"></p><ul class="finance-records" id="kakaoCandidates"></ul><form id="addNicknameFriend" class="finance-inline"><label>PICKGO 닉네임으로 친구 추가<input name="nickname" minlength="2" maxlength="12" required placeholder="친구의 정확한 닉네임"></label><button>추가</button></form><p class="desc">내 친구 목록에 저장합니다. 상대방에게 자동으로 추가되거나 메시지가 전송되지는 않아요.</p><div id="pickgoFriends"></div><div id="roomInvitations"></div>`;
    const status = text => { if (container.isConnected) el('[data-social-status]', container).textContent = text; };
    async function listFriends() {
      const { friends } = await api('/friends');
      if (!container.isConnected) return;
      el('#pickgoFriends', container).innerHTML = `<h3>내 PICKGO 친구 (${friends.length})</h3><ul class="finance-records">${friends.map(friend => `<li><span>${escapeHtml(friend.nickname)}</span><div>${room?.hostUserId === state.user.id ? `<button class="ghost small" data-invite-friend="${friend.id}">이 방에 초대</button>` : ''}<button class="ghost small" data-remove-friend="${friend.id}">목록에서 삭제</button></div></li>`).join('') || '<li>닉네임 또는 카카오 친구 목록으로 추가해주세요.</li>'}</ul>`;
      container.querySelectorAll('[data-remove-friend]').forEach(button => { button.onclick = async () => {
        button.disabled = true;
        try { await api(`/friends/${button.dataset.removeFriend}`, {method:'DELETE',body:{}}); await listFriends(); status('내 목록에서 삭제했습니다. 닉네임으로 다시 추가할 수 있어요.'); }
        catch(error) { status(error.message); button.disabled = false; }
      }; });
      container.querySelectorAll('[data-invite-friend]').forEach(button => { button.onclick = async () => {
        button.disabled = true;
        try { await api(`/rooms/${room.id}/invites`, { method: 'POST', body: { userId: Number(button.dataset.inviteFriend) } }); status('PICKGO 안에 방 초대를 보냈습니다. 친구가 수락하면 입장해요.'); }
        catch (error) { status(error.message); button.disabled = false; }
      }; });
    }
    el('#addNicknameFriend',container).onsubmit = async event => {
      event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
      try { await api('/friends/by-nickname',{method:'POST',body:{nickname:new FormData(event.target).get('nickname')}}); await listFriends(); event.target.reset(); status('친구 목록에 추가했습니다.'); }
      catch(error) { status(error.message); } finally { button.disabled = false; }
    };
    let offset = 0;
    el('#fetchKakaoFriends', container).onclick = async event => {
      event.target.disabled = true;
      try {
        const result = await api(`/kakao/friends?offset=${offset}`);
        if (!container.isConnected) return;
        const list = el('#kakaoCandidates', container);
        if (offset === 0) list.innerHTML = '';
        for (const friend of result.friends) {
          const row = document.createElement('li');
          row.innerHTML = `<span>${escapeHtml(friend.nickname)}</span><button class="ghost small" ${friend.added ? 'disabled' : ''}>${friend.added ? '추가됨' : '친구 추가'}</button>`;
          row.querySelector('button').onclick = async function () {
            this.disabled = true;
            try { await api('/friends', { method: 'POST', body: { proof: friend.proof } }); this.textContent = '추가됨'; await listFriends(); }
            catch (error) { status(error.message); this.disabled = false; }
          };
          list.append(row);
        }
        status(result.friends.length ? '친구 목록을 불러왔습니다.' : '조회 가능한 친구가 없습니다. 친구도 PICKGO 카카오 연결과 친구 제공 동의를 완료해야 합니다.');
        offset = result.nextOffset || 0;
        event.target.textContent = result.nextOffset ? '친구 더 보기' : '친구 목록 새로고침';
      } catch (error) { status(error.message); }
      event.target.disabled = false;
    };
    await listFriends();
    if (state.autoLoadFriends && config.linked && config.friendsEnabled) { state.autoLoadFriends = false; el('#fetchKakaoFriends',container).click(); }
    const { invites } = await api('/invites');
    if (!container.isConnected) return;
    el('#roomInvitations', container).innerHTML = invites.length ? `<h3>받은 방 초대</h3><ul class="finance-records">${invites.map(invite => `<li><span>${escapeHtml(invite.title)} · ${escapeHtml(invite.sender)}</span><button data-invite-id="${invite.id}" data-accept="true">수락</button><button class="ghost" data-invite-id="${invite.id}" data-accept="false">거절</button></li>`).join('')}</ul>` : '';
    container.querySelectorAll('[data-invite-id]').forEach(button => { button.onclick = async () => {
      button.disabled = true;
      try { const result = await api(`/invites/${button.dataset.inviteId}/respond`, { method: 'POST', body: { accept: button.dataset.accept === 'true' } }); if (button.dataset.accept === 'true') { state.roomId = result.roomId; state.view = 'room'; } render(); }
      catch (error) { status(error.message); button.disabled = false; }
    }; });
  } catch (error) { if (container.isConnected) container.textContent = error.message; }
}

async function configureKakaoLogin() {
  const button = el('#kakaoLoginLink');
  if (!button) return;
  const config = await api('/auth/kakao/status').catch(() => null);
  if (!button.isConnected) return;
  if (config?.enabled) { button.href = '/api/auth/kakao/start'; button.removeAttribute('aria-disabled'); }
  else { button.textContent = '카카오 로그인 설정 대기'; el('#kakaoLoginInfo').textContent = config ? `${config.missing.join(', ')} 설정이 필요합니다.` : '설정을 불러오지 못했습니다.'; }
}
