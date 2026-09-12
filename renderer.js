const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const PX_PER_HOUR = 52;

const $ = (id) => document.getElementById(id);

// ---------- 상태 ----------
const state = {
  identifier: '',
  subjects: [],           // 사용자가 직접 추가한 과목
  timetableSubjects: [],  // 에브리타임 자동 연동 과목명
  todos: [],              // { id, text, subject|null, due, dueTime?, done, doneAt, createdAt }
  events: [],             // { id, title, start, end, remindDaysBefore }
  lms: null,
  notifyState: { lastSummaryDate: '', firedIds: [], seenNotices: [] },
  lmsAuto: true,
  // UI
  todoDraft: { due: null, subject: null, repeat: null },
  calYear: 0, calMonth: 0,
  selectedDay: null,
  showGeneral: false,
  lmsOpenCourse: {},
  theme: 'dark',
  focus: { sessions: [] },
  evtDraft: { endDate: null, remind: 3 },  // 일정 추가: 종료일(명시), 미리알림(일)
  pickEndMode: false,
  timer: null,  // { taskText, mode:'focus'|'break', remaining, running, intervalId }
  timetableFull: [],  // 에타 시간표 subjects(name+times) 캐시 (출석용)
  attendance: { semesterStart: '', overrides: {} },  // 주차별 출석
  readIds: [],  // 읽은 공지/과제 id
  starredLms: [],  // 별표한 LMS 과제 id
  notifyPrefs: { morningHour: 8, deadlineAlerts: true },
  expandedTodos: {},  // 서브태스크 펼침 상태 (인메모리)
  todoSearch: '',     // 검색어
  mini: false,        // 미니 모드
};

const ATT_STATES = ['출석', '결석', '지각', '공결', '병결'];
const ATT_CLASS = { '출석': 'ok', '결석': 'danger', '지각': 'warn', '공결': 'info', '병결': 'mut' };

let currentTab = 'timetable';

const toMin = (v) => v * 5;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 45%)`;
}
function cleanCourse(raw) {
  let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/^(정규|비교과|일반|교양|전공|공통|강좌|과정|학부|대학원|진행\s*중|진행중|완료|예정|신청|수강)\s+/, '');
  } while (s !== prev);
  s = s.replace(/\s*\([^)]*\d[^)]*\).*$/, '').trim();
  return s || String(raw == null ? '' : raw).trim();
}

// ---------- 인라인 SVG 아이콘 ----------
const SVG = (p) => `<svg viewBox="0 0 24 24" class="isvg">${p}</svg>`;
const ICO = {
  sun: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  arrow: SVG('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  moon: SVG('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  calendar: SVG('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>'),
  inbox: SVG('<path d="M5 5h14l2 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/><path d="M3 12h4l2 3h6l2-3h4"/>'),
  pin: SVG('<path d="M9 3h6l-1 6 3 3H7l3-3-1-6zM12 15v6"/>'),
  play: SVG('<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/>'),
  mega: SVG('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a4 4 0 0 1 0 8"/>'),
  undo: SVG('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  check: SVG('<path d="M20 6 9 17l-5-5"/>'),
  tag: SVG('<path d="M20.6 13.4 12 22l-9-9V3h10z"/><circle cx="7.5" cy="7.5" r="1.6"/>'),
  play: SVG('<path d="M8 5.5v13l10-6.5z"/>'),
  pause: SVG('<path d="M8 5v14M16 5v14"/>'),
  stop: SVG('<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>'),
  x: SVG('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevD: SVG('<path d="M6 9l6 6 6-6"/>'),
  chevL: SVG('<path d="M15 6l-6 6 6 6"/>'),
  chevR: SVG('<path d="M9 6l6 6-6 6"/>'),
  star: SVG('<path d="M12 3.5l2.7 5.5 6 .9-4.35 4.25 1 6L12 17.3 6.65 20.15l1-6L3.3 9.9l6-.9z"/>'),
  checkbox: SVG('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11"/>'),
  clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  repeat: SVG('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
  search: SVG('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  edit: SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  plus: SVG('<path d="M12 5v14M5 12h14"/>'),
  minimize: SVG('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
};

// ---------- 토스트 ----------
let toastTimer = null;
function showToast(msg, actionLabel, onAction, ms) {
  const box = $('toast'); if (!box) return;
  box.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="t-msg">${escapeHtml(msg)}</span>` + (actionLabel ? `<span class="t-act">${escapeHtml(actionLabel)}</span>` : '');
  box.appendChild(el);
  if (actionLabel && onAction) el.querySelector('.t-act').onclick = () => { onAction(); hideToast(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, ms || 5000);
}
function hideToast() { const b = $('toast'); if (b) b.innerHTML = ''; }

// ---------- 상단 요약 바 ----------
function renderSummary() {
  const bar = $('summary'); if (!bar) return;
  const today = todayStr();
  const todayCount = activeItems().filter((i) => !i.done && i.due === today).length;
  const up = state.events.map((e) => ({ e, d: daysUntil(e.start) })).filter((x) => x.d !== null && x.d >= 0).sort((a, b) => a.d - b.d)[0];
  let left = `오늘 <b>${todayCount}</b>개 남음`;
  if (up) { const dd = up.d === 0 ? '오늘' : 'D-' + up.d; left += ` <span class="sum-sep">·</span> ${escapeHtml(up.e.title.length > 10 ? up.e.title.slice(0, 10) + '…' : up.e.title)} <b>${dd}</b>`; }
  let right = '';
  const t = state.timer;
  if (t) {
    right = `<span class="tm ${t.mode}"><span class="tm-time">${t.mode === 'focus' ? '집중' : '휴식'} ${fmtClock(t.remaining)}</span>`
      + `<button class="tm-btn" data-tm="pause" title="${t.running ? '일시정지' : '계속'}">${t.running ? ICO.pause : ICO.play}</button>`
      + `<button class="tm-btn" data-tm="stop" title="정지">${ICO.stop}</button></span>`;
  }
  bar.innerHTML = `<div class="sum-left">${left}</div><div class="sum-right">${right}</div>`;
}

// ---------- 미니 모드 ----------
function toggleMini() {
  state.mini = !state.mini;
  $('app').classList.toggle('mini', state.mini);
  window.api.setMini(state.mini);
  if (state.mini) renderMini();
}
function renderMini() {
  const today = todayStr();
  const items = activeItems().filter((i) => !i.done && (i.due === today || i.starred || (daysUntil(i.due) !== null && daysUntil(i.due) <= 0))).sort(sortByDue);
  $('mini-list').innerHTML = `<div class="cat-head cat-today"><span class="ico">${ICO.sun}</span>오늘 할 일<span class="cat-count">${items.length}</span></div>`
    + (items.length ? items.map((it) => todoRow(it, true)).join('') : '<div class="empty-note">오늘 할 일 없음 🎉</div>');
}

// ---------- 집중 타이머 (뽀모도로) ----------
const FOCUS_MIN = 25, BREAK_MIN = 5;
function fmtClock(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; }
function startFocus(taskText) {
  stopTimer(true);
  state.timer = { taskText: taskText || '집중', mode: 'focus', remaining: FOCUS_MIN * 60, running: true, elapsed: 0, intervalId: null };
  state.timer.intervalId = setInterval(timerTick, 1000);
  showToast(`집중 시작: ${taskText ? (taskText.length > 16 ? taskText.slice(0, 16) + '…' : taskText) : ''}`, null, null, 2500);
  renderSummary();
}
function timerTick() {
  const t = state.timer; if (!t || !t.running) return;
  t.remaining--;
  if (t.mode === 'focus') t.elapsed = (t.elapsed || 0) + 1;
  if (t.remaining <= 0) {
    if (t.mode === 'focus') {
      logFocus(t.taskText, FOCUS_MIN);
      t.elapsed = 0; t.mode = 'break'; t.remaining = BREAK_MIN * 60;
      window.api.notify('집중 완료!', `${t.taskText} · ${BREAK_MIN}분 휴식하세요`);
    } else {
      t.mode = 'focus'; t.remaining = FOCUS_MIN * 60; t.elapsed = 0;
      window.api.notify('휴식 끝', '다시 집중해볼까요?');
    }
  }
  renderSummary();
}
function pauseTimer() { const t = state.timer; if (!t) return; t.running = !t.running; renderSummary(); }
function stopTimer(silent) {
  const t = state.timer; if (!t) { if (!silent) renderSummary(); return; }
  clearInterval(t.intervalId);
  if (t.mode === 'focus' && (t.elapsed || 0) >= 60) logFocus(t.taskText, Math.round(t.elapsed / 60));
  state.timer = null;
  if (!silent) { renderSummary(); if (currentTab === 'stats') renderStats(); }
}
function logFocus(task, minutes) {
  if (!minutes) return;
  state.focus.sessions.push({ date: todayStr(), minutes, task: task || '' });
  if (state.focus.sessions.length > 2000) state.focus.sessions = state.focus.sessions.slice(-1500);
  persist({ focus: state.focus });
  if (currentTab === 'stats') renderStats();
}

