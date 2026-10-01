// 끝난 여행만 따로 모아 보여주는 '지난 여행' 탭
async function loadPastTrips(room) {
  const root = document.getElementById('pastTrips');
  if (!root) return;
  let trips;
  try { ({ trips } = await api(`/rooms/${room.id}/past-trips`)); }
  catch (error) { if (root.isConnected) root.innerHTML = `<p class="error-msg">${escapeHtml(error.message)}</p>`; return; }
  if (!root.isConnected) return;
  if (!trips.length) {
    root.innerHTML = '<p class="empty-state">아직 다녀온 여행이 없어요.<br>여행을 마치고 \'여행 종료\'를 누르면 여기에 쌓여요.</p>';
    return;
  }
  root.innerHTML = trips.map(trip => `
    <details class="past-trip">
      <summary>
        <strong>${escapeHtml(trip.title)}</strong>
        <span>${trip.region ? escapeHtml(trip.region) + ' · ' : ''}${trip.startDate ? `${escapeHtml(trip.startDate)}${trip.endDate !== trip.startDate ? ` ~ ${escapeHtml(trip.endDate)}` : ''}` : '날짜 미정'} · ${tripLengthLabel(trip.nights)}</span>
      </summary>
      <dl class="past-trip-facts">
        <dt>함께 간 사람</dt><dd>${trip.participants.map(escapeHtml).join(', ')}</dd>
        <dt>쓴 돈</dt><dd>${won(trip.spent)}</dd>
        ${trip.accommodation ? `<dt>숙소</dt><dd>${trip.accommodation.url ? `<a href="${escapeHtml(trip.accommodation.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(trip.accommodation.name)} ↗</a>` : escapeHtml(trip.accommodation.name)}</dd>` : ''}
        ${trip.dresscode ? `<dt>드레스코드</dt><dd>${escapeHtml(trip.dresscode)}</dd>` : ''}
        ${trip.notes ? `<dt>메모</dt><dd>${escapeHtml(trip.notes)}</dd>` : ''}
      </dl>
      ${trip.course.length ? `<h4>다녀온 코스</h4><ol class="past-trip-course">${trip.course.map(day => `<li><strong>${day.dayNumber}일차${day.date ? ` · ${escapeHtml(day.date)}` : ''}</strong> ${day.stops.map(escapeHtml).join(' → ') || '일정 없음'}</li>`).join('')}</ol>` : ''}
    </details>`).join('');
}
