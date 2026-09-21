function showQuickGuide(force = false) {
  try { if (!force && localStorage.getItem('pickgo-guide-v1')) return; } catch {}
  if (document.getElementById('quickGuide')) return;
  const dialog = document.createElement('dialog'); dialog.id = 'quickGuide';
  dialog.setAttribute('aria-labelledby','guideTitle');
  dialog.innerHTML = `<h2 id="guideTitle">친구들과 떠나는 여행, 이렇게 시작해요</h2><p class="desc">한 번 만든 모임에서 다음 여행까지 이어가세요.</p><ol class="guide-steps"><li><strong>방 만들고 친구 초대</strong><p>초대코드를 공유하고 이번 여행 참석자를 골라요.</p></li><li><strong>취향·날짜 선택 → 여행지 추첨</strong><p>교통·숙소 조건을 반영한 코스를 확인해요.</p></li><li><strong>회비 모으고 여행 경비 기록</strong><p>총무가 지출을 기록해요. 총무가 없으면 방장이 대신해요. 여행 종료 시 정산하고 남은 돈은 이월해요.</p></li><li><strong>준비물 함께 체크</strong><p>필수·공용 물품은 담당자를 정하고, 내 짐은 따로 챙겨요.</p></li></ol><label><input id="guideDismiss" type="checkbox" checked>이 브라우저에서 다음부터 보지 않기</label><button id="closeGuide" class="block">시작하기</button>`;
  const previous = document.activeElement;
  const close = () => { if (dialog.querySelector('#guideDismiss').checked) { try { localStorage.setItem('pickgo-guide-v1','1'); } catch {} } dialog.close(); dialog.remove(); previous?.focus(); };
  dialog.querySelector('#closeGuide').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.body.append(dialog); dialog.showModal();
}