// ---------- 저장 ----------
function persist(patch) { window.api.saveConfig(patch); }
function saveTodos() { persist({ todos: state.todos }); }
function saveEvents() { persist({ events: state.events }); }
function saveSubjects() { persist({ subjects: state.subjects }); }
function saveNotifyState() { persist({ notifyState: state.notifyState }); }

// ---------- 날짜 ----------
function fmtD(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function todayMidnight() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function todayStr() { return fmtD(new Date()); }
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}
function addDaysStr(dateStr, n) { const d = parseDate(dateStr) || todayMidnight(); d.setDate(d.getDate() + n); return fmtD(d); }
function daysUntil(dateStr) { const d = parseDate(dateStr); if (!d) return null; return Math.round((d - todayMidnight()) / 86400000); }
function dueDateTime(dateStr, timeStr) {
  const d = parseDate(dateStr); if (!d) return null;
  let hh = 23, mm = 59;
  if (timeStr) { const m = String(timeStr).match(/(\d{1,2}):(\d{2})/); if (m) { hh = +m[1]; mm = +m[2]; } }
  d.setHours(hh, mm, 0, 0); return d;
}
function ddayBadge(dateStr, done, timeStr) {
  const days = daysUntil(dateStr);
  if (done) return { label: '완료', cls: 'done' };
  if (days === null) return null;
  if (days > 0) return { label: `D-${days}`, cls: days <= 3 ? 'soon' : '' };
  if (days < 0) return { label: `지남 ${-days}일`, cls: 'over' };
  const due = dueDateTime(dateStr, timeStr);
  const ms = due ? due - Date.now() : 0;
  if (ms <= 0) return { label: '마감 지남', cls: 'over' };
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return { label: `${mins}분 남음`, cls: 'today' };
  const hrs = Math.floor(mins / 60), rem = mins % 60;
  return { label: rem ? `${hrs}시간 ${rem}분 남음` : `${hrs}시간 남음`, cls: 'today' };
}
function dueLabel(dateStr) {
  const d = daysUntil(dateStr);
  if (d === 0) return '오늘';
  if (d === 1) return '내일';
  if (d === 2) return '모레';
  const dt = parseDate(dateStr);
  return dt ? `${dt.getMonth() + 1}/${dt.getDate()}` : '오늘';
}

// ---------- 탭 ----------
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ['timetable', 'todos', 'schedule', 'lms', 'stats', 'attend'].forEach((t) => $('view-' + t).classList.toggle('hidden', t !== tab));
  if (tab === 'todos') renderTodos();
  if (tab === 'schedule') renderCalendar();
  if (tab === 'lms') renderLms();
  if (tab === 'stats') renderStats();
  if (tab === 'attend') renderAttendance();
  renderSummary();
  updateLmsBadge();
}

// =====================================================================
// 시간표
// =====================================================================
function showTimetableState(view) {
  $('empty').classList.toggle('hidden', view !== 'empty');
  $('status').classList.toggle('hidden', view !== 'status');
  $('grid-wrap').classList.toggle('hidden', view !== 'grid');
}
function setStatus(msg) { $('status').textContent = msg; showTimetableState('status'); }

function renderTimetable(subjects) {
  state.timetableSubjects = [...new Set(subjects.map((s) => s.name).filter(Boolean))];
  state.timetableFull = subjects;  // 출석 탭에서 요일 계산용
  let minStart = Infinity, maxEnd = -Infinity, maxDay = 4;
  for (const s of subjects) for (const t of s.times) {
    minStart = Math.min(minStart, toMin(t.start));
    maxEnd = Math.max(maxEnd, toMin(t.end));
    if (t.day > maxDay) maxDay = t.day;
  }
  if (!isFinite(minStart)) { minStart = 9 * 60; maxEnd = 18 * 60; }
  const gridStart = Math.min(9 * 60, Math.floor(minStart / 60) * 60);
  const gridEnd = Math.max(18 * 60, Math.ceil(maxEnd / 60) * 60);
  const pxPerMin = PX_PER_HOUR / 60;
  const height = (gridEnd - gridStart) * pxPerMin;
  const nDays = maxDay + 1;

  let head = '<div class="headrow"><div class="gutter"></div>';
  for (let d = 0; d < nDays; d++) head += `<div class="dhead">${DAY_NAMES[d]}</div>`;
  head += '</div>';
  let gutter = `<div class="gutter" style="height:${height}px">`;
  for (let m = gridStart; m <= gridEnd; m += 60) gutter += `<div class="hlabel" style="top:${(m - gridStart) * pxPerMin}px">${Math.floor(m / 60)}</div>`;
  gutter += '</div>';
  let cols = `<div class="days" style="height:${height}px">`;
  for (let d = 0; d < nDays; d++) {
    let col = '<div class="col">';
    for (let m = gridStart; m <= gridEnd; m += 60) col += `<div class="hourline" style="top:${(m - gridStart) * pxPerMin}px"></div>`;
    for (const s of subjects) for (const t of s.times) {
      if (t.day !== d) continue;
      const top = (toMin(t.start) - gridStart) * pxPerMin;
      const h = (toMin(t.end) - toMin(t.start)) * pxPerMin;
      col += `<div class="block" style="top:${top}px;height:${h}px;background:${colorFor(s.name)}">
        <div class="b-name">${escapeHtml(s.name)}</div>
        ${t.place ? `<div class="b-place">${escapeHtml(t.place)}</div>` : ''}
        ${s.professor ? `<div class="b-prof">${escapeHtml(s.professor)}</div>` : ''}
      </div>`;
    }
    col += '</div>'; cols += col;
  }
  cols += '</div>';
  $('grid-wrap').innerHTML = head + `<div class="grid">${gutter}${cols}</div>`;
  showTimetableState('grid');
}

async function loadTimetable(identifier) {
  if (!identifier) { showTimetableState('empty'); return; }
  setStatus('시간표를 불러오는 중…');
  const res = await window.api.fetchTimetable(identifier);
  if (res.ok) renderTimetable(res.subjects);
  else setStatus('⚠️ ' + res.error);
}

// =====================================================================
// 할 일
// =====================================================================
function allSubjects() {
  const lmsCourses = ((state.lms && state.lms.courses) || []).map((c) => cleanCourse(c.name)).filter(Boolean);
  return [...new Set([...state.timetableSubjects, ...lmsCourses, ...state.subjects])];
}

// 수동 할 일 + LMS 과제를 하나의 항목 리스트로
function activeItems() {
  const items = [];
  state.todos.forEach((t) => items.push({
    kind: 'todo', id: t.id, text: t.text, subject: t.subject || null, due: t.due, time: t.dueTime, done: t.done, starred: !!t.starred, repeat: t.repeat || null, subs: t.subs || [],
  }));
  const asg = (state.lms && state.lms.assignments) || [];
  asg.forEach((a) => items.push({
    kind: 'lms', id: a.id, text: a.title, subject: cleanCourse(a.courseName) || '기타', due: a.due, time: a.dueTime, done: a.submitted, url: a.url, starred: state.starredLms.includes(a.id),
  }));
  return items;
}
function sortByDue(a, b) {
  const da = daysUntil(a.due), db = daysUntil(b.due);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  if (da !== db) return da - db;
  const ta = dueDateTime(a.due, a.time), tb = dueDateTime(b.due, b.time);
  return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
}

