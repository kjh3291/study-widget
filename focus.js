// 집중(열품타식 공부 타이머) — 2차 디자인 B안
//  - 오늘 화면 위 타이머 띠 → 집중 메인(과목 목록) → 몰입 화면(공부/휴식/종료)
//  - 학습 › 집중 기록(일·주·월, 과목 비율, 연속 공부, 세션 목록)
//  - 동아리 › 같이 공부(지금 공부 중, 오늘·이번 주 랭킹, 스터디방 랭킹) — 서버 server/src/focus.js
// 시간 계산은 벽시계 기준: 공부 구간 [시작, 끝]을 모아 두고, 창 숨김·절전·앱 종료 동안은 세지 않는다.
// 진행 중 타이머는 이 기기에만(localStorage) 둔다. 끝난 세션만 state.focus.sessions로 동기화한다.
(function () {
  const { ico, esc } = window.UI;
  const KEY = 'studeck.focusTimer';
  const GAP_MS = 120 * 1000;             // 이보다 오래 시계가 멈췄으면(절전·종료) 그 사이는 공부로 안 셈
  const COLORS = 8;

  // ---------- 날짜 기준(기본 05:00, 설정에서 바꿈) ----------
  const dayStartMin = () => (Number.isFinite(state.focusDayStart) ? state.focusDayStart : 300);
  focusDay = (t = Date.now()) => fmtD(new Date(t - dayStartMin() * 60000));   // renderer의 focusDay를 설정값 기준으로 바꿈
  // t가 속한 공부일이 끝나는 시각(다음 기준 시각)
  function dayEnd(t) {
    const d = new Date(t - dayStartMin() * 60000); d.setHours(0, 0, 0, 0);
    return d.getTime() + 86400000 + dayStartMin() * 60000;
  }
  const dayStartLabel = () => { const m = dayStartMin(); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const prevDayLabel = () => { const m = (dayStartMin() + 1439) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

  // ---------- 표시 ----------
  const hms = sec => { sec = Math.max(0, Math.floor(sec)); return [Math.floor(sec / 3600), Math.floor(sec % 3600 / 60), sec % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  const human = sec => { const m = Math.floor(sec / 60), h = Math.floor(m / 60); return h ? `${h}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`; };
  const goalSec = () => (state.focusGoalMin || 120) * 60;
  const goalLabel = () => human(goalSec());
  const sessionsOf = day => (state.focus?.sessions || []).filter(s => s.date === day);

  // ---------- 과목: 시간표 과목 + 직접 추가(할 일 과목 목록과 공유) ----------
  function colorOf(name) {
    const set = state.focus?.colors?.[name];
    if (set >= 1 && set <= COLORS) return set;
    let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % COLORS + 1;
  }
  const colorVar = name => `var(--subject-${colorOf(name)})`;
  function subjects() {
    const tt = state.timetableSubjects || [];
    const custom = (state.subjects || []).filter(s => !tt.includes(s));
    const list = [...tt.map(name => ({ name, source: '시간표 과목' })), ...custom.map(name => ({ name, source: '직접 추가', custom: true }))];
    // 기록에만 있는 과목(지운 과목)은 목록에 안 띄움. 진행 중인 과목은 항상 보이게
    if (T && T.subject && !list.some(s => s.name === T.subject)) list.unshift({ name: T.subject, source: '진행 중' });
    return list;
  }

  // ---------- 진행 중 타이머 ----------
  // T = { subject, task, startedAt, phase:'study'|'rest', phaseStart, segs:[[s,e]], restSec, lastBeat }
  let T = null;
  try { T = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { T = null; }
  const save = () => { try { T ? localStorage.setItem(KEY, JSON.stringify(T)) : localStorage.removeItem(KEY); } catch {} };
  const studySec = (now = Date.now()) => !T ? 0 : T.segs.reduce((a, [s, e]) => a + (e - s), 0) / 1000 + (T.phase === 'study' ? (now - T.phaseStart) / 1000 : 0);
  const restNow = (now = Date.now()) => T && T.phase === 'rest' ? (now - T.phaseStart) / 1000 : 0;
  const running = () => !!T;
  // 지금 세션 중 오늘(공부일)에 속하는 공부 초
  function liveTodaySec(now = Date.now()) {
    if (!T) return 0;
    const from = dayEnd(now) - 86400000;   // 오늘 공부일이 시작된 시각
    const segs = [...T.segs, ...(T.phase === 'study' ? [[T.phaseStart, now]] : [])];
    return segs.reduce((a, [s, e]) => a + Math.max(0, Math.min(e, now) - Math.max(s, from)), 0) / 1000;
  }
  const todayLogged = (subject) => sessionsOf(focusDay()).filter(s => subject === undefined || (s.subject || null) === subject).reduce((a, s) => a + sessionSec(s), 0);
  const todayTotal = () => todayLogged() + liveTodaySec();
  const subjectToday = name => todayLogged(name) + (T && T.subject === name ? liveTodaySec() : 0);
  const todayRest = () => sessionsOf(focusDay()).reduce((a, s) => a + (Number(s.rest) || 0), 0) + (T ? T.restSec + restNow() : 0);

  function report() {
    window.Community?.focus(T ? { state: T.phase === 'study' ? 'running' : 'paused', subject: T.subject, elapsed: Math.floor(studySec()) } : { state: 'stopped' });
  }

  function start(subject, task) {
    if (T) finish(true);
    const now = Date.now();
    T = { subject: subject || '집중', task: task || '', startedAt: now, phase: 'study', phaseStart: now, segs: [], restSec: 0, lastBeat: now };
    save(); report(); refresh(); openImmersive();
  }
  function rest() {
    if (!T || T.phase !== 'study') return;
    const now = Date.now(); T.segs.push([T.phaseStart, now]); T.phase = 'rest'; T.phaseStart = now;
    save(); report(); refresh();
  }
  function resume() {
    if (!T || T.phase !== 'rest') return;
    const now = Date.now(); T.restSec += (now - T.phaseStart) / 1000; T.phase = 'study'; T.phaseStart = now;
    save(); report(); refresh();
  }
  // 끝내고 기록: 공부 구간을 공부일 경계에서 나눠 날짜별 세션으로 저장. 1분 미만은 버림
  function finish(silent) {
    if (!T) return;
    const now = Date.now();
    if (T.phase === 'study') T.segs.push([T.phaseStart, now]); else T.restSec += (now - T.phaseStart) / 1000;
    const byDay = new Map();
    for (let [s, e] of T.segs) {
      while (s < e) {
        const cut = Math.min(e, dayEnd(s)), day = focusDay(s);
        const d = byDay.get(day) || { sec: 0, start: s, end: cut };
        d.sec += (cut - s) / 1000; d.start = Math.min(d.start, s); d.end = Math.max(d.end, cut);
        byDay.set(day, d); s = cut;
      }
    }
    const total = [...byDay.values()].reduce((a, d) => a + d.sec, 0);
    const done = { subject: T.subject, total };
    if (total >= 60) {
      let first = true;
      for (const [date, d] of byDay) {
        if (d.sec < 1) continue;
        state.focus.sessions.push({ date, start: new Date(d.start).toISOString(), end: new Date(d.end).toISOString(), seconds: Math.round(d.sec),
          minutes: Math.round(d.sec / 60), rest: first ? Math.round(T.restSec) : 0, task: T.task || '', subject: T.subject });
        first = false;
      }
      if (state.focus.sessions.length > 4000) state.focus.sessions = state.focus.sessions.slice(-3000);
      persist({ focus: state.focus });
    }
    T = null; save(); report();
    if (!silent) {
      showToast(total >= 60 ? `${done.subject} ${human(total)} 기록했어요` : '1분 미만은 기록하지 않아요');
      closeImmersive(); refresh();
    }
  }
  async function confirmFinish() {
    if (!T) return;
    const ok = await UI.confirm({ title: '공부를 마칠까요?', body: `${T.subject} 공부 ${human(studySec())}을 기록해요. 휴식 시간은 따로 보관돼요.`, ok: '종료', danger: true });
    if (ok) finish(false);
  }

  // 1초마다: 화면 숫자 갱신 + 시계가 오래 멈췄던 구간(절전·종료) 빼기
  function tick() {
    const now = Date.now();
    if (T) {
      if (now - (T.lastBeat || now) > GAP_MS && T.phase === 'study') {
        // 멈춘 동안은 공부로 세지 않고 휴식으로 돌린다
        T.segs.push([T.phaseStart, T.lastBeat]); T.phase = 'rest'; T.phaseStart = now;
        showToast('컴퓨터가 쉬던 동안은 빼고 휴식으로 바꿨어요');
        report(); refresh();
      } else if (now - (T.lastBeat || now) > GAP_MS) {
        // 휴식 중에 꺼져 있던 시간도 휴식으로 쌓지 않는다
        T.restSec += (T.lastBeat - T.phaseStart) / 1000; T.phaseStart = now;
      }
      T.lastBeat = now;
      if (++beats % 15 === 0) save();
    }
    updateLive();
  }
  let beats = 0;
  setInterval(tick, 1000);
  window.addEventListener('beforeunload', save);

  // ---------- 화면 공통: data-live 숫자만 1초마다 바꾼다 ----------
  function updateLive() {
    const vals = { today: hms(todayTotal()), session: hms(T ? (T.phase === 'rest' ? restNow() : studySec()) : 0), rest: hms(todayRest()) };
    document.querySelectorAll('[data-live]').forEach(el => {
      const k = el.dataset.live;
      const v = k.startsWith('subj:') ? hms(subjectToday(k.slice(5))) : vals[k];
      if (v !== undefined && el.textContent !== v) el.textContent = v;
    });
    const pct = Math.min(100, Math.round(todayTotal() / goalSec() * 100));
    document.querySelectorAll('[data-live-pct]').forEach(el => { el.style.setProperty(el.dataset.livePct, pct + '%'); });
    document.querySelectorAll('[data-live-pcttext]').forEach(el => { el.textContent = el.dataset.livePcttext.replace('%p', pct); });
  }
  function refresh() {
    $('app').dataset.running = String(!!T);
    renderBand();
    if (!$('view-focus').classList.contains('hidden')) renderMain();
    if (!$('focus-view').classList.contains('hidden')) renderImmersive();
    if (state.mini) renderMiniFocus();
    updateLive();
  }

  // ---------- 오늘: 타이머 띠 ----------
  function renderBand() {
    let band = $('focus-band');
    if (!band) {
      $('view-todos').querySelector('.page-head').insertAdjacentHTML('afterend', '<div class="pad band-pad"><button type="button" class="sd-timer-band" id="focus-band"></button></div>');
      band = $('focus-band');
      band.onclick = () => (T ? openImmersive() : open(TODAY));
    }
    const reached = todayTotal() >= goalSec();
    band.innerHTML = `${ico('timer')}<span class="sd-grow"><span class="sd-muted">${T ? `${esc(T.subject)} · ${T.phase === 'study' ? '공부 중' : '휴식 중'}` : '오늘 공부'}</span><strong data-live="today">${hms(todayTotal())}</strong></span>
      <span class="sd-muted band-side">${reached ? '목표 달성' : `목표 ${goalLabel()}`}<br>${T ? '집중 중 보기' : '집중 열기'}</span>${ico('chevron-right')}`;
    band.setAttribute('aria-label', `오늘 공부 ${human(todayTotal())}, 목표 ${goalLabel()}. ${T ? '집중 중 화면 열기' : '집중 열기'}`);
  }

  // ---------- 들어온 곳으로 돌아가기 ----------
  // 집중·집중 기록·같이 공부는 여러 곳에서 열리므로, 열 때 받은 { label, nav, go }로 뒤로 가기를 정한다
  const TODAY = { label: '오늘', nav: 'today', go: () => window.Shell.goNav('today') };
  const STUDY = { label: '학습', nav: 'study', go: () => window.Shell.goNav('study') };
  const CLUB = { label: '동아리', nav: 'club', go: () => window.Shell.goNav('club') };
  let mainBack = TODAY, recBack = STUDY, togBack = CLUB;
  const toMain = () => ({ label: '집중', nav: mainBack.nav, go: () => open() });

  // ---------- 집중 메인 ----------
  function open(back) { if (back) mainBack = back; window.Shell.showView('view-focus', mainBack.nav); renderMain(); }
  function renderMain() {
    const list = subjects(), pct = Math.min(100, Math.round(todayTotal() / goalSec() * 100)), reached = todayTotal() >= goalSec();
    $('view-focus').innerHTML = `<main class="sd-content sd-header-glow sd-focus-main">
      <button type="button" class="sd-btn sd-btn-ghost sd-back" data-f="back">${ico('chevron-left')}${esc(mainBack.label)}</button>
      <div class="sd-page-head"><div><h1>집중</h1></div><button type="button" class="sd-btn sd-btn-small" data-f="records">${ico('chart-no-axes-column')}기록</button></div>
      <div class="sd-focus-total"><p class="sd-muted">오늘 총 공부 시간${reached ? ' · <span class="sd-accent">목표 달성</span>' : ''}</p><div class="sd-time" data-live="today">${hms(todayTotal())}</div>
        <div class="sd-row sd-muted"><span>목표 ${goalLabel()}</span><span data-live-pcttext="%p%">${pct}%</span></div>
        <div class="sd-progress" role="progressbar" aria-label="목표 진행률" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span data-live-pct="--progress" style="--progress:${pct}%"></span></div>
        <div class="sd-row sd-muted"><span>오늘 휴식 <span data-live="rest">${hms(todayRest())}</span></span><span>${dayStartLabel()}부터 하루를 계산해요.</span></div></div>
      ${T ? `<button type="button" class="sd-btn sd-btn-primary sd-btn-block" data-f="immersive">${ico('timer')}${esc(T.subject)} ${T.phase === 'study' ? '공부 중' : '휴식 중'} · 몰입 화면</button>` : ''}
      <div class="sd-row sd-gap"><h3>공부할 과목</h3><button type="button" class="sd-btn sd-btn-small sd-btn-ghost" data-f="add">${ico('plus')}과목 추가</button></div>
      ${list.length ? list.map(s => {
        const on = T && T.subject === s.name;
        return `<div class="subject-wrap"><button type="button" class="sd-subject${on ? ' active' : ''}" data-subject="${esc(s.name)}" aria-label="${esc(s.name)} ${on ? '진행 중' : '공부 시작'}">
          <span class="sd-color-dot" style="--subject-color:${colorVar(s.name)}"></span>
          <span class="sd-grow"><strong>${esc(s.name)}</strong><span class="sd-muted">${on ? (T.phase === 'study' ? '공부 중' : '휴식 중') : s.source}</span></span>
          <strong class="sd-number" data-live="subj:${esc(s.name)}">${hms(subjectToday(s.name))}</strong>${ico(on ? 'timer' : 'play')}</button>
          <button type="button" class="sd-btn sd-btn-ghost sd-btn-icon subject-more" data-subject-edit="${esc(s.name)}" aria-label="${esc(s.name)} 색${s.custom ? '·삭제' : ''}">${ico('ellipsis')}</button></div>`;
      }).join('') : `<div class="sd-empty"><span class="sd-ico" data-icon="book-open" aria-hidden="true"></span><h3>공부할 과목이 없어요.</h3>
        <p>시간표를 등록하면 과목이 자동으로 들어와요. 토익·코딩테스트처럼 직접 추가할 수도 있어요.</p>
        <button type="button" class="sd-btn sd-btn-primary" data-f="add">${ico('plus')}과목 추가</button></div>`}
      ${SERVER_MODE ? `<button type="button" class="sd-btn sd-btn-ghost sd-btn-block sd-gap" data-f="together">${ico('users')}동아리원과 같이 공부</button>` : ''}
    </main>`;
  }
  $('view-focus').addEventListener('click', e => {
    const s = e.target.closest('[data-subject]');
    if (s) { const name = s.dataset.subject; return T && T.subject === name ? openImmersive() : start(name, ''); }
    const ed = e.target.closest('[data-subject-edit]'); if (ed) return editSubject(ed.dataset.subjectEdit);
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (f === 'back') mainBack.go();
    if (f === 'records') openRecords(null, toMain());
    if (f === 'immersive') openImmersive();
    if (f === 'add') addSubject();
    if (f === 'together') openTogether(null, toMain());
  });

  function colorPicker(cur) {
    return `<div class="sd-color-picker" role="radiogroup" aria-label="과목 색">${Array.from({ length: COLORS }, (_, i) => i + 1).map(i =>
      `<label class="sd-color-choice" style="--subject-color:var(--subject-${i})"><input type="radio" name="subject-color" value="${i}" aria-label="과목 색 ${i}" ${i === cur ? 'checked' : ''}></label>`).join('')}</div>`;
  }
  function setColor(name, c) { state.focus.colors = { ...(state.focus.colors || {}), [name]: c }; persist({ focus: state.focus }); }
  function addSubject(prefill, after) {
    const s = UI.sheet('과목 추가', `<form id="subj-form"><div class="sd-field"><label for="subj-name">과목 이름</label>
      <input id="subj-name" class="sd-input" maxlength="30" placeholder="예: 코딩테스트" autocomplete="off" value="${esc(prefill || '')}" autofocus></div>
      <div class="sd-field"><span class="sd-label">과목 색</span>${colorPicker(1)}</div><p class="sd-error" id="subj-err" hidden></p>
      <button class="sd-btn sd-btn-primary sd-btn-block">추가</button></form>`);
    s.el.querySelector('#subj-form').onsubmit = e => {
      e.preventDefault();
      const name = $('subj-name').value.trim(), err = $('subj-err');
      if (!name) { err.textContent = '과목 이름을 입력하세요.'; err.hidden = false; $('subj-name').setAttribute('aria-invalid', 'true'); return; }
      if (subjects().some(x => x.name === name)) { err.textContent = '이미 있는 과목이에요.'; err.hidden = false; return; }
      if (!state.subjects.includes(name)) { state.subjects.push(name); saveSubjects(); }
      setColor(name, Number(s.el.querySelector('[name=subject-color]:checked')?.value || 1));
      s.close(); refresh(); after?.(name);
    };
  }
  function editSubject(name) {
    const sub = subjects().find(x => x.name === name); if (!sub) return;
    const s = UI.sheet(name, `<div class="sd-field"><span class="sd-label">과목 색</span>${colorPicker(colorOf(name))}</div>
      ${sub.custom ? `<button type="button" class="sd-btn sd-btn-ghost sd-btn-block sd-danger-text" data-del>${ico('trash-2')}과목 지우기</button><p class="sd-muted">지운 과목의 공부 기록은 그대로 남아요.</p>` : '<p class="sd-muted">시간표 과목은 시간표에서 고칠 수 있어요.</p>'}`);
    s.el.addEventListener('change', e => { if (e.target.name === 'subject-color') { setColor(name, Number(e.target.value)); refresh(); } });
    s.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await UI.confirm({ title: `'${name}' 과목을 지울까요?`, body: '과목 목록에서만 빠지고 공부 기록은 남아요.', ok: '지우기', danger: true }))) return;
      state.subjects = state.subjects.filter(x => x !== name); saveSubjects(); s.close(); refresh();
    });
  }

  // 할 일 ▶: 과목이 있으면 그 과목으로, 없으면 과목 고르기
  startFocus = function (taskText, subject) {
    if (subject) return start(subject, taskText);
    const list = subjects();
    const s = UI.sheet('어떤 과목을 공부할까요?', `<p class="sd-muted">연결한 할 일 · ${esc(taskText || '')}</p>
      <div class="pick-list">${list.map(x => `<button type="button" class="sd-subject" data-pick="${esc(x.name)}"><span class="sd-color-dot" style="--subject-color:${colorVar(x.name)}"></span>
        <span class="sd-grow"><strong>${esc(x.name)}</strong></span>${ico('play')}</button>`).join('')}</div>
      <button type="button" class="sd-btn sd-btn-ghost sd-btn-block sd-gap" data-pick-new>${ico('plus')}과목 추가</button>`);
    s.el.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]'); if (b) { s.close(); start(b.dataset.pick, taskText); }
      if (e.target.closest('[data-pick-new]')) { s.close(); addSubject('', name => start(name, taskText)); }
    });
  };
  stopTimer = () => confirmFinish();
  pauseTimer = () => (T?.phase === 'rest' ? resume() : rest());
  enterFocus = () => openImmersive();
  renderFocus = () => renderImmersive();
  exitFocus = () => closeImmersive();

  // ---------- 몰입 화면 ----------
  function openImmersive() {
    if (!T) return open(TODAY);
    $('focus-view').classList.remove('hidden'); $('app').classList.add('no-nav', 'immersive');
    renderImmersive();
  }
  function closeImmersive() { $('focus-view').classList.add('hidden'); $('app').classList.remove('no-nav', 'immersive'); }
  function renderImmersive() {
    const fv = $('focus-view'); if (!T) { closeImmersive(); return; }
    const isRest = T.phase === 'rest', pct = Math.min(100, Math.round(todayTotal() / goalSec() * 100));
    fv.innerHTML = `<div class="sd-immersive-top"><button type="button" class="sd-btn sd-btn-ghost sd-back" data-i="leave">${ico('chevron-left')}몰입 나가기</button>
        <span class="sd-badge sd-badge-accent">${isRest ? '휴식 중' : '공부 중'}</span></div>
      <main class="sd-immersive"><h1>${esc(T.subject)}</h1>${T.task ? `<p class="sd-muted">연결한 할 일 · ${esc(T.task)}</p>` : ''}
        <div class="sd-orbit${isRest ? ' rest' : ''}" data-live-pct="--ring-progress" style="--ring-progress:${isRest ? 0 : pct}%"><div class="sd-orbit-body">
          <span class="sd-muted">${isRest ? '이번 휴식' : '이번 집중'}</span><div class="sd-time" data-live="session">${hms(isRest ? restNow() : studySec())}</div>
          <span class="sd-muted"${isRest ? '' : ' data-live-pcttext="하루 목표 %p%"'}>${isRest ? '공부 시간은 멈춰 있어요.' : `하루 목표 ${pct}%`}</span></div></div>
        <p>오늘 총 공부 <strong class="sd-number" data-live="today">${hms(todayTotal())}</strong></p>
        <p class="sd-muted">목표 ${goalLabel()} · 오늘 휴식 <span data-live="rest">${hms(todayRest())}</span></p>
        <div class="sd-actions"><button type="button" class="sd-btn" data-i="${isRest ? 'resume' : 'rest'}">${ico(isRest ? 'play' : 'pause')}${isRest ? '다시 공부' : '휴식'}</button>
          <button type="button" class="sd-btn sd-btn-primary" data-i="end">${ico('square')}종료</button></div>
        <p class="sd-muted">휴식 시간은 공부 시간과 따로 기록해요.</p></main>`;
    if (isRest) fv.querySelector('.sd-orbit').removeAttribute('data-live-pct');
  }
  $('focus-view').addEventListener('click', e => {
    const a = e.target.closest('[data-i]')?.dataset.i;
    if (a === 'leave') { closeImmersive(); open(); }
    if (a === 'rest') rest();
    if (a === 'resume') resume();
    if (a === 'end') confirmFinish();
  });

  // ---------- 미니 모드 ----------
  function renderMiniFocus() {
    let box = $('mini-focus');
    if (!box) { $('view-mini').insertAdjacentHTML('afterbegin', '<div id="mini-focus" class="sd-mini-body"></div>'); box = $('mini-focus'); }
    if (!T) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const isRest = T.phase === 'rest';
    box.innerHTML = `<div class="sd-row"><span class="sd-mini-head">${isRest ? '휴식 중' : `<span class="sd-accent">●</span> ${esc(T.subject)} 공부 중`}</span>
      <button type="button" class="sd-btn sd-btn-ghost sd-btn-icon" data-m="${isRest ? 'resume' : 'rest'}" aria-label="${isRest ? '다시 공부' : '휴식'}">${ico(isRest ? 'play' : 'pause')}</button></div>
      <div class="sd-row"><strong class="sd-time" data-live="session">${hms(isRest ? restNow() : studySec())}</strong><span class="sd-muted">오늘 <span data-live="today">${hms(todayTotal())}</span></span></div>
      ${T.task ? `<p class="sd-muted sd-truncate">${esc(T.task)}</p>` : ''}<div class="sd-divider" style="margin:10px 0 0"></div>`;
  }
  $('view-mini').addEventListener('click', e => { const m = e.target.closest('[data-m]')?.dataset.m; if (m === 'rest') rest(); if (m === 'resume') resume(); });
  const baseRenderMini = renderMini;
  renderMini = function () { baseRenderMini(); renderMiniFocus(); };

  // ---------- 집중 기록 ----------
  const R = { mode: 'week', anchor: null, selected: null };
  const parseDay = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
  const addDays = (d, n) => { const x = parseDay(d); x.setDate(x.getDate() + n); return fmtD(x); };
  const weekStartOf = d => { const x = parseDay(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return fmtD(x); };
  const dayTotal = day => sessionsOf(day).reduce((a, s) => a + sessionSec(s), 0) + (day === focusDay() ? liveTodaySec() : 0);
  function streak() {
    let d = focusDay(), n = 0;
    if (dayTotal(d) < 60) d = addDays(d, -1);   // 오늘 아직 안 했으면 어제까지로 셈
    while (dayTotal(d) >= 60) { n++; d = addDays(d, -1); }
    return n;
  }
  function openRecords(mode, back) {
    recBack = back || STUDY;
    R.mode = mode || R.mode; R.anchor = R.anchor || focusDay(); R.selected = R.selected || focusDay();
    window.Shell.showView('view-records', recBack.nav); renderRecords();
  }
  function periodBars() {
    const a = R.anchor;
    if (R.mode === 'day') {
      // 기준 시각부터 2시간씩 12칸
      const from = parseDay(a).getTime() + dayStartMin() * 60000;
      const cols = Array.from({ length: 12 }, (_, i) => ({ s: from + i * 7200000, e: from + (i + 1) * 7200000, sec: 0 }));
      const segs = sessionsOf(a).filter(s => s.start && s.end).map(s => [Date.parse(s.start), Date.parse(s.end), sessionSec(s)]);
      if (T && a === focusDay()) [...T.segs, ...(T.phase === 'study' ? [[T.phaseStart, Date.now()]] : [])].forEach(([s, e]) => segs.push([s, e, (e - s) / 1000]));
      for (const [s, e, sec] of segs) { const span = Math.max(1, e - s); for (const c of cols) c.sec += sec * Math.max(0, Math.min(e, c.e) - Math.max(s, c.s)) / span; }
      return { title: `${parseDay(a).getMonth() + 1}월 ${parseDay(a).getDate()}일 ${'일월화수목금토'[parseDay(a).getDay()]}요일`, chart: '시간대별 공부',
        total: dayTotal(a), totalLabel: a === focusDay() ? '오늘 공부' : '이날 공부',
        bars: cols.map(c => ({ label: String(new Date(c.s).getHours()).padStart(2, '0'), sec: c.sec, day: a })) };
    }
    if (R.mode === 'week') {
      const ws = weekStartOf(a), days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
      const f = d => `${parseDay(d).getMonth() + 1}.${parseDay(d).getDate()}`;
      return { title: `${f(days[0])} — ${f(days[6])}`, chart: '일별 공부 시간', totalLabel: ws === weekStartOf(focusDay()) ? '이번 주 공부' : '이 주 공부',
        total: days.reduce((x, d) => x + dayTotal(d), 0), bars: days.map((d, i) => ({ label: '월화수목금토일'[i], sec: dayTotal(d), day: d })) };
    }
    const first = parseDay(a); first.setDate(1);
    const y = first.getFullYear(), m = first.getMonth(), last = new Date(y, m + 1, 0).getDate();
    const weeks = []; let ws = weekStartOf(fmtD(first));
    while (parseDay(ws).getMonth() <= m && parseDay(ws).getFullYear() <= y || weeks.length === 0) {
      const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter(d => parseDay(d).getMonth() === m);
      if (!days.length) break;
      weeks.push(days); ws = addDays(ws, 7);
      if (weeks.length > 6) break;
    }
    const today = focusDay();
    return { title: `${y}년 ${m + 1}월`, chart: '주별 공부 시간', totalLabel: fmtD(first).slice(0, 7) === today.slice(0, 7) ? '이번 달 공부' : '이 달 공부',
      total: Array.from({ length: last }, (_, i) => dayTotal(fmtD(new Date(y, m, i + 1)))).reduce((x, s) => x + s, 0),
      bars: weeks.map((days, i) => ({ label: `${i + 1}주`, sec: days.reduce((x, d) => x + dayTotal(d), 0), day: days.filter(d => d <= today).pop() || days[0], days })) };
  }
  function renderRecords() {
    const any = (state.focus?.sessions || []).length || T;
    const seg = `<div class="sd-segment" role="group" aria-label="보기 선택">${[['day', '일'], ['week', '주'], ['month', '월']].map(([k, l]) =>
      `<button type="button" aria-pressed="${R.mode === k}" data-r-mode="${k}">${l}</button>`).join('')}</div>`;
    const head = `<button type="button" class="sd-btn sd-btn-ghost sd-back" data-r="back">${ico('chevron-left')}${esc(recBack.label)}</button>
      <div class="sd-page-head"><div><h1>집중 기록</h1><p class="sd-page-subtitle">${dayStartLabel()}부터 다음 날 ${prevDayLabel()}까지 기록해요.</p></div></div>${seg}`;
    if (!any) {
      $('view-records').innerHTML = `<main class="sd-content">${head}<div class="sd-empty"><span class="sd-ico" data-icon="chart-no-axes-column" aria-hidden="true"></span>
        <h3>아직 공부 기록이 없어요.</h3><p>첫 공부를 시작하면 여기에 모아드려요.</p><button type="button" class="sd-btn sd-btn-primary" data-r="start">공부 시작</button></div></main>`;
      return;
    }
    const p = periodBars(), max = Math.max(...p.bars.map(b => b.sec), 1);
    const sel = R.selected, selDays = R.mode === 'month' ? (p.bars.find(b => b.days?.includes(sel))?.days || [sel]) : [sel];
    const selSessions = sessionsOf(sel).slice().sort((x, y) => String(y.start || '').localeCompare(String(x.start || '')));
    const bySubj = {};
    sessionsOf(sel).forEach(s => { const k = s.subject || '기타'; bySubj[k] = (bySubj[k] || 0) + sessionSec(s); });
    if (T && sel === focusDay()) bySubj[T.subject] = (bySubj[T.subject] || 0) + liveTodaySec();
    const selTotal = Object.values(bySubj).reduce((a, b) => a + b, 0);
    const ratio = Object.entries(bySubj).sort((a, b) => b[1] - a[1]);
    const time = iso => iso ? new Date(iso).toTimeString().slice(0, 5) : '';
    const isSelected = b => R.mode === 'day' ? false : R.mode === 'month' ? b.days.includes(sel) : b.day === sel;
    $('view-records').innerHTML = `<main class="sd-content">${head}
      <div class="sd-row sd-gap"><button type="button" class="sd-btn sd-btn-ghost sd-btn-icon" data-r="prev" aria-label="이전 기간">${ico('chevron-left')}</button>
        <strong>${p.title}</strong><button type="button" class="sd-btn sd-btn-ghost sd-btn-icon" data-r="next" aria-label="다음 기간" ${R.anchor >= focusDay() ? 'disabled' : ''}>${ico('chevron-right')}</button></div>
      <div class="sd-two-cols sd-gap"><div class="sd-stat"><span class="sd-muted">${p.totalLabel}</span><strong>${human(p.total)}</strong></div>
        <div class="sd-stat"><span class="sd-muted">연속 공부</span><strong>${streak()}일째</strong></div></div>
      <div class="sd-row sd-gap"><h3>${p.chart}</h3><span class="sd-muted">가장 많이 ${human(max)}</span></div>
      <div class="sd-bar-chart" role="group" aria-label="공부 시간 그래프">${p.bars.map(b => `<button type="button" class="sd-bar-col${isSelected(b) ? ' selected' : ''}" data-r-day="${b.day}"
        aria-label="${b.label}, ${human(b.sec)}"><span class="sd-bar" style="--bar-height:${Math.max(2, Math.round(b.sec / max * 100))}%"></span><span>${b.label}</span></button>`).join('')}</div>
      <div class="sd-divider"></div>
      <div class="sd-row"><h3>${parseDay(sel).getMonth() + 1}월 ${parseDay(sel).getDate()}일 · ${human(selTotal)}</h3><span class="sd-muted">선택한 날짜</span></div>
      ${selTotal ? `<div class="sd-ratio">${ratio.map(([k, v]) => `<span style="--subject-color:${colorVar(k)};--ratio-width:${(v / selTotal * 100).toFixed(1)}%" title="${esc(k)}"></span>`).join('')}</div>
        <p class="sd-muted">${ratio.map(([k, v]) => `${esc(k)} ${Math.round(v / selTotal * 100)}%`).join(' · ')}</p>` : '<p class="sd-muted sd-gap">이날은 공부 기록이 없어요.</p>'}
      ${T && sel === focusDay() ? `<div class="sd-session"><div class="sd-row"><strong>${esc(T.subject)}</strong><span>${time(new Date(T.startedAt).toISOString())} — 진행 중</span></div>${T.task ? `<p class="sd-muted">${esc(T.task)}</p>` : ''}</div>` : ''}
      ${selSessions.map(s => `<div class="sd-session"><div class="sd-row"><strong>${esc(s.subject || '기타')}</strong><span>${s.start ? `${time(s.start)} — ${time(s.end)}` : human(sessionSec(s))}</span></div>
        <p class="sd-muted">${s.task ? esc(s.task) + ' · ' : ''}${human(sessionSec(s))}${s.rest ? ` · 휴식 ${human(s.rest)}` : ''}</p></div>`).join('')}
    </main>`;
  }
  $('view-records').addEventListener('click', e => {
    const m = e.target.closest('[data-r-mode]'); if (m) { R.mode = m.dataset.rMode; R.anchor = R.selected; return renderRecords(); }
    const d = e.target.closest('[data-r-day]');
    if (d) { R.selected = d.dataset.rDay; if (R.mode === 'day') R.anchor = R.selected; return renderRecords(); }
    const a = e.target.closest('[data-r]')?.dataset.r;
    if (a === 'back') recBack.go();
    if (a === 'start') open(TODAY);
    if (a === 'prev' || a === 'next') {
      const k = a === 'prev' ? -1 : 1;
      if (R.mode === 'day') R.anchor = addDays(R.anchor, k);
      else if (R.mode === 'week') R.anchor = addDays(R.anchor, 7 * k);
      else { const x = parseDay(R.anchor); x.setDate(1); x.setMonth(x.getMonth() + k); R.anchor = fmtD(x); }
      if (R.anchor > focusDay()) R.anchor = focusDay();
      R.selected = R.mode === 'week' ? (addDays(weekStartOf(R.anchor), 6) > focusDay() ? focusDay() : addDays(weekStartOf(R.anchor), 6)) : R.anchor;
      renderRecords();
    }
  });

  // ---------- 같이 공부 ----------
  const G = { scope: null, period: 'today', rooms: [], live: [], rank: null, publicMe: null };
  function openTogether(roomId, back) {
    togBack = back || CLUB;
    G.scope = roomId || null;
    window.Shell.showView('view-together', togBack.nav); loadTogether();
  }
  async function loadTogether() {
    const C = window.Community;
    renderTogether(true);
    const [prof, rooms] = await Promise.all([C.call('GET', '/me/profile'), C.rooms()]);
    G.publicMe = !!prof?.profile?.showStudy;
    G.rooms = (rooms?.rooms || []).filter(r => r.kind === 'study' && r.status === 'active');
    if (G.publicMe) {
      const [lv, rk] = await Promise.all([C.focusLive(), C.focusRanking(G.period, G.scope)]);
      G.live = lv?.live || []; G.rank = rk?.ranking ? rk : null;
      if (G.scope && G.rank) { const members = new Set(G.rank.ranking.map(r => r.userId)); G.live = G.live.filter(l => members.has(l.userId)); }
    }
    renderTogether(false);
  }
  const initial = n => esc(String(n || '?').slice(0, 1));
  function renderTogether(loading) {
    const scopeName = G.scope ? (G.rooms.find(r => r.id === G.scope)?.name || '스터디방') : 'COSMIC 전체';
    const head = `<button type="button" class="sd-btn sd-btn-ghost sd-back" data-t="back">${ico('chevron-left')}${esc(togBack.label)}</button>
      <div class="sd-page-head"><div><h1>같이 공부</h1><p class="sd-page-subtitle">공개에 동의한 멤버와 함께해요.</p></div></div>
      <details class="sd-select" id="together-scope"><summary>${esc(scopeName)}</summary><div class="sd-select-menu">
        <button type="button" data-scope="">COSMIC 전체</button>${G.rooms.map(r => `<button type="button" data-scope="${r.id}">${esc(r.name)}</button>`).join('')}</div></details>`;
    let body;
    if (loading) body = `<div class="sd-skeleton-row"><span class="sd-skeleton-circle"></span><span class="sd-skeleton" style="flex:1"></span></div>`.repeat(3) + '<span class="sd-sr-only" role="status">불러오는 중</span>';
    else if (!G.publicMe) body = `<div class="sd-empty"><span class="sd-ico" data-icon="eye-off" aria-hidden="true"></span><h3>공개하면 함께 볼 수 있어요.</h3>
      <p>내 프로필에서 공부 시간 공개를 켜면 함께 공부와 랭킹을 볼 수 있어요.</p><button type="button" class="sd-btn sd-btn-primary" data-t="profile">공개 설정</button></div>`;
    else if (!G.rank) body = `<div class="sd-empty state-error"><span class="sd-ico" data-icon="circle-alert" aria-hidden="true"></span><h3>불러오지 못했어요.</h3><p>연결을 확인하고 다시 시도해 주세요.</p><button type="button" class="sd-btn" data-t="retry">다시 시도</button></div>`;
    else {
      const meId = G.rank.ranking.find(r => r.me)?.userId;
      body = `<div class="sd-row sd-gap-lg"><h3>지금 공부 중 ${G.live.filter(l => l.state === 'running').length}명</h3><span class="sd-muted">공개한 멤버</span></div>
        ${G.live.length ? `<div class="sd-live-grid sd-gap">${G.live.map(l => `<div class="sd-live-person"><strong><span class="${l.state === 'running' ? 'sd-accent' : 'sd-muted'}">●</span> ${esc(l.name)}${l.userId === meId ? ' · 나' : ''}</strong>
          <p class="sd-muted">${esc(l.subject || '집중')}${l.state === 'paused' ? ' · 휴식' : ''}</p><span class="sd-number" data-tl="${l.userId}">${hms(l.todaySeconds)}</span></div>`).join('')}</div>`
          : `<div class="sd-card sd-gap"><p class="sd-muted">아직 공부 중인 멤버가 없어요.</p><button type="button" class="sd-btn sd-btn-ghost sd-btn-small sd-gap" data-t="start">${ico('play')}먼저 공부 시작</button></div>`}
        <div class="sd-row sd-gap-lg"><h3>공부 시간 랭킹</h3><span class="sd-muted">${String(G.rank.dayStartHour).padStart(2, '0')}:00 기준</span></div>
        <div class="sd-gap"><div class="sd-segment" role="group" aria-label="기간 선택"><button type="button" aria-pressed="${G.period === 'today'}" data-period="today">오늘</button>
          <button type="button" aria-pressed="${G.period === 'week'}" data-period="week">이번 주</button></div></div>
        <div class="rank-list">${G.rank.ranking.length ? G.rank.ranking.map(r => `<div class="sd-rank${r.me ? ' mine' : ''}"><span class="sd-rank-position">${r.rank}</span>
          <span class="sd-avatar"${r.avatar ? ` data-av="${r.avatar}"` : ''}>${initial(r.name)}</span><span class="sd-grow">${esc(r.name)} ${r.me ? '<span class="sd-badge sd-badge-accent">나</span>' : ''}${r.studying ? ' <span class="sd-badge">공부 중</span>' : ''}</span>
          <strong class="sd-number">${hms(r.seconds)}</strong></div>`).join('') : '<p class="sd-muted sd-gap">아직 기록이 없어요.</p>'}</div>
        <p class="sd-muted sd-gap">공부 시간 공개는 내 프로필에서 바꿀 수 있어요.</p>`;
    }
    $('view-together').innerHTML = `<main class="sd-content">${head}${body}</main>`;
    $('view-together').querySelectorAll('[data-av]').forEach(async el => { const r = await window.Community.image(el.dataset.av); if (r?.ok) el.innerHTML = `<img src="${r.dataUrl}" alt="">`; });
  }
  $('view-together').addEventListener('click', e => {
    const sc = e.target.closest('[data-scope]');
    if (sc) { $('together-scope').open = false; G.scope = Number(sc.dataset.scope) || null; return loadTogether(); }
    const p = e.target.closest('[data-period]'); if (p) { G.period = p.dataset.period; return loadTogether(); }
    const a = e.target.closest('[data-t]')?.dataset.t;
    if (a === 'back') togBack.go();
    if (a === 'profile') window.Club?.openProfileEditor?.(() => loadTogether());
    if (a === 'start') open(TODAY);
    if (a === 'retry') loadTogether();
  });
  // 실시간: 누가 공부를 시작·멈추면 목록을 새로
  let liveTimer = null;
  window.Community?.on('focus', () => {
    if ($('view-together').classList.contains('hidden')) return;
    clearTimeout(liveTimer); liveTimer = setTimeout(loadTogether, 400);
  });
  // 실시간 목록의 오늘 시간은 1초마다 올라가게
  setInterval(() => {
    if ($('view-together').classList.contains('hidden')) return;
    G.live.forEach(l => { if (l.state !== 'running') return; l.todaySeconds++; const el = document.querySelector(`[data-tl="${l.userId}"]`); if (el) el.textContent = hms(l.todaySeconds); });
  }, 1000);

  // 시작할 때·다른 기기에서 기록/설정이 들어올 때 renderer가 요약을 다시 그리므로 그때 같이 그림
  const baseSummary = renderSummary;
  renderSummary = function () { baseSummary(); refresh(); };

  window.Focus ={ open, openRecords, openTogether, refresh, start, isRunning: running, subjects, colorVar, hms, human, dayStartLabel };
  refresh();
  // 다시 연결되면 진행 중 상태를 서버에 다시 알림(Community가 기억해 둠)
  if (T) report();
})();
