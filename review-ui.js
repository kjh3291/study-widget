// 돌아보기(학습 › 기록) — v3 확정 디자인(GPT handoff studeck-v3-handoff)
//  - 내부 탭: 주간 회고 / 정리함 / 과목 / 잔디(좌우로 밀리는 전환, 탭마다 스크롤·펼침 유지)
//  - 탭 숫자 배지: 정리함 = 정리할 할 일 수, 과목 = 확인이 필요한 과목 수(0이면 숨김, 10 이상 9+, 실제 수는 읽어 주는 이름에)
//  - 스크롤 중에만 보이는 얇은 막대
// 계산은 review.js(ReviewCalc), 앱 상태 연결과 정리 동작은 renderer.js의 reviewData()/reviewAct().
(function () {
  const C = window.ReviewCalc, { ico, esc } = window.UI;
  const TABS = ['주간 회고', '정리함', '과목', '잔디'];
  const btn = (text, action, extra = '') => `<button type="button" class="sd-btn sd-btn-small" data-action="${action}" ${extra}>${text}</button>`;
  const dur = sec => { const m = Math.floor(Math.max(0, sec) / 60); return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ' ' + (m % 60) + '분' : ''}` : `${m}분`; };
  const countLabel = n => C.badgeLabel(n);
  const colorVar = name => (window.Focus ? Focus.colorVar(name) : 'var(--subject-1)');
  const KIND = { todo: '할 일', lms: 'LMS 과제', event: '일정' };

  const M = { tab: 0, week: 0, month: null, selectedDay: null, expanded: new Set(), showAll: false, scroll: [0, 0, 0, 0], back: null };
  const view = () => $('view-review');
  let data, today;

  function load() {
    data = reviewData(); today = todayStr();
    if (!M.month) { const d = new Date(); M.month = new Date(d.getFullYear(), d.getMonth(), 1); }
  }
  function streak() {
    const days = new Set(C.completions(data).map(c => c.day));
    let d = today, n = 0;
    if (!days.has(d)) d = C.util.addDays(d, -1);
    while (days.has(d)) { n++; d = C.util.addDays(d, -1); }
    return n;
  }

  // ---------- 탭 ----------
  function counts() {
    const clean = C.cleanup(data, today).length;
    const att = C.courses(data, today).filter(c => c.reasons.length).length;   // 이유가 여러 개여도 과목은 한 번
    return [0, clean, att, 0];
  }
  function tabsHTML() {
    const n = counts();
    return TABS.map((label, i) => {
      const aria = i === 1 ? `, 정리할 할 일 ${n[1]}개` : i === 2 ? `, 확인이 필요한 과목 ${n[2]}개` : '';
      return `<button type="button" class="sd-review-tab" role="tab" id="rv-tab-${i}" aria-controls="rv-panel-${i}" aria-selected="${M.tab === i}" tabindex="${M.tab === i ? 0 : -1}" data-tab="${i}" aria-label="${label}${aria}">${label}${n[i] > 0 ? `<span class="sd-review-count" aria-hidden="true">${countLabel(n[i])}</span>` : ''}</button>`;
    }).join('');
  }

  // ---------- ① 주간 회고 ----------
  function weekHTML() {
    const w = C.week(data, today, -M.week);
    const fmt = s => { const d = C.util.parse(s); return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`; };
    const delta = w.doneDelta === 0 ? '지난주와 같아요.' : `지난주보다 ${Math.abs(w.doneDelta)}개 ${w.doneDelta > 0 ? '더 끝냈어요.' : '적게 끝냈어요.'}`;
    const pct = w.planned ? Math.min(100, Math.round(w.done / w.planned * 100)) : 0;
    return `<div class="sd-review-week-grid"><div class="sd-review-card">
      <div class="sd-review-row sd-review-period">${btn('‹', 'week-prev', 'aria-label="이전 주"')}
        <div><h2 class="sd-review-section-title">${M.week === 0 ? '이번 주 회고' : M.week === 1 ? '지난주 회고' : `${M.week}주 전 회고`}</h2><p class="sd-muted">${fmt(w.from)} — ${fmt(w.to)}</p></div>
        ${btn('›', 'week-next', `aria-label="다음 주" ${M.week === 0 ? 'disabled' : ''}`)}</div>
      <p class="sd-muted">완료한 할 일 · LMS 제출 포함</p>
      <p class="sd-review-big">${w.done} <span>/ 계획 ${w.planned}개</span></p>
      <div class="sd-review-progress" role="progressbar" aria-label="주간 할 일 완료율" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
      <p class="sd-muted">${w.done === 0 && w.studySec === 0 ? '아직 이 주에 쌓인 기록이 없어요.' : delta}</p>
      <button type="button" class="sd-review-study" data-action="route" data-route="focus-records"><span><span class="sd-muted">${M.week === 0 ? '이번 주' : '이 주'} 공부</span><strong>${dur(w.studySec)}</strong>
        <span class="sd-muted">${w.studyDelta === 0 ? '지난주와 같아요.' : `지난주보다 ${dur(Math.abs(w.studyDelta))} ${w.studyDelta > 0 ? '늘었어요.' : '줄었어요.'}`}</span></span>${ico('chevron-right')}</button>
      ${w.top ? `<div class="sd-review-top"><p class="sd-muted">가장 많이 한 과목</p><p style="margin-top:6px"><span class="sd-review-subject-dot" style="background:${colorVar(w.top.name)}"></span><strong>${esc(w.top.name)}</strong> · 완료 ${w.top.done}개 · 공부 ${dur(w.top.sec)}</p></div>` : ''}
    </div>
    ${M.week === 0 ? `<section class="sd-review-next"><h3>다음 7일 마감 <span class="sd-muted">${w.nextCount}개</span></h3>
      ${w.next.map(n => `<div class="sd-review-row sd-review-next-item"><div><p>${esc(n.text)}</p><p class="sd-muted">${KIND[n.kind]}${n.subject ? ' · ' + esc(n.subject) : ''}</p></div><span class="sd-review-tag">D-${n.dday}</span></div>`).join('')}
      ${!w.nextCount ? '<p class="sd-review-empty">다가오는 마감이 없어요.</p>' : ''}${w.nextCount > 5 ? `<p class="sd-muted" style="margin-top:8px">외 ${w.nextCount - 5}개</p>` : ''}</section>` : ''}</div>`;
  }

  // ---------- ② 정리함 ----------
  function taskHTML(t) {
    return `<article class="sd-review-task"><h3>${esc(t.text)}</h3>
      <div class="sd-review-task-meta">${t.subject ? `<span>${esc(t.subject)}</span>` : ''}<span class="sd-review-tag">${t.lateDays ? t.lateDays + '일 밀림' : t.deferCount + '번 미룸'}</span></div>
      <div class="sd-actions">${btn('내일로', 'tomorrow', `data-id="${t.id}"`)}${btn('이번 주말로', 'weekend', `data-id="${t.id}"`)}
        <details class="sd-review-task-menu"><summary class="sd-btn sd-btn-small" aria-label="${esc(t.text)} 추가 동작">⋯</summary>
          <div>${btn('날짜 정하기', 'date', `data-id="${t.id}"`)}${btn('넘기기', 'skip', `data-id="${t.id}"`)}${btn('지우기', 'delete', `data-id="${t.id}"`)}</div></details></div></article>`;
  }
  function cleanHTML() {
    const list = C.cleanup(data, today), skipped = state.todos.filter(t => t.skipped && !t.done).length;
    return `<div class="sd-review-row sd-review-clean-title"><div><h2 class="sd-review-section-title">미룬 일 정리함 <span class="sd-muted">${list.length}개</span></h2>
        ${list.length ? '<p class="sd-muted">오래 밀린 일부터 정리해보세요.</p>' : ''}</div>${list.length ? btn('모두 이번 주말로', 'bulk') : ''}</div>
      ${list.length ? (M.showAll ? list : list.slice(0, 10)).map(taskHTML).join('') : '<div class="sd-review-empty">정리할 일이 없어요.</div>'}
      ${list.length > 10 ? btn(M.showAll ? '접기' : `${list.length - 10}개 더 보기`, 'more') : ''}
      <div class="sd-review-skipped">${btn(`넘긴 할 일 ${skipped}개 보기 ›`, 'skipped')}</div>`;
  }

  // ---------- ③ 과목 리포트 ----------
  function subjectsHTML() {
    const list = C.courses(data, today);
    if (!list.length) return `<div class="sd-review-row"><h2 class="sd-review-section-title">과목 리포트</h2></div>
      <div class="sd-review-empty"><p>시간표를 등록하면 과목 리포트가 생겨요.</p>${btn('시간표로 가기', 'route', 'data-route="timetable"')}</div>`;
    return `<div class="sd-review-row"><h2 class="sd-review-section-title">과목 리포트</h2><span class="sd-muted">확인 필요 순</span></div>
      <div class="sd-review-reports">${list.map(s => {
        const a = s.attendance, key = esc(s.name);
        return `<details class="sd-review-report" data-subject="${key}" ${M.expanded.has(s.name) ? 'open' : ''}><summary>
          <div class="sd-review-row"><strong><span class="sd-review-subject-dot" style="background:${colorVar(s.name)}"></span>${key}</strong>${s.reasons.length ? '<span class="sd-review-tag">확인 필요</span>' : ''}<span class="sd-review-chevron" aria-hidden="true">⌄</span></div>
          <p class="sd-muted">${s.reasons.length ? esc(s.reasons.join(' · ')) : `할 일 ${s.todos.done}/${s.todos.total} · LMS 제출 ${s.lms.submitted}/${s.lms.total}`}</p></summary>
          <div class="sd-review-report-body">${s.reasons.length ? `<div class="sd-review-reasons">${s.reasons.map(esc).join('<br>')}</div>` : ''}
            <div class="sd-review-stat"><span>할 일</span><span>완료 ${s.todos.done} / 전체 ${s.todos.total}개</span></div>
            <div class="sd-review-stat"><span>LMS 과제</span><span>제출 ${s.lms.submitted} / 전체 ${s.lms.total}개<br><span class="sd-muted">마감 지난 미제출 ${s.lms.missed}개</span></span></div>
            <div class="sd-review-stat"><span>지나간 수업 출석</span><span>${a.weeks ? `출석 ${a.present} · 지각 ${a.late} · 결석 ${a.absent}<br>공결 ${a.excused} · 병결 ${a.sick}` : '<span class="sd-muted">출석 기록 없음</span>'}</span></div>
            <div class="sd-review-stat"><span>이번 학기 공부</span><span>${dur(s.studySec)}</span></div>
            <div class="sd-actions">${btn('할 일 보기', 'route', `data-route="today-search" data-subject="${key}"`)}${btn('LMS 열기', 'route', `data-route="subject-lms" data-subject="${key}"`)}${btn(`완료한 일 ${s.todos.done}`, 'route', `data-route="done-list" data-subject="${key}"`)}</div>
          </div></details>`;
      }).join('')}</div>`;
  }

  // ---------- ④ 통합 잔디 ----------
  function heatHTML() {
    const y = M.month.getFullYear(), mo = M.month.getMonth(), h = C.heatmap(data, y, mo);
    const thisMonth = today.slice(0, 7) === `${y}-${String(mo + 1).padStart(2, '0')}`;
    const cells = h.days.map((d, i) => {
      const future = d.date > today;
      return `<button type="button" class="sd-review-day ${d.date === today ? 'today' : ''}" data-action="day" data-date="${d.date}" data-level="${future ? 0 : d.level}" aria-pressed="${M.selectedDay === d.date}"
        aria-label="${mo + 1}월 ${i + 1}일, 완료 ${d.done}개, 공부 ${dur(d.studySec)}${future ? ', 미래 날짜' : ''}" ${future ? 'disabled' : ''}>${i + 1}</button>`;
    }).join('');
    const sel = M.selectedDay && h.days.find(d => d.date === M.selectedDay);
    return `<div class="sd-review-calendar-wrap"><div class="sd-review-row"><h2 class="sd-review-section-title">통합 잔디</h2>
        <div class="sd-review-row">${btn('‹', 'month-prev', 'aria-label="이전 달"')}<span class="sd-muted">${y}년 ${mo + 1}월</span>${btn('›', 'month-next', `aria-label="다음 달" ${thisMonth ? 'disabled' : ''}`)}</div></div>
      <div class="sd-review-calendar">${['월', '화', '수', '목', '금', '토', '일'].map(d => `<span class="sd-review-weekday">${d}</span>`).join('')}${'<span></span>'.repeat(h.firstWeekday)}${cells}</div>
      <div class="sd-review-legend"><span>진할수록 많이 · 할 일 1개 = 30분</span><span class="sd-review-swatches" aria-label="없음부터 활동 4단계">${[0, 1, 2, 3, 4].map(n => `<span style="background:var(--heat-${n})"></span>`).join('')}</span></div>
      ${sel ? (() => { const d = C.util.parse(sel.date); return `<div class="sd-review-card sd-review-day-detail"><h3>${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일</h3>
        <p class="sd-muted" style="margin-top:10px">완료 ${sel.done}개</p>${sel.done ? `<ul>${sel.items.slice(0, 5).map(t => `<li>${esc(t)}</li>`).join('')}</ul>${sel.done > 5 ? `<p class="sd-muted">외 ${sel.done - 5}개</p>` : ''}` : '<p class="sd-review-empty">완료한 할 일이 없어요.</p>'}
        <p>공부 ${dur(sel.studySec)}</p>${btn('집중 기록에서 보기 ›', 'route', `data-route="focus-records" data-date="${sel.date}"`)}</div>`; })() : ''}</div>`;
  }

  // ---------- 틀 ----------
  const PANELS = [weekHTML, cleanHTML, subjectsHTML, heatHTML];
  function render() {
    load();
    const v = view();
    v.innerHTML = `<div class="sd-review-head"><button type="button" class="sd-btn sd-btn-ghost sd-back" data-action="back">${ico('chevron-left')}${esc(M.back?.label || '학습')}</button>
        <div class="sd-review-heading"><h1>돌아보기</h1><span>${streak()}일 연속 달성</span></div>
        <div class="sd-review-tabs" role="tablist" aria-label="기록 내부 메뉴">${tabsHTML()}</div></div>
      <div class="sd-review-viewport"><div class="sd-review-track">${PANELS.map((f, i) => `<section class="sd-review-panel" id="rv-panel-${i}" role="tabpanel" aria-labelledby="rv-tab-${i}" tabindex="0">${f()}</section>`).join('')}</div>
        <span class="sd-review-scroll" aria-hidden="true"></span></div>`;
    v.querySelectorAll('.sd-review-panel').forEach((p, i) => { p.scrollTop = M.scroll[i]; p.addEventListener('scroll', () => onScroll(p, i), { passive: true }); });
    sync();
  }
  // 한 탭만 다시 그림(스크롤 유지) + 탭 배지 갱신
  function rerender(i) {
    load();
    const p = view().querySelectorAll('.sd-review-panel')[i]; if (!p) return render();
    const top = p.scrollTop; p.innerHTML = PANELS[i](); p.scrollTop = top;
    view().querySelector('.sd-review-tabs').innerHTML = tabsHTML();
    view().querySelector('.sd-review-heading span').textContent = `${streak()}일 연속 달성`;
    sync();
  }
  function sync() {
    const v = view();
    v.querySelector('.sd-review-tabs').style.setProperty('--tab-index', M.tab);
    v.querySelector('.sd-review-track').style.transform = `translateX(-${M.tab * 100}%)`;
    v.querySelectorAll('[role=tab]').forEach((b, i) => { b.setAttribute('aria-selected', String(i === M.tab)); b.tabIndex = i === M.tab ? 0 : -1; });
    v.querySelectorAll('.sd-review-panel').forEach((p, i) => { p.inert = i !== M.tab; p.setAttribute('aria-hidden', String(i !== M.tab)); });
    v.querySelector('.sd-review-scroll').classList.remove('is-visible');
  }
  let scrollTimer;
  function onScroll(p, i) {
    M.scroll[i] = p.scrollTop;
    if (p.inert) return;
    const vp = view().querySelector('.sd-review-viewport'), thumb = view().querySelector('.sd-review-scroll');
    const h = vp.clientHeight - 8, total = p.scrollHeight - p.clientHeight, size = Math.max(28, h * p.clientHeight / p.scrollHeight);
    thumb.style.height = size + 'px'; thumb.style.transform = `translateY(${total > 0 ? (h - size) * p.scrollTop / total : 0}px)`;
    thumb.classList.toggle('is-visible', total > 0);
    clearTimeout(scrollTimer); scrollTimer = setTimeout(() => thumb.classList.remove('is-visible'), 650);
  }

  // ---------- 정리 동작(실행 취소: 바뀐 할 일만 되돌림) ----------
  function snapshot(ids) { return ids.map(id => JSON.parse(JSON.stringify(state.todos.find(t => t.id === id)))).filter(Boolean); }
  function restore(snap) {
    for (const old of snap) { const i = state.todos.findIndex(t => t.id === old.id); if (i >= 0) state.todos[i] = old; else state.todos.push(old); }
    saveTodos(); rerenderTodoAreas(); rerender(1);
  }
  function apply(ids, action, date, message) {
    const snap = snapshot(ids);
    const ok = ids.every(id => reviewAct(id, action, date));
    if (!ok) { showToast('처리하지 못했어요'); return; }
    rerender(1);
    showToast(message, '실행 취소', () => { restore(snap); showToast('변경을 취소했어요'); });
  }
  const textOf = id => state.todos.find(t => t.id === id)?.text || '할 일';
  async function pickDate(id) {
    const s = UI.sheet('날짜 정하기', `<form id="rv-date" novalidate><div class="sd-field"><label for="rv-date-in">새 마감일</label>
      <input type="date" class="sd-input" id="rv-date-in" value="${addDaysStr(todayStr(), 1)}" min="${todayStr()}" required></div>
      <p class="sd-muted">'${esc(textOf(id))}'을(를) 옮겨요.</p><div class="sd-actions"><button type="button" class="sd-btn" data-sheet-close>취소</button><button class="sd-btn sd-btn-primary">옮기기</button></div></form>`);
    s.el.querySelector('#rv-date').onsubmit = e => {
      e.preventDefault();
      const v = $('rv-date-in').value; if (!v) return $('rv-date-in').reportValidity();
      s.close(); apply([id], 'date', v, `${v.slice(5).replace('-', '월 ')}일로 옮겼어요.`);
    };
  }
  function skippedSheet() {
    const list = state.todos.filter(t => t.skipped && !t.done);
    const s = UI.sheet('넘긴 할 일', list.length ? `<div class="sd-review-dialog-list">${list.map(t => `<div class="sd-review-row"><span>${esc(t.text)}</span>${btn('되살리기', 'restore', `data-id="${t.id}"`)}</div>`).join('')}</div>`
      : '<p class="sd-muted">넘긴 할 일이 없어요.</p>');
    s.el.addEventListener('click', e => {
      const b = e.target.closest('[data-action=restore]'); if (!b) return;
      const t = state.todos.find(x => x.id === b.dataset.id); if (!t) return;
      const snap = snapshot([t.id]);
      t.skipped = false; delete t.doneAt; saveTodos(); rerenderTodoAreas();
      b.closest('.sd-review-row').remove(); rerender(1);
      showToast('할 일을 되살렸어요.', '실행 취소', () => restore(snap));
    });
  }

  // ---------- 다른 화면으로 ----------
  const backHere = () => ({ label: '돌아보기', nav: 'study', go: () => open(M.back) });
  function route(r, subject) {
    if (r === 'focus-records') return window.Focus.openRecords(null, backHere());
    if (r === 'timetable') return window.Shell.goNav('timetable');
    if (r === 'start-focus') return window.Focus.start(subject, '');
    if (r === 'done-list') return openDoneSheet({ subject });
    if (r === 'subject-lms') return window.Shell.openStudy('lms');
    if (r === 'today-search') {
      window.Shell.goNav('today');
      const si = $('td-search'); if (si) { si.value = subject; si.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  }

  // ---------- 이벤트 ----------
  view().addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.tab !== undefined) { M.tab = Number(b.dataset.tab); return sync(); }
    const a = b.dataset.action, id = b.dataset.id; if (!a) return;
    if (a === 'back') return (M.back?.go || (() => window.Shell.goNav('study')))();
    if (a === 'week-prev' || a === 'week-next') { M.week = Math.max(0, M.week + (a === 'week-prev' ? 1 : -1)); return rerender(0); }
    if (a === 'more') { M.showAll = !M.showAll; return rerender(1); }
    if (a === 'tomorrow') return apply([id], 'tomorrow', null, '내일로 옮겼어요.');
    if (a === 'weekend') return apply([id], 'weekend', null, '이번 주말로 옮겼어요.');
    if (a === 'bulk') { const ids = C.cleanup(data, today).map(t => t.id); return apply(ids, 'weekend', null, `${ids.length}개를 이번 주말로 옮겼어요.`); }
    if (a === 'date') return pickDate(id);
    if (a === 'skip') return apply([id], 'skip', null, '넘긴 할 일에 보관했어요.');
    if (a === 'delete') {
      if (!(await UI.confirm({ title: '할 일을 지울까요?', body: `'${textOf(id)}'를 지워요. 바로 아래 알림에서 되돌릴 수 있어요.`, ok: '지우기', danger: true }))) return;
      return apply([id], 'delete', null, '할 일을 지웠어요.');
    }
    if (a === 'skipped') return skippedSheet();
    if (a === 'month-prev' || a === 'month-next') { M.month = new Date(M.month.getFullYear(), M.month.getMonth() + (a === 'month-prev' ? -1 : 1), 1); M.selectedDay = null; return rerender(3); }
    if (a === 'day') { M.selectedDay = b.dataset.date; rerender(3); return view().querySelector(`[data-date="${M.selectedDay}"]`)?.focus({ preventScroll: true }); }
    if (a === 'route') return route(b.dataset.route, b.dataset.subject);
  });
  // 과목 카드 펼침 상태 기억
  view().addEventListener('toggle', e => {
    const d = e.target.closest?.('.sd-review-report'); if (!d) return;
    d.open ? M.expanded.add(d.dataset.subject) : M.expanded.delete(d.dataset.subject);
  }, true);
  view().addEventListener('keydown', e => {
    if (!e.target.matches('[role=tab]')) return;
    let n = M.tab;
    if (e.key === 'ArrowRight') n = (n + 1) % 4; else if (e.key === 'ArrowLeft') n = (n + 3) % 4; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = 3; else return;
    e.preventDefault(); M.tab = n; sync(); view().querySelectorAll('[role=tab]')[n].focus();
  });
  // 터치 스와이프(가로 45px 이상, 세로보다 1.4배 이상) — 버튼·입력에서 시작하면 무시
  let start = null;
  view().addEventListener('touchstart', e => { if (!e.target.closest('.sd-review-viewport') || e.target.closest('button,summary,input,a')) return; start = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  view().addEventListener('touchend', e => {
    if (!start) return; const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y; start = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) { M.tab = Math.max(0, Math.min(3, M.tab + (dx < 0 ? 1 : -1))); sync(); }
  }, { passive: true });

  function open(back) {
    M.back = back || { label: '학습', nav: 'study', go: () => window.Shell.goNav('study') };
    window.Shell.showView('view-review', M.back.nav);
    render();
  }
  // 다른 곳에서 할 일·기록이 바뀌면(동기화 포함) 보이는 동안 다시 계산
  const baseSummary = renderSummary;
  renderSummary = function () { baseSummary(); if (!view().classList.contains('hidden')) { load(); for (let i = 0; i < 4; i++) rerender(i); } };

  window.Review = { open, render, countLabel };
})();
