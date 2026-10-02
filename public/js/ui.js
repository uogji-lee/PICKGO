// 공통 UI: 다크모드 · 토스트 · 입력 모달 · 추첨 슬롯 애니메이션 · 로딩 스켈레톤
function currentTheme() {
  return document.documentElement.getAttribute('data-theme')
    || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function updateThemeToggleIcon() {
  const button = document.getElementById('themeToggle');
  if (!button) return;
  const dark = currentTheme() === 'dark';
  button.textContent = dark ? '☀️' : '🌙';
  button.setAttribute('aria-label', dark ? '밝은 화면으로 전환' : '어두운 화면으로 전환');
}
function initTheme() {
  try {
    const saved = localStorage.getItem('pickgo_theme');
    if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
  } catch { /* 저장소를 쓸 수 없는 환경 */ }
  updateThemeToggleIcon();
  const button = document.getElementById('themeToggle');
  if (button) button.onclick = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('pickgo_theme', next); } catch { /* 무시 */ }
    updateThemeToggleIcon();
  };
}

function showToast(message, type = 'info', duration = 2800) {
  let root = document.getElementById('toastRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toastRoot';
    root.className = 'toast-root';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  root.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 250); }, duration);
}

// 입력 모달 (브라우저 기본 prompt 대체)
function showPrompt({ title = '입력', message = '', defaultValue = '', okText = '확인', maxlength = 30 } = {}) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'action-dialog';
    dialog.innerHTML = `<form method="dialog"><h2>${escapeHtml(title)}</h2>${message ? `<p>${escapeHtml(message)}</p>` : ''}
      <input name="value" maxlength="${maxlength}" value="${escapeHtml(defaultValue)}" autocomplete="off" required>
      <div class="dialog-actions"><button value="cancel" class="ghost" formnovalidate>취소</button><button value="confirm">${escapeHtml(okText)}</button></div></form>`;
    let settled = false;
    const finish = confirmed => {
      if (settled) return;
      settled = true;
      const value = confirmed ? dialog.querySelector('input').value.trim() : null;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value || null);
    };
    dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); finish(event.submitter?.value !== 'cancel'); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => finish(dialog.returnValue === 'confirm'), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('input').select();
  });
}

// 추첨 슬롯 애니메이션: 후보 이름이 빠르게 돌다가 점점 느려지며 결과에 멈춤
let isDrawing = false;
function runDrawAnimation({ label = '🎲 여행지를 뽑는 중…', pool = [], final, subPool = [], subFinal = null, duration = 2600 }) {
  isDrawing = true;
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'draw-dialog';
    // 주사위가 구르는 동안 폴라로이드 사진이 서서히 인화되고, 멈추면 테이프가 붙음
    dialog.innerHTML = `<div class="draw-box"><div class="draw-dice" aria-hidden="true"><span>🎲</span><span>🎲</span></div><div class="draw-label">${escapeHtml(label)}</div>
      <div class="draw-polaroid"><span class="tape" aria-hidden="true"></span><svg class="draw-photo" viewBox="0 0 200 160" aria-hidden="true"><use href="#travelScene"/></svg><div class="draw-region" aria-live="off">???</div></div>
      <div class="draw-sub"></div><p class="draw-result" role="status"></p></div>`;
    document.body.append(dialog);
    dialog.showModal();
    const main = dialog.querySelector('.draw-region');
    const sub = dialog.querySelector('.draw-sub');
    const names = pool.length ? pool : [final];
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = Date.now();
    requestAnimationFrame(() => dialog.classList.add('developing'));
    const finish = () => {
      main.textContent = final;
      main.classList.add('landed');
      dialog.classList.add('landed');
      if (subFinal) sub.textContent = `👗 ${subFinal}`;
      dialog.querySelector('.draw-result').textContent = `결과: ${final}${subFinal ? `, 드레스코드 ${subFinal}` : ''}`;
      setTimeout(() => { dialog.close(); dialog.remove(); isDrawing = false; resolve(); }, 1100);
    };
    if (reduceMotion) { finish(); return; }
    (function tick() {
      const elapsed = Date.now() - start;
      if (elapsed >= duration) { finish(); return; }
      main.textContent = names[Math.floor(Math.random() * names.length)];
      if (subPool.length) sub.textContent = `👗 ${subPool[Math.floor(Math.random() * subPool.length)]}`;
      const progress = elapsed / duration;
      setTimeout(tick, 40 + progress * progress * 260);
    })();
  });
}

// 카드 제목 맨 앞의 이모지를 색 동그라미로 감싸 노트 스타일 제목으로 보여줌 (글자는 그대로 두어 접힘 상태 비교 등에 영향 없음)
const LEADING_EMOJI = /^\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/u;
function decorateHeading(heading) {
  heading.dataset.decorated = '';
  const first = heading.firstChild;
  const emoji = first?.nodeType === Node.TEXT_NODE ? first.textContent.match(LEADING_EMOJI)?.[0] : null;
  if (!emoji) return;
  first.textContent = first.textContent.slice(emoji.length);
  const icon = document.createElement('span');
  icon.className = 'heading-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = emoji;
  heading.prepend(icon);
}
function watchHeadings(root) {
  const decorateAll = () => root.querySelectorAll('h2:not([data-decorated])').forEach(decorateHeading);
  new MutationObserver(decorateAll).observe(root, { childList: true, subtree: true });
  decorateAll();
}

function skeletonCard(lines = 3) {
  return `<div class="card skeleton-card" aria-busy="true" aria-label="불러오는 중">${'<div class="skeleton-line"></div>'.repeat(lines)}</div>`;
}