function todoRow(it, showSubj) {
  const b = ddayBadge(it.due, it.done, it.time);
  const badge = b ? `<span class="dday ${b.cls}">${b.label}</span>` : '';
  const subj = showSubj && it.subject ? `<span class="subj-chip" title="${escapeHtml(it.subject)}">${escapeHtml(it.subject)}</span>` : '';
  const play = `<span class="play" data-play="${escapeHtml(it.text)}" title="집중 시작">${ICO.play}</span>`;
  if (it.kind === 'lms') {
    const lstar = `<span class="star ${it.starred ? 'on' : ''}" data-star-lms="${escapeHtml(it.id)}" title="중요 표시">${ICO.star}</span>`;
    return `<div class="todo ${it.done ? 'done' : ''}">
      <input type="checkbox" class="check info" disabled ${it.done ? 'checked' : ''} title="LMS 제출 상태"/>
      <span class="lms-badge">LMS</span>
      <span class="todo-text" title="${escapeHtml(it.text)}">${escapeHtml(it.text)}</span>
      ${subj}${badge}${lstar}${play}
      <button class="go" data-open="${escapeHtml(it.url)}">제출</button>
    </div>`;
  }
  const star = `<span class="star ${it.starred ? 'on' : ''}" data-star="${it.id}" title="중요 표시">${ICO.star}</span>`;
  const rep = it.repeat ? `<span class="rep" title="반복 ${it.repeat === 'weekly' ? '매주' : '매일'}">${ICO.repeat}</span>` : '';
  const subs = it.subs || [];
  const subsBadge = subs.length ? `<span class="subs-badge" data-expand="${it.id}" title="하위 항목">${subs.filter((s) => s.done).length}/${subs.length}</span>` : '';
  const addSub = `<span class="play addsub" data-addsub="${it.id}" title="하위 추가">${ICO.plus}</span>`;
  return `<div class="todo ${it.done ? 'done' : ''}">
    <input type="checkbox" class="check" data-toggle="${it.id}" ${it.done ? 'checked' : ''}/>
    <span class="todo-text" data-edit="${it.id}" title="더블클릭해 수정">${escapeHtml(it.text)}</span>
    ${rep}${subj}${subsBadge}${badge}${star}${addSub}${play}
    <span class="x" data-del="${it.id}" title="삭제">${ICO.x}</span>
  </div>`;
}
function subPanel(it) {
  const subs = it.subs || [];
  const rows = subs.map((s, i) => `<div class="sub ${s.done ? 'done' : ''}"><input type="checkbox" class="check sub-check" data-subtoggle="${it.id}:${i}" ${s.done ? 'checked' : ''}/><span class="sub-text">${escapeHtml(s.text)}</span><span class="x" data-subdel="${it.id}:${i}">${ICO.x}</span></div>`).join('');
  return `<div class="subs">${rows}<input type="text" class="sub-input" data-subadd="${it.id}" placeholder="+ 하위 항목 추가" autocomplete="off"/></div>`;
}
function todoBlock(it, showSubj) {
  const expanded = it.kind === 'todo' && state.expandedTodos[it.id];
  return todoRow(it, showSubj) + (expanded ? subPanel(it) : '');
}

function renderTodos() {
  updateDraftChips();
  const today = todayStr();
  const si = $('td-search'); const q = (state.todoSearch || '').trim().toLowerCase();

  // 검색 모드: 활성+완료 전체를 플랫 필터
  if (q) {
    const all = activeItems().concat(state.todos.filter((t) => t.done).map((t) => ({ kind: 'todo', id: t.id, text: t.text, subject: t.subject || null, due: t.due, time: t.dueTime, done: true, starred: !!t.starred, repeat: t.repeat || null, subs: t.subs || [] })));
    const hit = all.filter((i) => (i.text || '').toLowerCase().includes(q) || (i.subject || '').toLowerCase().includes(q));
    $('todo-list').innerHTML = hit.length
      ? `<div class="cat-head"><span class="ico">${ICO.search}</span>검색 결과<span class="cat-count">${hit.length}</span></div>` + hit.sort(sortByDue).map((it) => todoBlock(it, true)).join('')
      : '<div class="empty-note">검색 결과가 없어요.</div>';
    return;
  }

  const active = activeItems().filter((i) => !i.done);

  const todayList = active.filter((i) => i.due === today).sort(sortByDue);
  const upcoming = active.filter((i) => i.due && i.due > today && !i.subject).sort(sortByDue);
  const backlog = active.filter((i) => i.due && i.due < today && !i.subject).sort(sortByDue);

  const subjMap = {};
  active.filter((i) => i.subject).forEach((i) => (subjMap[i.subject] = subjMap[i.subject] || []).push(i));
  const subjNames = Object.keys(subjMap).sort((a, b) => sortByDue(subjMap[a].slice().sort(sortByDue)[0], subjMap[b].slice().sort(sortByDue)[0]));

  let html = '';
  const section = (cls, ico, label, items, showSubj) => {
    if (!items.length) return '';
    return `<div class="cat-head ${cls}"><span class="ico">${ico}</span>${label}<span class="cat-count">${items.length}</span></div>`
      + items.map((it) => todoBlock(it, showSubj)).join('');
  };

  const urgent = active.filter((i) => i.starred || (daysUntil(i.due) !== null && daysUntil(i.due) <= 2)).sort(sortByDue);
  html += section('cat-urgent', ICO.star, '중요 · 임박', urgent, true);
  html += section('cat-today', ICO.sun, '오늘', todayList, true);
  html += section('cat-soon', ICO.calendar, '예정', upcoming, true);

  subjNames.forEach((name) => {
    const items = subjMap[name].slice().sort(sortByDue);
    html += `<div class="cat-head"><span class="subj-dot" style="background:${colorFor(name)}"></span><span class="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="cat-count">${items.length}</span></div>`;
    html += items.map((it) => todoBlock(it, false)).join('');
  });

  html += section('cat-backlog', ICO.inbox, '잔업', backlog, true);

  if (!html) html = '<div class="empty-note">할 일이 없어요. 위에 적고 Enter를 눌러보세요. 완료한 일은 <b>기록</b> 탭에 쌓입니다.</div>';
  $('todo-list').innerHTML = html;
}

function updateDraftChips() {
  const d = state.todoDraft;
  const dueSet = d.due && d.due !== todayStr();
  const dIcon = (!d.due || d.due === todayStr()) ? ICO.sun : ICO.calendar;
  $('chip-date').innerHTML = dIcon + `<span>${escapeHtml(d.due ? dueLabel(d.due) : '오늘')}</span>`;
  $('chip-date').classList.toggle('set', !!dueSet);
  $('chip-subject').innerHTML = ICO.tag + `<span>${escapeHtml(d.subject || '과목 없음')}</span>`;
  $('chip-subject').classList.toggle('set', !!d.subject);
  const rep = d.repeat;
  $('chip-repeat').innerHTML = ICO.repeat + `<span>${rep === 'daily' ? '매일' : rep === 'weekly' ? '매주' : '반복 없음'}</span>`;
  $('chip-repeat').classList.toggle('set', !!rep);
}
function openRepeatPopover(anchor) {
  closePopover();
  popEl = document.createElement('div'); popEl.className = 'popover';
  [['반복 없음', null], ['매일', 'daily'], ['매주', 'weekly']].forEach(([lbl, val]) => {
    const o = document.createElement('div'); o.className = 'opt' + (state.todoDraft.repeat === val ? ' active' : ''); o.textContent = lbl;
    o.onclick = () => { state.todoDraft.repeat = val; closePopover(); updateDraftChips(); };
    popEl.appendChild(o);
  });
  $('app').appendChild(popEl); placePopover(anchor);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}

// 완료 토글 (토스트로 실행취소 제공) — 할 일/달력 어디서든 사용
function toggleTodo(id, checked) {
  const t = state.todos.find((x) => x.id === id);
  if (!t) return;
  t.done = checked; t.doneAt = checked ? Date.now() : null;
  let spawnedId = null;
  if (checked && t.repeat) {
    const nextDue = addDaysStr(t.due || todayStr(), t.repeat === 'weekly' ? 7 : 1);
    spawnedId = uid();
    state.todos.push({ id: spawnedId, text: t.text, subject: t.subject, due: nextDue, done: false, doneAt: null, createdAt: Date.now(), repeat: t.repeat, subs: (t.subs || []).map((s) => ({ text: s.text, done: false })) });
  }
  saveTodos();
  rerenderTodoAreas();
  if (checked) {
    const short = t.text.length > 18 ? t.text.slice(0, 18) + '…' : t.text;
    showToast(`'${short}' 완료`, '실행취소', () => {
      t.done = false; t.doneAt = null;
      if (spawnedId) state.todos = state.todos.filter((x) => x.id !== spawnedId);
      saveTodos(); rerenderTodoAreas();
    });
  }
}
function rerenderTodoAreas() {
  if (currentTab === 'todos') renderTodos();
  if (currentTab === 'schedule') renderCalendar();
  if (currentTab === 'stats') renderStats();
  if (state.mini) renderMini();
  renderSummary();
}

function addTodo() {
  const text = $('td-text').value.trim();
  if (!text) { $('td-text').focus(); return; }
  const d = state.todoDraft;
  state.todos.push({ id: uid(), text, subject: d.subject || null, due: d.due || todayStr(), done: false, doneAt: null, createdAt: Date.now(), repeat: d.repeat || null, subs: [] });
  saveTodos();
  $('td-text').value = '';
  state.todoDraft = { due: todayStr(), subject: null, repeat: null }; // 추가 후 기본값으로 초기화
  renderTodos();
  $('td-text').focus();
}

