// 2차 디자인 공통 동작: 앱 안 확인창(브라우저 confirm 대신)·아래 시트·시간 선택.
// 모달 규칙(DESIGN_SPEC 10): 연 버튼 기억 → 첫 포커스 → 배경 비활성 → Tab 순환 → Escape/닫기 → 연 버튼으로 복귀
(function () {
  const ico = n => `<span class="sd-ico" data-icon="${n}" aria-hidden="true"></span>`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FOCUSABLE = 'button:not([disabled]),input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

  // 겹친 모달을 쌓아 두고 맨 위 것만 키보드를 받는다
  const stack = [];
  function openLayer(overlay, { onClose, initial } = {}) {
    const trigger = document.activeElement;
    // 제목 표시줄(창 이동·닫기)은 살려 둔다
    const behind = [...$('app').children].filter(el => el !== overlay && el.tagName !== 'HEADER' && !el.inert);
    behind.forEach(el => { el.inert = true; });
    $('app').appendChild(overlay);
    const layer = { overlay, close };
    stack.push(layer);
    function close(result) {
      if (!overlay.isConnected) return;
      overlay.remove();
      stack.splice(stack.indexOf(layer), 1);
      behind.forEach(el => { el.inert = false; });
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      onClose?.(result);
    }
    overlay.addEventListener('keydown', e => {
      if (stack[stack.length - 1] !== layer) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      if (e.key === 'Tab') {
        const f = [...overlay.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(null); });
    // 첫 포커스: 지정한 곳 → autofocus → 선택된 항목·입력칸 → 닫기 버튼이 아닌 첫 조작
    const first = () => overlay.querySelector(initial || '[autofocus]') || overlay.querySelector('.sd-time-column, input:not([type=hidden]), textarea')
      || [...overlay.querySelectorAll(FOCUSABLE)].find(el => !el.matches('[data-sheet-close]')) || overlay.querySelector(FOCUSABLE);
    setTimeout(() => first()?.focus({ preventScroll: true }), 0);
    return layer;
  }

  // 확인창: 대상·결과·행동을 분명히. resolve(true|false)
  function confirmDialog({ title, body = '', ok = '확인', cancel = '취소', danger = false } = {}) {
    if (window.UI.testAutoConfirm) return Promise.resolve(true);   // 자동 테스트 전용
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'sd-overlay sd-dialog-overlay';
      ov.innerHTML = `<div class="sd-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sd-dlg-t" aria-describedby="sd-dlg-b">
        <h2 id="sd-dlg-t">${esc(title)}</h2><p id="sd-dlg-b">${esc(body)}</p>
        <div class="sd-actions"><button type="button" class="sd-btn" data-r="0">${esc(cancel)}</button>
        <button type="button" class="sd-btn ${danger ? 'sd-btn-danger' : 'sd-btn-primary'}" data-r="1">${esc(ok)}</button></div></div>`;
      const layer = openLayer(ov, { onClose: r => resolve(r === true), initial: '[data-r="0"]' });
      ov.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) layer.close(b.dataset.r === '1'); });
    });
  }

  // 아래 시트: body는 HTML. 반환값 { el, close }
  function sheet(title, bodyHtml, { onClose, wide } = {}) {
    const ov = document.createElement('div');
    ov.className = 'sd-overlay';
    ov.innerHTML = `<div class="sd-sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sd-sheet-head"><h2>${esc(title)}</h2><button type="button" class="sd-btn sd-btn-ghost sd-btn-icon" data-sheet-close aria-label="닫기">${ico('x')}</button></div>
      <div class="sd-sheet-body">${bodyHtml}</div></div>`;
    const layer = openLayer(ov, { onClose });
    ov.addEventListener('click', e => { if (e.target.closest('[data-sheet-close]')) layer.close(null); });
    return { el: ov.querySelector('.sd-sheet'), close: layer.close };
  }

  // 시간 선택: 'HH:MM' → Promise<'HH:MM'|null>. 오전/오후·시·분 열, 위/아래 화살표로 이동, 취소하면 원래 값
  function timePicker(value = '09:00', { title = '시각 선택', hint = '', minuteStep = 5 } = {}) {
    return new Promise(resolve => {
      let [h, m] = String(value).split(':').map(Number); if (!(h >= 0)) h = 9; if (!(m >= 0)) m = 0;
      m = Math.round(m / minuteStep) * minuteStep % 60;
      let ap = h < 12 ? 0 : 1, h12 = h % 12 || 12;
      const mins = Array.from({ length: 60 / minuteStep }, (_, i) => i * minuteStep);
      const col = (name, items, cur, fmt) => `<div class="sd-time-column" role="listbox" aria-label="${name}" tabindex="0" data-col="${name}">
        ${items.map(v => `<button type="button" role="option" data-v="${v}" class="${v === cur ? 'selected' : ''}" aria-selected="${v === cur}">${fmt(v)}</button>`).join('')}</div>`;
      const s = sheet(title, `${hint ? `<p class="sd-muted">${esc(hint)}</p>` : ''}
        <div class="sd-time-picker">${col('오전 오후', [0, 1], ap, v => v ? '오후' : '오전')}
          ${col('시', [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], h12, v => String(v).padStart(2, '0'))}<span aria-hidden="true">:</span>
          ${col('분', mins, m, v => String(v).padStart(2, '0'))}</div>
        <div class="sd-actions"><button type="button" class="sd-btn" data-tp="cancel">취소</button><button type="button" class="sd-btn sd-btn-primary" data-tp="ok">적용</button></div>`,
        { onClose: r => resolve(r || null) });
      const el = s.el;
      const pick = (colEl, btn) => {
        colEl.querySelectorAll('[data-v]').forEach(b => { b.classList.toggle('selected', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
        btn.scrollIntoView({ block: 'nearest' });
        const v = Number(btn.dataset.v), c = colEl.dataset.col;
        if (c === '오전 오후') ap = v; else if (c === '시') h12 = v; else m = v;
      };
      el.querySelectorAll('.sd-time-column').forEach(c => c.querySelector('.selected')?.scrollIntoView({ block: 'center' }));
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (b) return pick(b.closest('.sd-time-column'), b);
        const a = e.target.closest('[data-tp]'); if (!a) return;
        if (a.dataset.tp === 'cancel') return s.close(null);
        const hh = (h12 % 12) + (ap ? 12 : 0);
        s.close(`${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      });
      el.addEventListener('keydown', e => {
        const c = e.target.closest('.sd-time-column'); if (!c || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const opts = [...c.querySelectorAll('[data-v]')], i = opts.findIndex(o => o.classList.contains('selected'));
        const next = opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
        pick(c, next); next.focus();
      });
    });
  }

  // 'HH:MM' → '오전 09:00'
  const timeLabel = v => { const [h, m] = String(v || '00:00').split(':').map(Number); return `${h < 12 ? '오전' : '오후'} ${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

  window.UI = { ico, esc, confirm: confirmDialog, sheet, timePicker, timeLabel, isModalOpen: () => stack.length > 0 };
})();

// 설정 안 하위 화면(계정·회원 관리·파일): 제목 표시줄 아래를 덮고, 뒤로/Esc로 닫는다
(function () {
  const { ico, esc } = window.UI;
  window.UI.panel = function (id, title, back = '설정') {
    document.getElementById(id)?.remove();
    const el = document.createElement('div');
    el.id = id; el.className = 'sd-panel'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
    el.innerHTML = `<main class="sd-content"><button type="button" class="sd-btn sd-btn-ghost sd-back" data-close>${ico('chevron-left')}${esc(back)}</button>
      <div class="sd-page-head"><div><h1>${esc(title)}</h1><p class="sd-page-subtitle" data-panel-sub hidden></p></div></div><div class="sd-panel-body"></div></main>`;
    const trigger = document.activeElement;
    const close = () => { el.remove(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
    el.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.isComposing && !window.UI.isModalOpen()) close(); });
    $('app').appendChild(el);
    // 화면 자체에 포커스(뒤로 버튼에 포커스 링이 먼저 뜨지 않게). Tab을 누르면 뒤로 버튼부터
    const main = el.querySelector('main'); main.tabIndex = -1;
    setTimeout(() => main.focus({ preventScroll: true }), 0);
    return { el, body: el.querySelector('.sd-panel-body'), sub: el.querySelector('[data-panel-sub]'), close };
  };
})();

// 마우스로 누른 뒤에는 포커스 테두리를 숨기고, 키보드(Tab 등)를 쓰기 시작하면 다시 보이게
(function () {
  const root = document.documentElement;
  root.dataset.input = 'mouse';
  window.addEventListener('mousedown', () => { root.dataset.input = 'mouse'; }, true);
  window.addEventListener('keydown', e => { if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'].includes(e.key) && !e.isComposing) root.dataset.input = 'key'; }, true);
})();