// ---------- 칩 팝오버 ----------
let popEl = null;
function closePopover() { if (popEl) { popEl.remove(); popEl = null; } document.removeEventListener('mousedown', onDocDown, true); }
function onDocDown(e) { if (popEl && !popEl.contains(e.target) && !e.target.closest('.chip')) closePopover(); }
function placePopover(anchor) {
  const app = $('app'), ar = anchor.getBoundingClientRect(), br = app.getBoundingClientRect();
  let left = ar.left - br.left;
  left = Math.min(left, app.clientWidth - popEl.offsetWidth - 8);
  popEl.style.left = Math.max(8, left) + 'px';
  popEl.style.top = (ar.bottom - br.top + 4) + 'px';
}
function openDatePopover(anchor) {
  closePopover();
  popEl = document.createElement('div'); popEl.className = 'popover';
  const row = document.createElement('div'); row.className = 'prow';
  const opts = [
    [ICO.sun, '오늘', todayStr()],
    [ICO.arrow, '내일', addDaysStr(todayStr(), 1)],
    [ICO.calendar, '모레', addDaysStr(todayStr(), 2)],
    [ICO.moon, '주말', comingWeekend()],
  ];
  opts.forEach(([ic, lbl, val]) => {
    const c = document.createElement('button');
    c.className = 'dchip' + (state.todoDraft.due === val ? ' active' : '');
    c.innerHTML = ic + `<span>${lbl}</span>`;
    c.onclick = () => { state.todoDraft.due = val; closePopover(); updateDraftChips(); };
    row.appendChild(c);
  });
  popEl.appendChild(row);
  const sep = document.createElement('div'); sep.className = 'sep'; popEl.appendChild(sep);
  const di = document.createElement('input'); di.type = 'date'; di.value = state.todoDraft.due || todayStr();
  di.onchange = () => { if (di.value) { state.todoDraft.due = di.value; closePopover(); updateDraftChips(); } };
  popEl.appendChild(di);
  $('app').appendChild(popEl); placePopover(anchor);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
function openSubjectPopover(anchor) {
  closePopover();
  popEl = document.createElement('div'); popEl.className = 'popover';
  const mk = (lbl, val, active) => {
    const o = document.createElement('div'); o.className = 'opt' + (active ? ' active' : ''); o.textContent = lbl;
    o.onclick = () => { state.todoDraft.subject = val; closePopover(); updateDraftChips(); };
    popEl.appendChild(o);
  };
  mk('과목 없음', null, !state.todoDraft.subject);
  allSubjects().forEach((s) => mk(s, s, state.todoDraft.subject === s));
  const sep = document.createElement('div'); sep.className = 'sep'; popEl.appendChild(sep);
  const add = document.createElement('div'); add.className = 'opt'; add.textContent = '+ 과목 직접 추가';
  add.onclick = async () => {
    closePopover();
    const name = await miniPrompt('추가할 과목 이름');
    if (!name) return;
    if (!state.subjects.includes(name)) { state.subjects.push(name); saveSubjects(); }
    state.todoDraft.subject = name; updateDraftChips();
  };
  popEl.appendChild(add);
  $('app').appendChild(popEl); placePopover(anchor);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
function comingWeekend() {
  const d = todayMidnight(); const day = d.getDay();
  let add = (6 - day + 7) % 7; // 다가오는 토요일(오늘이 토요일이면 오늘)
  d.setDate(d.getDate() + add); return fmtD(d);
}

// =====================================================================
// 일정 (월 달력)
// =====================================================================
function renderCalendar() {
  if (!state.calYear) { const n = new Date(); state.calYear = n.getFullYear(); state.calMonth = n.getMonth(); }
  const y = state.calYear, m = state.calMonth;
  $('cal-title').textContent = `${y}년 ${m + 1}월`;

  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const gridStart = new Date(y, m, 1 - startDow);
  const today = todayStr();

  // 그날 마감 할 일/과제 집계 (달력 점 마커)
  const byDay = {};
  activeItems().filter((i) => !i.done && i.due).forEach((i) => {
    const b = byDay[i.due] = byDay[i.due] || { task: 0, lms: 0 };
    if (i.kind === 'lms') b.lms++; else b.task++;
  });

  let html = '<div class="cal-grid">';
  ['일', '월', '화', '수', '목', '금', '토'].forEach((d, i) => {
    html += `<div class="cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`;
  });
  for (let i = 0; i < 42; i++) {
    const cur = new Date(gridStart); cur.setDate(gridStart.getDate() + i);
    const ds = fmtD(cur);
    const inMonth = cur.getMonth() === m;
    const dow = cur.getDay();
    const evs = state.events.filter((ev) => ds >= ev.start && ds <= (ev.end || ev.start));
    let cell = `<div class="cal-cell ${inMonth ? '' : 'other'} ${ds === today ? 'today' : ''} ${ds === state.selectedDay ? 'selected' : ''} ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}" data-day="${ds}">`;
    cell += `<div class="cal-daynum">${cur.getDate()}</div>`;
    evs.slice(0, 2).forEach((ev) => {
      cell += `<div class="cal-ev" style="background:${colorFor(ev.title)}" title="${escapeHtml(ev.title)}">${escapeHtml(ev.title)}</div>`;
    });
    if (evs.length > 2) cell += `<div class="cal-more">+${evs.length - 2}</div>`;
    const dd = byDay[ds];
    if (dd) {
      const total = dd.task + dd.lms; let shown = 0, dots = '';
      for (let k = 0; k < dd.task && shown < 3; k++, shown++) dots += '<span class="cal-dot task"></span>';
      for (let k = 0; k < dd.lms && shown < 3; k++, shown++) dots += '<span class="cal-dot lms"></span>';
      if (total > shown) dots += `<span class="more">+${total - shown}</span>`;
      cell += `<div class="cal-dots">${dots}</div>`;
    }
    cell += '</div>';
    html += cell;
  }
  html += '</div>';
  $('calendar').innerHTML = html;

  if (state.selectedDay) renderDayPanel(state.selectedDay);
  else $('day-panel').classList.add('hidden');
}

function renderDayPanel(ds) {
  state.selectedDay = ds;
  const d = parseDate(ds);
  const evs = state.events.filter((ev) => ds >= ev.start && ds <= (ev.end || ev.start));
  const panel = $('day-panel');
  panel.classList.remove('hidden');
  let html = `<div class="dp-title">${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW_KO[d.getDay()]})</div>`;
  html += evs.length ? evs.map((ev) => {
    const range = ev.end && ev.end !== ev.start ? ` <span class="evt-date">~${ev.end}</span>` : '';
    return `<div class="evt"><div class="evt-body"><div class="evt-title">${escapeHtml(ev.title)}${range}</div>
      <div class="evt-date">${ev.remindDaysBefore ? `${ev.remindDaysBefore}일 전 알림` : '알림 없음'}</div></div>
      <span class="x" data-del-ev="${ev.id}" title="삭제" style="cursor:pointer;color:var(--muted);font-size:15px;">×</span></div>`;
  }).join('') : '<div class="empty-note" style="padding:4px 2px;">이 날 일정이 없어요. 아래에서 추가하세요.</div>';

  // 그날 마감 할 일/과제
  const dayItems = activeItems().filter((i) => i.due === ds && !i.done).sort(sortByDue);
  if (dayItems.length) {
    html += '<div class="dp-sub">할 일 · 과제</div>';
    html += dayItems.map((it) => {
      const b = ddayBadge(it.due, false, it.time);
      const badge = b ? `<span class="dday ${b.cls}">${b.label}</span>` : '';
      if (it.kind === 'lms') {
        return `<div class="dp-task"><span class="lms-badge">LMS</span><span class="t" title="${escapeHtml(it.text)}">${escapeHtml(it.text)}</span>${badge}</div>`;
      }
      return `<div class="dp-task"><input type="checkbox" class="check" data-toggle="${it.id}" ${it.done ? 'checked' : ''}/><span class="t" title="${escapeHtml(it.text)}">${escapeHtml(it.text)}</span>${badge}</div>`;
    }).join('');
  }

  const ed = state.evtDraft.endDate;
  const rem = state.evtDraft.remind;
  const rangeChip = (lbl, val) => `<button class="dchip2 ${((val === 0 && !ed) || (val > 0 && ed === addDaysStr(ds, val))) ? 'sel' : ''}" data-endoff="${val}">${lbl}</button>`;
  const remChip = (lbl, val) => `<button class="dchip2 ${rem === val ? 'sel' : ''}" data-remind="${val}">${lbl}</button>`;
  html += `<div class="dp-add">
    <input type="text" id="dp-title-input" placeholder="일정 제목 (예: 중간고사)" />
    <div class="rowline"><span class="lbl">기간</span>
      ${rangeChip('하루', 0)}${rangeChip('+2일', 2)}${rangeChip('+3일', 3)}${rangeChip('+1주', 7)}
      <button class="dchip2 ${state.pickEndMode ? 'sel' : ''}" data-pickend="1">달력에서 선택</button>
    </div>
    <div class="rowline"><span class="lbl">미리 알림</span>
      ${remChip('없음', 0)}${remChip('1일 전', 1)}${remChip('3일 전', 3)}
      <span style="flex:1"></span>
      <button id="dp-add-btn" class="btn primary mini">추가</button>
    </div>
    ${ed ? `<div class="lbl" style="margin-top:3px;">기간: ${ds} ~ <b style="color:var(--text)">${ed}</b></div>` : ''}
    ${state.pickEndMode ? `<div class="lbl" style="margin-top:3px;color:var(--accent);">달력에서 종료일(더 늦은 날짜)을 눌러주세요…</div>` : ''}
  </div>`;
  panel.innerHTML = html;
}

function addEventOnSelected() {
  const ds = state.selectedDay; if (!ds) return;
  const el = $('dp-title-input'); const title = el ? el.value.trim() : '';
  if (!title) { if (el) el.focus(); return; }
  const end = (state.evtDraft.endDate && state.evtDraft.endDate > ds) ? state.evtDraft.endDate : null;
  const remind = state.evtDraft.remind || 0;
  state.events.push({ id: uid(), title, start: ds, end, remindDaysBefore: remind });
  saveEvents();
  state.evtDraft = { endDate: null, remind: 3 };
  state.pickEndMode = false;
  renderCalendar();
  renderSummary();
}

// =====================================================================
// LMS
// =====================================================================
function fmtSync(ts) {
  if (!ts) return '없음';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function allNotices() {
  const l = state.lms || {};
  return [...(l.courseNotices || []), ...(l.generalNotices || []), ...(l.notices || [])];
}

function renderLms() {
  const st = $('lms-status'), lms = state.lms;
  if (!lms || !lms.courses || !lms.courses.length) st.innerHTML = '아직 데이터가 없습니다. <b>로그인</b> 후 <b>새로고침</b>을 눌러주세요.';
  else if (lms.sessionValid === false) st.innerHTML = '세션이 만료됐어요. <b>로그인</b>을 다시 해주세요.';
  else { const uc = unreadCount(); st.innerHTML = `강좌 <b>${lms.courses.length}</b>개 · 마지막 동기화 <b>${fmtSync(lms.lastSync)}</b>${uc ? ` · <b style="color:var(--accent)">미확인 ${uc}</b>` : ''}`; }

  const box = $('lms-content');
  if (!lms) { box.innerHTML = '<div class="empty-note">LMS 과제·공지·진도가 여기에 표시됩니다.</div>'; return; }

  // 과목별 공지 (지난버전 notices는 전체로 취급)
  const course = (lms.courseNotices || []);
  const general = (lms.generalNotices || (lms.courseNotices ? [] : (lms.notices || [])));

  let html = '';
  html += `<div class="lms-section-title"><span class="ico">${ICO.pin}</span>과목별 공지사항</div>`;
  if (course.length) {
    const byCourse = {};
    course.forEach((n) => (byCourse[cleanCourse(n.courseName)] = byCourse[cleanCourse(n.courseName)] || []).push(n));
    Object.keys(byCourse).forEach((cn) => {
      const open = !!state.lmsOpenCourse[cn];
      html += `<div class="acc-head" data-course="${escapeHtml(cn)}">
        <span class="subj-dot" style="background:${colorFor(cn)}"></span>
        <span class="name" title="${escapeHtml(cn)}">${escapeHtml(cn)}</span>
        ${byCourse[cn].some((n) => !isRead(n.id)) ? '<span class="unread-dot"></span>' : ''}
        <span class="acc-count">${byCourse[cn].length}</span>
        <span class="acc-caret ${open ? 'open' : ''}">${ICO.chevD}</span>
      </div>`;
      if (open) html += `<div class="acc-body">${byCourse[cn].slice(0, 10).map((n) => noticeRow(n, false)).join('')}</div>`;
    });
  } else {
    html += '<div class="empty-note">과목별 공지를 아직 못 찾았어요.</div>';
  }

  // 전체 공지 (접기)
  html += `<div class="lms-section-title gen-toggle" id="gen-toggle" style="cursor:pointer;"><span class="ico">${ICO.mega}</span>전체 공지사항 <span style="font-size:10px;color:var(--muted);font-weight:600;">(${general.length})</span><span class="acc-caret ${state.showGeneral ? 'open' : ''}">${ICO.chevD}</span></div>`;
  if (state.showGeneral) {
    html += general.length ? general.slice(0, 15).map((n) => noticeRow(n, true)).join('') : '<div class="empty-note">전체 공지가 없습니다.</div>';
  }

  box.innerHTML = html;
  updateLmsBadge();
}
function noticeRow(n, showCourse) {
  const cn = cleanCourse(n.courseName);
  const unread = !isRead(n.id);
  return `<div class="notice ${unread ? 'unread' : ''}" data-open="${escapeHtml(n.url)}" data-nid="${escapeHtml(n.id)}">
    <div class="n-head">
      ${unread ? '<span class="unread-dot"></span>' : ''}
      ${showCourse ? `<span class="n-course" title="${escapeHtml(cn)}">${escapeHtml(cn || 'LMS')}</span>` : ''}
      <span class="n-date">${escapeHtml(n.date || '')}</span>
    </div>
    <span class="n-title" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</span>
  </div>`;
}

// 읽음 상태
function isRead(id) { return state.readIds.includes(id); }
function markRead(id) { if (id && !state.readIds.includes(id)) { state.readIds.push(id); if (state.readIds.length > 1000) state.readIds = state.readIds.slice(-800); persist({ readIds: state.readIds }); } }
function unreadCount() { return allNotices().filter((n) => !isRead(n.id)).length; }
function updateLmsBadge() {
  const btn = document.querySelector('.tabs button[data-tab="lms"]'); if (!btn) return;
  const n = unreadCount();
  btn.classList.toggle('has-badge', n > 0);
  btn.setAttribute('data-badge', n > 99 ? '99+' : String(n));
}

async function lmsLogin() {
  $('lms-status').textContent = '로그인 창에서 직접 로그인해주세요…';
  await window.api.lmsLogin();
  await doLmsRefresh(false);
}
async function doLmsRefresh(silent) {
  if (!silent) $('lms-status').textContent = '동기화 중…';
  const res = await window.api.lmsRefresh();
  if (res.needLogin) {
    state.lms = res.lms || Object.assign({}, state.lms, { sessionValid: false });
    if (!silent && currentTab === 'lms') $('lms-status').innerHTML = '로그인이 필요합니다. <b>로그인</b>을 눌러주세요.';
    return;
  }
  if (res.error) { if (!silent) $('lms-status').textContent = '오류: ' + res.error; return; }
  const prevSeen = state.notifyState.seenNotices || [];
  state.lms = res.lms;

  const notices = allNotices();
  if (!prevSeen.length && notices.length) {
    state.notifyState.seenNotices = notices.map((n) => n.id); saveNotifyState();
  } else {
    const fresh = notices.filter((n) => !prevSeen.includes(n.id));
    fresh.slice(0, 5).forEach((n) => window.api.notify('새 공지 · ' + cleanCourse(n.courseName), n.title));
    if (fresh.length) { state.notifyState.seenNotices = [...new Set([...prevSeen, ...notices.map((n) => n.id)])].slice(-400); saveNotifyState(); }
  }
  if (currentTab === 'lms') renderLms();
  if (currentTab === 'todos') renderTodos();
  updateLmsBadge();
}

// =====================================================================
// 기록 (완료 통계)
// =====================================================================
function renderStats() {
  const today = todayStr();
  const done = state.todos.filter((t) => t.done && t.doneAt);
  const total = done.length;
  const doneDates = new Set(done.map((t) => fmtD(new Date(t.doneAt))));

  // 이번 주(월요일 기준)
  const ws = todayMidnight(); ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
  const wsStr = fmtD(ws);
  const week = done.filter((t) => fmtD(new Date(t.doneAt)) >= wsStr).length;

  // 연속 달성
  let streak = 0; const d = todayMidnight();
  if (!doneDates.has(fmtD(d))) d.setDate(d.getDate() - 1);
  while (doneDates.has(fmtD(d))) { streak++; d.setDate(d.getDate() - 1); }

  const submitted = ((state.lms && state.lms.assignments) || []).filter((a) => a.submitted).length;

  let html = `<div class="stat-hero">
    <div class="stat-card"><div class="stat-num accent">${week}</div><div class="stat-label">이번 주 완료</div></div>
    <div class="stat-card"><div class="stat-num ok">${total}</div><div class="stat-label">누적 완료</div></div>
    <div class="stat-card"><div class="stat-num warn">${streak}</div><div class="stat-label">연속 달성(일)</div></div>
  </div>`;

  // 공부 시간(집중 타이머 누적)
  const fmin = (arr) => arr.reduce((s, x) => s + (x.minutes || 0), 0);
  const fsess = (state.focus && state.focus.sessions) || [];
  const hm = (m) => { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}시간 ${mm}분` : `${mm}분`; };
  const todayF = fmin(fsess.filter((s) => s.date === today));
  const weekF = fmin(fsess.filter((s) => s.date >= wsStr));
  html += `<div class="study-line">${ICO.clock} 공부시간 — 오늘 <b>${hm(todayF)}</b> <span class="sum-sep">·</span> 이번 주 <b>${hm(weekF)}</b></div>`;

  // 완료 잔디(히트맵) — 최근 12주
  html += `<div class="sec-head first">완료 잔디 (최근 12주)</div>` + heatmapHtml(done);

  if (!total) {
    html += '<div class="empty-note">아직 완료한 할 일이 없어요. 하나씩 체크하면 여기에 기록이 쌓이고, 얼마나 열심히 했는지 보여드릴게요. 💪</div>';
    if (submitted) html += `<div class="empty-note">LMS 제출 완료 과제: <b>${submitted}</b>개</div>`;
    $('stats-content').innerHTML = html;
    return;
  }

  // 과목별 완료
  const bySubj = {};
  done.forEach((t) => { const k = t.subject || '기타'; bySubj[k] = (bySubj[k] || 0) + 1; });
  const names = Object.keys(bySubj).sort((a, b) => bySubj[b] - bySubj[a]);
  const max = Math.max(...names.map((n) => bySubj[n]));
  html += `<div class="sec-head first">과목별 완료</div>`;
  html += names.map((n) => `<div class="stat-bar-row">
    <span class="stat-bar-name" title="${escapeHtml(n)}">${escapeHtml(n)}</span>
    <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.round(bySubj[n] / max * 100)}%;background:${colorFor(n)}"></span></span>
    <span class="stat-bar-val">${bySubj[n]}</span>
  </div>`).join('');

  // 최근 완료
  const recent = done.slice().sort((a, b) => b.doneAt - a.doneAt).slice(0, 10);
  html += `<div class="sec-head" style="margin-top:12px;">최근 완료</div>`;
  html += recent.map((t) => {
    const dd = new Date(t.doneAt);
    return `<div class="done-item"><span class="di-check">${ICO.check}</span>
      <span class="di-text" title="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span>
      <span class="di-date">${dd.getMonth() + 1}/${dd.getDate()}</span>
      <span class="di-undo" data-undo="${t.id}" title="되돌리기">${ICO.undo}</span></div>`;
  }).join('');

  if (submitted) html += `<div class="empty-note" style="margin-top:10px;">여기에 더해 LMS 제출 완료 과제도 <b>${submitted}</b>개! 잘하고 있어요. 🎉</div>`;

  $('stats-content').innerHTML = html;
}

// 완료 잔디 히트맵 (최근 12주)
function heatmapHtml(done) {
  const counts = {};
  done.forEach((t) => { const d = fmtD(new Date(t.doneAt)); counts[d] = (counts[d] || 0) + 1; });
  const end = todayMidnight();
  const start = new Date(end); start.setDate(start.getDate() - end.getDay() - 11 * 7); // 12주, 일요일 정렬
  const today = todayStr();
  let cols = '';
  for (let w = 0; w < 12; w++) {
    let cells = '';
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start); cur.setDate(start.getDate() + w * 7 + d);
      const ds = fmtD(cur);
      if (ds > today) { cells += '<div class="heat-cell empty"></div>'; continue; }
      const c = counts[ds] || 0;
      const lv = c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : 3;
      cells += `<div class="heat-cell l${lv}" title="${ds} · ${c}개"></div>`;
    }
    cols += `<div class="heat-col">${cells}</div>`;
  }
  return `<div class="heat-scroll"><div class="heat">${cols}</div></div>`;
}

// =====================================================================
// 출석 (주차별 수동 관리)
// =====================================================================
const ATT_WEEKS = 15;
function attSubjects() { return [...new Set(state.timetableSubjects)]; }
function attStartMonday() {
  const s = parseDate(state.attendance.semesterStart);
  if (!s) return null;
  const m = new Date(s); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); // 그 주 월요일
  return m;
}
function subjectDays(subj) {
  const s = (state.timetableFull || []).find((x) => x.name === subj);
  if (!s) return [];
  return [...new Set((s.times || []).map((t) => t.day))].sort((a, b) => a - b);
}
function classDateStr(week, day) {
  const mon = attStartMonday(); if (!mon) return null;
  const d = new Date(mon); d.setDate(d.getDate() + (week - 1) * 7 + day);
  return fmtD(d);
}
function defaultAtt(subj, week) {
  const days = subjectDays(subj); if (!days.length) return '';
  const cd = classDateStr(week, days[0]); if (!cd) return '';
  return cd <= todayStr() ? '출석' : '';
}
function effectiveAtt(subj, week) {
  const ov = state.attendance.overrides[subj] || {};
  return ov[week] !== undefined ? ov[week] : defaultAtt(subj, week);
}
function cycleAtt(subj, week) {
  const ov = state.attendance.overrides;
  ov[subj] = ov[subj] || {};
  const order = ATT_STATES;
  const cur = ov[subj][week];
  let next;
  if (cur === undefined) {
    const di = order.indexOf(defaultAtt(subj, week)); // '출석'→0, ''→-1
    next = order[(di + 1) % order.length];
  } else {
    const ci = order.indexOf(cur);
    next = ci >= order.length - 1 ? '__clear__' : order[ci + 1];
  }
  if (next === '__clear__') delete ov[subj][week]; else ov[subj][week] = next;
  persist({ attendance: state.attendance });
  renderAttendance();
}
function renderAttendance() {
  const box = $('att-grid'); if (!box) return;
  const si = $('att-start'); if (si) si.value = state.attendance.semesterStart || '';
  const subs = attSubjects();
  if (!subs.length) { box.innerHTML = '<div class="empty-note">시간표를 먼저 등록하면 과목별 출석표가 만들어져요.<br/>(시간표 탭 → 공유 링크 등록)</div>'; return; }
  if (!state.attendance.semesterStart) { box.innerHTML = '<div class="empty-note">위에서 <b>개강일</b>을 한 번 정해주세요.<br/>지난 수업은 자동 출석으로 채워지고, 결석/지각/공결/병결은 칸을 눌러 바꾸면 됩니다.</div>'; return; }
  let head = '<tr><th class="att-name-h">과목</th>';
  for (let w = 1; w <= ATT_WEEKS; w++) head += `<th>${w}</th>`;
  head += '<th class="att-sum-h">결석</th></tr>';
  let rows = '';
  subs.forEach((subj) => {
    let absent = 0, cells = '';
    for (let w = 1; w <= ATT_WEEKS; w++) {
      const stt = effectiveAtt(subj, w);
      if (stt === '결석') absent++;
      cells += `<td><div class="att-cell ${stt ? ATT_CLASS[stt] : ''}" data-subj="${escapeHtml(subj)}" data-week="${w}" title="${w}주차 ${stt || '수업 전'}">${stt ? stt[0] : ''}</div></td>`;
    }
    rows += `<tr><td class="att-name" title="${escapeHtml(subj)}">${escapeHtml(subj)}</td>${cells}<td class="att-sum ${absent >= 3 ? 'warn' : ''}">${absent}</td></tr>`;
  });
  box.innerHTML = `<div class="att-legend">눌러서 변경 · <span class="lg ok">출</span>석 <span class="lg danger">결</span>석 <span class="lg warn">지</span>각 <span class="lg info">공</span>결 <span class="lg mut">병</span>결</div><div class="att-scroll"><table class="att-table">${head}${rows}</table></div>`;
}

// =====================================================================
// 알림 스케줄러
// =====================================================================
function fired(key) { return state.notifyState.firedIds.includes(key); }
function markFired(key) {
  state.notifyState.firedIds.push(key);
  if (state.notifyState.firedIds.length > 500) state.notifyState.firedIds = state.notifyState.firedIds.slice(-400);
  saveNotifyState();
}
function checkNotifications() {
  const today = todayStr();
  // 아침 요약: 설정된 시각(기본 08시) 이후, 하루 1회
  if (state.notifyState.lastSummaryDate !== today && new Date().getHours() >= (state.notifyPrefs.morningHour || 0)) {
    buildMorningSummary();
    state.notifyState.lastSummaryDate = today; saveNotifyState();
  }
  state.events.forEach((ev) => {
    const d = daysUntil(ev.start); if (d === null) return;
    const key = `ev:${ev.id}:${today}`;
    if (d >= 0 && d <= (ev.remindDaysBefore || 0) && !fired(key)) {
      window.api.notify('일정 알림', `${ev.title} — ${d === 0 ? '오늘' : 'D-' + d}`); markFired(key);
    }
  });
  if (state.notifyPrefs.deadlineAlerts === false) return;
  activeItems().filter((i) => !i.done && i.due).forEach((it) => {
    const d = daysUntil(it.due);
    const key = `${it.kind}:${it.id}:${today}`;
    if (d !== null && d <= 0 && !fired(key)) {
      const where = it.subject ? `[${it.subject}] ` : '';
      window.api.notify(it.kind === 'lms' ? '과제 마감' : '할 일 마감', `${where}${it.text} — ${d === 0 ? '오늘 마감' : '기한 지남'}`);
      markFired(key);
    }
  });
}
function buildMorningSummary() {
  const parts = [];
  const todayEvents = state.events.filter((ev) => {
    const s = daysUntil(ev.start), e = ev.end ? daysUntil(ev.end) : null;
    return s !== null && s <= 0 && (e === null ? s === 0 : e >= 0);
  });
  const dueToday = activeItems().filter((i) => !i.done && daysUntil(i.due) !== null && daysUntil(i.due) <= 0);
  if (todayEvents.length) parts.push(`오늘 일정 ${todayEvents.length}건`);
  if (dueToday.length) parts.push(`마감·지난 할 일 ${dueToday.length}건`);
  window.api.notify('오늘 요약', parts.length ? parts.join(' · ') : '오늘 마감/일정 없음. 좋은 하루!');
}

let lastTickDate = todayStr();
function tick() {
  checkNotifications();
  const changed = todayStr() !== lastTickDate;
  lastTickDate = todayStr();
  if (currentTab === 'todos' || currentTab === 'lms') reRenderDynamic();
  else if (changed && (currentTab === 'schedule' || currentTab === 'stats')) reRenderDynamic();
  renderSummary();
}
function reRenderDynamic() {
  const v = $('view-' + currentTab); const top = v ? v.scrollTop : 0;
  if (currentTab === 'todos') renderTodos();
  else if (currentTab === 'schedule') renderCalendar();
  else if (currentTab === 'lms') renderLms();
  else if (currentTab === 'stats') renderStats();
  if (v) v.scrollTop = top;
}

// =====================================================================
// 이벤트 바인딩
// =====================================================================
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
$('btn-refresh').onclick = () => loadTimetable(state.identifier);
$('btn-settings').onclick = openSettings;
$('btn-setup').onclick = openSettings;
$('btn-min').onclick = () => window.api.minimize();
$('btn-mini').onclick = toggleMini;
$('btn-close').onclick = () => window.api.close();
$('mini-list').addEventListener('change', (e) => { const t = e.target.closest('[data-toggle]'); if (t) toggleTodo(t.dataset.toggle, t.checked); });
$('mini-list').addEventListener('click', (e) => {
  const play = e.target.closest('[data-play]'); if (play) { startFocus(play.dataset.play); return; }
  const star = e.target.closest('[data-star]'); if (star) { const t = state.todos.find((x) => x.id === star.dataset.star); if (t) { t.starred = !t.starred; saveTodos(); renderMini(); } return; }
  const open = e.target.closest('[data-open]'); if (open) window.api.lmsOpen(open.dataset.open);
});

$('td-add').onclick = addTodo;
$('td-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodo(); });
$('chip-date').onclick = () => openDatePopover($('chip-date'));
$('chip-subject').onclick = () => openSubjectPopover($('chip-subject'));
$('chip-repeat').onclick = () => openRepeatPopover($('chip-repeat'));
$('td-search').addEventListener('input', () => { state.todoSearch = $('td-search').value; renderTodos(); });

$('cal-prev').onclick = () => { if (--state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderCalendar(); };
$('cal-next').onclick = () => { if (++state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderCalendar(); };
$('cal-today').onclick = () => { const n = new Date(); state.calYear = n.getFullYear(); state.calMonth = n.getMonth(); state.selectedDay = todayStr(); renderCalendar(); };

$('lms-login').onclick = lmsLogin;
$('lms-refresh').onclick = () => doLmsRefresh(false);
$('lms-readall').onclick = () => {
  allNotices().forEach((n) => { if (!state.readIds.includes(n.id)) state.readIds.push(n.id); });
  persist({ readIds: state.readIds }); renderLms(); updateLmsBadge();
};

$('summary').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tm]'); if (!b) return;
  if (b.dataset.tm === 'pause') pauseTimer();
  else if (b.dataset.tm === 'stop') stopTimer();
});

// 위임 클릭
$('todo-list').addEventListener('click', (e) => {
  const expand = e.target.closest('[data-expand]');
  const addsub = e.target.closest('[data-addsub]');
  const subdel = e.target.closest('[data-subdel]');
  const play = e.target.closest('[data-play]');
  const star = e.target.closest('[data-star]');
  const starLms = e.target.closest('[data-star-lms]');
  const del = e.target.closest('[data-del]'); const open = e.target.closest('[data-open]');
  if (subdel) { const [id, i] = subdel.dataset.subdel.split(':'); const t = state.todos.find((x) => x.id === id); if (t && t.subs) { t.subs.splice(+i, 1); saveTodos(); renderTodos(); } return; }
  if (expand) { state.expandedTodos[expand.dataset.expand] = !state.expandedTodos[expand.dataset.expand]; renderTodos(); return; }
  if (addsub) { state.expandedTodos[addsub.dataset.addsub] = true; renderTodos(); const inp = document.querySelector(`[data-subadd="${addsub.dataset.addsub}"]`); if (inp) inp.focus(); return; }
  if (star) { const t = state.todos.find((x) => x.id === star.dataset.star); if (t) { t.starred = !t.starred; saveTodos(); renderTodos(); } return; }
  if (starLms) { const id = starLms.dataset.starLms; const i = state.starredLms.indexOf(id); if (i >= 0) state.starredLms.splice(i, 1); else state.starredLms.push(id); persist({ starredLms: state.starredLms }); renderTodos(); return; }
  if (play) { startFocus(play.dataset.play); return; }
  if (del) { state.todos = state.todos.filter((t) => t.id !== del.dataset.del); saveTodos(); renderTodos(); renderSummary(); return; }
  if (open) { window.api.lmsOpen(open.dataset.open); return; }
});
$('todo-list').addEventListener('change', (e) => {
  const sub = e.target.closest('[data-subtoggle]');
  if (sub) { const [id, i] = sub.dataset.subtoggle.split(':'); const t = state.todos.find((x) => x.id === id); if (t && t.subs && t.subs[+i]) { t.subs[+i].done = sub.checked; saveTodos(); renderTodos(); } return; }
  const tog = e.target.closest('[data-toggle]'); if (tog) toggleTodo(tog.dataset.toggle, tog.checked);
});
$('todo-list').addEventListener('keydown', (e) => {
  const add = e.target.closest('[data-subadd]');
  if (add && e.key === 'Enter') {
    const v = add.value.trim(); if (!v) return;
    const t = state.todos.find((x) => x.id === add.dataset.subadd);
    if (t) { t.subs = t.subs || []; t.subs.push({ text: v, done: false }); saveTodos(); renderTodos(); const inp = document.querySelector(`[data-subadd="${add.dataset.subadd}"]`); if (inp) inp.focus(); }
  }
});
$('todo-list').addEventListener('dblclick', (e) => {
  const ed = e.target.closest('[data-edit]'); if (!ed) return;
  const t = state.todos.find((x) => x.id === ed.dataset.edit); if (!t) return;
  const cur = t.text;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'edit-input'; inp.value = cur;
  ed.replaceWith(inp); inp.focus(); inp.select();
  const commit = (save) => { if (save) { const v = inp.value.trim(); if (v) { t.text = v; saveTodos(); } } renderTodos(); };
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(true); if (ev.key === 'Escape') commit(false); });
  inp.addEventListener('blur', () => commit(true));
});
$('calendar').addEventListener('click', (e) => {
  const cell = e.target.closest('[data-day]'); if (!cell) return;
  const day = cell.dataset.day;
  if (state.pickEndMode && state.selectedDay && day > state.selectedDay) {
    state.evtDraft.endDate = day; state.pickEndMode = false;
    renderDayPanel(state.selectedDay); renderCalendar(); return;
  }
  state.evtDraft = { endDate: null, remind: state.evtDraft.remind };
  state.pickEndMode = false;
  renderDayPanel(day); renderCalendar();
});
$('day-panel').addEventListener('click', (e) => {
  if (e.target.closest('#dp-add-btn')) { addEventOnSelected(); return; }
  const eo = e.target.closest('[data-endoff]');
  if (eo) { const v = +eo.dataset.endoff; state.evtDraft.endDate = v > 0 ? addDaysStr(state.selectedDay, v) : null; state.pickEndMode = false; renderDayPanel(state.selectedDay); return; }
  const rm = e.target.closest('[data-remind]');
  if (rm) { state.evtDraft.remind = +rm.dataset.remind; renderDayPanel(state.selectedDay); return; }
  if (e.target.closest('[data-pickend]')) { state.pickEndMode = true; renderDayPanel(state.selectedDay); renderCalendar(); return; }
  const del = e.target.closest('[data-del-ev]');
  if (del) { state.events = state.events.filter((ev) => ev.id !== del.dataset.delEv); saveEvents(); renderCalendar(); renderSummary(); }
});
$('day-panel').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'dp-title-input') addEventOnSelected(); });
$('day-panel').addEventListener('change', (e) => {
  const tog = e.target.closest('[data-toggle]'); if (tog) toggleTodo(tog.dataset.toggle, tog.checked);
});
$('lms-content').addEventListener('click', (e) => {
  const acc = e.target.closest('[data-course]');
  if (acc) { const cn = acc.dataset.course; state.lmsOpenCourse[cn] = !state.lmsOpenCourse[cn]; renderLms(); return; }
  if (e.target.closest('#gen-toggle')) { state.showGeneral = !state.showGeneral; renderLms(); return; }
  const notice = e.target.closest('.notice');
  if (notice) { markRead(notice.dataset.nid); window.api.lmsOpen(notice.dataset.open); renderLms(); return; }
  const open = e.target.closest('[data-open]'); if (open) window.api.lmsOpen(open.dataset.open);
});
$('stats-content').addEventListener('click', (e) => {
  const u = e.target.closest('[data-undo]'); if (!u) return;
  const t = state.todos.find((x) => x.id === u.dataset.undo);
  if (t) { t.done = false; t.doneAt = null; saveTodos(); renderStats(); }
});
$('att-grid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-subj]'); if (c) cycleAtt(c.dataset.subj, +c.dataset.week);
});
$('att-start').addEventListener('change', () => {
  state.attendance.semesterStart = $('att-start').value || '';
  persist({ attendance: state.attendance });
  renderAttendance();
});

// ---------- 설정 ----------
function openSettings() { $('inp-id').value = state.identifier || ''; $('settings-err').textContent = ''; $('settings').classList.remove('hidden'); }
$('btn-cancel').onclick = () => { $('settings-err').textContent = ''; $('settings').classList.add('hidden'); };
$('btn-save').onclick = async () => {
  const raw = $('inp-id').value.trim();
  if (!raw) { $('settings-err').textContent = '공유 링크 또는 식별자를 입력하세요.'; return; }
  $('settings-err').textContent = '';
  const res = await window.api.fetchTimetable(raw);
  if (res.ok) { state.identifier = raw; persist({ identifier: raw }); renderTimetable(res.subjects); $('settings').classList.add('hidden'); switchTab('timetable'); }
  else $('settings-err').textContent = res.error;
};
$('inp-opacity').oninput = () => { window.api.setOpacity($('inp-opacity').value / 100); persist({ opacity: Number($('inp-opacity').value) }); };
$('inp-top').onchange = () => { window.api.setAlwaysOnTop($('inp-top').checked); persist({ alwaysOnTop: $('inp-top').checked }); };
$('inp-lms-auto').onchange = () => { state.lmsAuto = $('inp-lms-auto').checked; persist({ lmsAuto: state.lmsAuto }); };
$('inp-morning').onchange = () => { const h = parseInt(($('inp-morning').value || '8').split(':')[0], 10); state.notifyPrefs.morningHour = isNaN(h) ? 8 : h; persist({ notifyPrefs: state.notifyPrefs }); };
$('inp-deadline').onchange = () => { state.notifyPrefs.deadlineAlerts = $('inp-deadline').checked; persist({ notifyPrefs: state.notifyPrefs }); };

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const dk = $('theme-dark'), lt = $('theme-light');
  if (dk && lt) { dk.classList.toggle('sel', state.theme === 'dark'); lt.classList.toggle('sel', state.theme === 'light'); }
}
function setTheme(t) { state.theme = t; persist({ theme: t }); applyTheme(); }
$('theme-dark').onclick = () => setTheme('dark');
$('theme-light').onclick = () => setTheme('light');
$('btn-lms-dump').onclick = async () => {
  $('lms-dump-msg').textContent = '저장 중…';
  const r = await window.api.lmsDump();
  $('lms-dump-msg').textContent = r && r.dir ? `저장됨: ${r.dir}` : ('오류: ' + (r && r.error || '실패'));
};

// ---------- 미니 프롬프트 ----------
function miniPrompt(title) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:absolute;inset:0;z-index:30;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
    ov.innerHTML = `<div style="background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:16px;width:80%;max-width:280px;">
      <div style="font-size:12px;margin-bottom:8px;">${escapeHtml(title)}</div>
      <input type="text" id="mp-in" style="width:100%;margin-bottom:10px;" />
      <div style="display:flex;gap:8px;"><button class="btn" id="mp-cancel" style="flex:1;">취소</button><button class="btn primary" id="mp-ok" style="flex:1;">확인</button></div>
    </div>`;
    $('app').appendChild(ov);
    const inp = ov.querySelector('#mp-in'); inp.focus();
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector('#mp-cancel').onclick = () => done(null);
    ov.querySelector('#mp-ok').onclick = () => done(inp.value.trim() || null);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); });
  });
}

// =====================================================================
// 초기화
// =====================================================================
(async () => {
  const cfg = await window.api.loadConfig();
  if (cfg.opacity) { $('inp-opacity').value = cfg.opacity; window.api.setOpacity(cfg.opacity / 100); }
  if (typeof cfg.alwaysOnTop === 'boolean') { $('inp-top').checked = cfg.alwaysOnTop; window.api.setAlwaysOnTop(cfg.alwaysOnTop); }
  state.subjects = cfg.subjects || [];
  state.todos = cfg.todos || [];
  state.events = cfg.events || [];
  state.lms = cfg.lms || null;
  state.notifyState = Object.assign({ lastSummaryDate: '', firedIds: [], seenNotices: [] }, cfg.notifyState || {});
  state.lmsAuto = cfg.lmsAuto !== false;
  $('inp-lms-auto').checked = state.lmsAuto;
  state.theme = cfg.theme === 'light' ? 'light' : 'dark';
  applyTheme();
  state.focus = cfg.focus && Array.isArray(cfg.focus.sessions) ? cfg.focus : { sessions: [] };
  state.attendance = cfg.attendance && typeof cfg.attendance === 'object' ? { semesterStart: cfg.attendance.semesterStart || '', overrides: cfg.attendance.overrides || {} } : { semesterStart: '', overrides: {} };
  state.readIds = Array.isArray(cfg.readIds) ? cfg.readIds : [];
  state.starredLms = Array.isArray(cfg.starredLms) ? cfg.starredLms : [];
  state.notifyPrefs = Object.assign({ morningHour: 8, deadlineAlerts: true }, cfg.notifyPrefs || {});
  $('inp-morning').value = String(state.notifyPrefs.morningHour).padStart(2, '0') + ':00';
  $('inp-deadline').checked = state.notifyPrefs.deadlineAlerts !== false;
  state.todoDraft = { due: todayStr(), subject: null, repeat: null };
  renderSummary();
  updateLmsBadge();

  if (cfg.identifier) { state.identifier = cfg.identifier; loadTimetable(cfg.identifier); }
  else showTimetableState('empty');

  if (state.lms && state.lms.courses && state.lms.courses.length) {
    window.api.lmsStatus().then((s) => { if (s && s.valid) doLmsRefresh(true); });
  }

  setTimeout(tick, 2500);
  setInterval(tick, 60 * 1000);
  setInterval(() => { if (state.lmsAuto) doLmsRefresh(true); }, 3 * 60 * 60 * 1000);

  // LMS 세션 킵얼라이브: 10분마다 로그인 페이지를 살짝 불러와 서버 활동 갱신(+쿠키 영구화).
  // 위젯이 켜져 있는 한 idle 타임아웃으로 세션이 끊기지 않는다. 끊겼으면 1회 알림.
  setInterval(async () => {
    if (!(state.lms && state.lms.courses && state.lms.courses.length)) return;
    if (state.lms.sessionValid === false) return;
    const s = await window.api.lmsStatus();
    if (s && !s.valid) {
      state.lms.sessionValid = false;
      persist({ lms: state.lms });
      window.api.notify('LMS 로그인 필요', 'LMS 세션이 만료됐어요. LMS 탭에서 다시 로그인해주세요.');
      if (currentTab === 'lms') renderLms();
    }
  }, 10 * 60 * 1000);
})();
