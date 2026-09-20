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
  rolloverOverdue: true,  // 지난 미완료 할 일을 오늘로 자동 이월
  lmsDone: {},        // 제출 완료된 LMS 과제 기록 { id: {title, courseName, doneAt} }
  materialsDone: {},  // 다운로드한 수업 자료 { url: {course, title, path, at, sig, checkedAt} }
  assignDone: {},     // 다운로드한 제출 과제 파일 { url: {...} }
  newMaterials: [],   // 최근 받은 자료(확인 전까지 유지) [{course, title, at}]
  autoDownload: true, // 새 수업 자료 자동 다운로드
  subAddOpen: null,   // 하위 항목 입력이 열린 todo id (인메모리)
  matCourses: {},     // 과목별 자료 자동 다운로드 { [courseId]: false } = 제외 (기본 전부 켜짐)
  statsOpenSubj: {},  // 기록 탭 과목별 완료 펼침 상태 (인메모리)
  clockFormat: 'hms', // 헤더 시계 형식 'h' | 'hm' | 'hms'
  focusGoalMin: 120,  // 하루 집중 목표(분) — 집중 화면 링 게이지 기준
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
    const task = t.taskText && t.taskText.length > 12 ? t.taskText.slice(0, 12) + '…' : (t.taskText || '집중');
    right = `<span class="tm ${t.running ? '' : 'paused'}"><span class="tm-time">⏱ ${fmtClock(t.elapsed || 0)}</span>`
      + `<span class="tm-task" title="${escapeHtml(t.taskText || '')}">${escapeHtml(task)}</span>`
      + `<button class="tm-btn" data-tm="pause" title="${t.running ? '일시정지' : '계속'}">${t.running ? ICO.pause : ICO.play}</button>`
      + `<button class="tm-btn" data-tm="stop" title="정지">${ICO.stop}</button></span>`;
  } else {
    right = `<button class="tm-start" data-tm="start" title="집중 타이머 시작">${ICO.clock}<span>집중</span></button>`;
  }
  bar.innerHTML = `<div class="sum-left">${left}</div><div class="sum-right">${right}</div>`;
}

// ---------- 헤더 시계 ----------
function updateClock() {
  const el = $('term'); if (!el) return;
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  el.textContent = state.clockFormat === 'h' ? `${hh}시` : state.clockFormat === 'hm' ? `${hh}:${mm}` : `${hh}:${mm}:${ss}`;
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

// ---------- 집중 타이머 (카운트업 스톱워치) ----------
function fmtClock(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; }
function startFocus(taskText, subject) {
  stopTimer(true);
  state.timer = { taskText: taskText || '집중', subject: subject || null, elapsed: 0, running: true, intervalId: null };
  state.timer.intervalId = setInterval(timerTick, 1000);
  enterFocus();  // 전용 전체화면으로 진입
  renderSummary();
}
function timerTick() {
  const t = state.timer; if (!t || !t.running) return;
  t.elapsed = (t.elapsed || 0) + 1;  // 0초부터 올라감
  const fv = $('focus-view');
  if (fv && !fv.classList.contains('hidden')) renderFocus();
  renderSummary();
}
function pauseTimer() { const t = state.timer; if (!t) return; t.running = !t.running; renderSummary(); }
function stopTimer(silent) {
  const t = state.timer; if (!t) { if (!silent) renderSummary(); return; }
  clearInterval(t.intervalId);
  if ((t.elapsed || 0) >= 60) logFocus(t.taskText, t.subject, Math.round(t.elapsed / 60));
  state.timer = null;
  exitFocus();
  if (!silent) { renderSummary(); if (currentTab === 'stats') renderStats(); }
}

// ---------- 집중 전용 전체화면 (B 링 · 오늘 누적) ----------
function fmtHMS(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
// 오늘 그 과목(작업)에 쌓은 총 공부시간(초) = 오늘 세션 합 + 진행 중 elapsed
function todayFocusSec(subject) {
  const today = todayStr();
  const key = subject || null;
  let sec = ((state.focus && state.focus.sessions) || [])
    .filter((s) => s.date === today && (s.subject || null) === key)
    .reduce((a, s) => a + (s.minutes || 0) * 60, 0);
  const t = state.timer;
  if (t && (t.subject || null) === key) sec += (t.elapsed || 0);
  return sec;
}
function enterFocus() { const fv = $('focus-view'); if (fv) { fv.classList.remove('hidden'); renderFocus(); } }
function exitFocus() { const fv = $('focus-view'); if (fv) fv.classList.add('hidden'); }
function renderFocus() {
  const fv = $('focus-view'); if (!fv) return;
  const t = state.timer; if (!t) { fv.classList.add('hidden'); return; }
  const subj = t.subject || null;
  const cum = todayFocusSec(subj);
  const goalSec = Math.max(1, (state.focusGoalMin || 120) * 60);
  const frac = Math.max(0, Math.min(1, cum / goalSec));
  const R = 86, C = 2 * Math.PI * R, off = C * (1 - frac);
  const goalMin = state.focusGoalMin || 120;
  const goalLabel = goalMin % 60 === 0 ? `${goalMin / 60}시간` : `${goalMin}분`;
  const cumMin = Math.round(cum / 60);
  fv.innerHTML = `
    <div class="fv-top"><button class="fv-back" id="fv-back">${ICO.chevL}<span>나가기</span></button></div>
    <div class="fv-center">
      <span class="fv-subj">${escapeHtml(subj || '집중')}</span>
      <div class="fv-ring">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--line2)" stroke-width="8"/>
          <circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 100 100)"/>
        </svg>
        <div class="fv-time-wrap"><div class="fv-time">${fmtHMS(cum)}</div><span class="fv-sub">오늘 누적</span></div>
      </div>
      <span class="fv-task" title="${escapeHtml(t.taskText || '')}">${escapeHtml(t.taskText || '')}</span>
    </div>
    <div class="fv-controls">
      <button class="fv-btn" id="fv-pause" title="${t.running ? '일시정지' : '계속'}">${t.running ? ICO.pause : ICO.play}</button>
      <button class="fv-btn danger" id="fv-stop" title="정지">${ICO.stop}</button>
    </div>
    <div class="fv-foot">오늘 이 과목 <b>${cumMin >= 60 ? `${Math.floor(cumMin / 60)}시간 ${cumMin % 60}분` : `${cumMin}분`}</b> <span class="sum-sep">·</span> 목표 ${goalLabel}</div>`;
}
function logFocus(task, subject, minutes) {
  if (!minutes) return;
  state.focus.sessions.push({ date: todayStr(), minutes, task: task || '', subject: subject || null });
  if (state.focus.sessions.length > 2000) state.focus.sessions = state.focus.sessions.slice(-1500);
  persist({ focus: state.focus });
  if (currentTab === 'stats') renderStats();
}
// 과목을 골라 (또는 과목 없이) 스톱워치를 시작하는 팝오버
function openTimerStart(anchor) {
  closePopover();
  popEl = document.createElement('div'); popEl.className = 'popover';
  const mk = (lbl, subj) => { const o = document.createElement('div'); o.className = 'opt'; o.textContent = lbl; o.onclick = () => { closePopover(); startFocus(subj || '집중', subj || null); }; popEl.appendChild(o); };
  mk('과목 없이 집중', null);
  const subs = allSubjects();
  if (subs.length) { const sep = document.createElement('div'); sep.className = 'sep'; popEl.appendChild(sep); subs.forEach((s) => mk(s, s)); }
  $('app').appendChild(popEl); placePopover(anchor);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
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
  if (days < 0) return { label: `지남 ${-days}일`, cls: 'over' };
  // 실제 마감 시각 기준으로 24시간 미만이면 '시간/분 남음'(날짜상 내일이어도)
  const due = dueDateTime(dateStr, timeStr);
  const ms = due ? due - Date.now() : null;
  if (ms !== null) {
    if (ms <= 0) return { label: '마감 지남', cls: 'over' };
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return { label: `${mins}분 남음`, cls: 'today' };
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) { const rem = mins % 60; return { label: rem ? `${hrs}시간 ${rem}분 남음` : `${hrs}시간 남음`, cls: 'today' }; }
  }
  return { label: `D-${days}`, cls: days <= 3 ? 'soon' : '' };
}
// 한국 공휴일 (고정 + 음력/대체 2025~2027)
const FIXED_HOLIDAYS = { '01-01': '신정', '03-01': '삼일절', '05-05': '어린이날', '06-06': '현충일', '08-15': '광복절', '10-03': '개천절', '10-09': '한글날', '12-25': '크리스마스' };
const LUNAR_HOLIDAYS = {
  '2025-01-28': '설날', '2025-01-29': '설날', '2025-01-30': '설날', '2025-05-05': '부처님오신날', '2025-05-06': '대체공휴일', '2025-10-06': '추석', '2025-10-07': '추석', '2025-10-08': '추석',
  '2026-02-16': '설날', '2026-02-17': '설날', '2026-02-18': '설날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일', '2026-09-24': '추석', '2026-09-25': '추석', '2026-09-26': '추석',
  '2027-02-06': '설날', '2027-02-07': '설날', '2027-02-08': '설날', '2027-02-09': '설날', '2027-05-13': '부처님오신날', '2027-09-14': '추석', '2027-09-15': '추석', '2027-09-16': '추석',
};
function holidayName(ds) { return LUNAR_HOLIDAYS[ds] || FIXED_HOLIDAYS[ds.slice(5)] || null; }
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
  if (tab === 'schedule') {
    // 탭을 떠났다 돌아오면 항상 오늘 날짜로 복귀(이전 선택 날짜/기간 입력 초기화)
    const n = new Date(); state.calYear = n.getFullYear(); state.calMonth = n.getMonth();
    state.selectedDay = todayStr();
    state.evtDraft = { endDate: null, remind: 3 };
    state.pickEndMode = false;
    renderCalendar();
  }
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
      col += `<div class="block" data-subj="${escapeHtml(s.name)}" title="클릭: ${escapeHtml(s.name)} 자료 폴더 열기" style="top:${top}px;height:${h}px;background:${colorFor(s.name)}">
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
  state.todos.forEach((t) => {
    if (t.skipped) return;  // '넘김' 처리한 할 일은 활성 목록에서 제외
    items.push({
      kind: 'todo', id: t.id, text: t.text, subject: t.subject || null, due: t.due, time: t.dueTime, done: t.done, starred: !!t.starred, repeat: t.repeat || null, subs: t.subs || [], origDue: t.origDue || null, deferCount: t.deferCount || 0,
    });
  });
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

// 지난 미완료 할 일을 오늘로 자동 이월. origDue(최초 밀린 날짜)를 보존해 "N일 밀림" 표시.
// 수동 할 일(state.todos)만 대상 — LMS 과제는 실제 제출 마감이라 건드리지 않음.
function rolloverOverdue() {
  if (state.rolloverOverdue === false) return false;
  const today = todayStr();
  let changed = false;
  for (const t of state.todos) {
    if (t.done || t.skipped || !t.due) continue;
    if (t.due < today) {
      if (!t.origDue) t.origDue = t.due;
      t.due = today;
      changed = true;
    }
  }
  if (changed) saveTodos();
  return changed;
}

function todoRow(it, showSubj) {
  const b = ddayBadge(it.due, it.done, it.time);
  const badge = b ? `<span class="dday ${b.cls}">${b.label}</span>` : '';
  let defer = '';
  if (!it.done) {
    if (it.deferCount) defer = `<span class="dday nudge" title="내가 미룬 횟수">${it.deferCount}번 넘김</span>`;
    else if (it.origDue) defer = `<span class="dday defer" title="원래 마감 ${escapeHtml(it.origDue)}">${-daysUntil(it.origDue)}일 밀림</span>`;
  }
  const subj = showSubj && it.subject ? `<span class="subj-chip" title="${escapeHtml(it.subject)}">${escapeHtml(it.subject)}</span>` : '';
  const play = `<span class="play" data-play="${escapeHtml(it.text)}" data-play-subj="${escapeHtml(it.subject || '')}" title="집중 시작">${ICO.play}</span>`;
  if (it.kind === 'lms') {
    const lstar = `<span class="star ${it.starred ? 'on' : ''}" data-star-lms="${escapeHtml(it.id)}" title="중요 표시">${ICO.star}</span>`;
    return `<div class="todo ${it.done ? 'done' : ''}" data-id="${escapeHtml(it.id)}" data-kind="lms" data-url="${escapeHtml(it.url || '')}">
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
  return `<div class="todo ${it.done ? 'done' : ''}" data-id="${it.id}" data-kind="todo">
    <input type="checkbox" class="check" data-toggle="${it.id}" ${it.done ? 'checked' : ''}/>
    <span class="todo-text" data-edit="${it.id}" title="더블클릭해 수정">${escapeHtml(it.text)}</span>
    ${rep}${subj}${subsBadge}${badge}${defer}${star}${addSub}${play}
    <span class="x" data-del="${it.id}" title="삭제">${ICO.x}</span>
  </div>`;
}
function subPanel(it) {
  const subs = it.subs || [];
  const rows = subs.map((s, i) => `<div class="sub ${s.done ? 'done' : ''}"><input type="checkbox" class="check sub-check" data-subtoggle="${it.id}:${i}" ${s.done ? 'checked' : ''}/><span class="sub-text">${escapeHtml(s.text)}</span><span class="x" data-subdel="${it.id}:${i}">${ICO.x}</span></div>`).join('');
  const adder = state.subAddOpen === it.id
    ? `<input type="text" class="sub-input" data-subadd="${it.id}" placeholder="하위 항목 입력 후 Enter" autocomplete="off"/>`
    : `<button class="sub-addbtn" data-subaddbtn="${it.id}">＋ 하위 항목 추가</button>`;
  return `<div class="subs">${rows}${adder}</div>`;
}
function todoBlock(it, showSubj) {
  const expanded = it.kind === 'todo' && state.expandedTodos[it.id];
  return todoRow(it, showSubj) + (expanded ? subPanel(it) : '');
}

function renderTodos() {
  rolloverOverdue();
  updateDraftChips();
  const today = todayStr();
  const si = $('td-search'); const q = (state.todoSearch || '').trim().toLowerCase();

  // 검색 모드: 활성+완료 전체를 플랫 필터
  if (q) {
    const all = activeItems().concat(state.todos.filter((t) => t.done).map((t) => ({ kind: 'todo', id: t.id, text: t.text, subject: t.subject || null, due: t.due, time: t.dueTime, done: true, starred: !!t.starred, repeat: t.repeat || null, subs: t.subs || [], origDue: t.origDue || null, deferCount: t.deferCount || 0 })));
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
  if (checked) delete t.origDue;  // 완료본엔 밀림 마커 불필요
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
  // 창 높이를 넘지 않게 최대 높이 제한 + 스크롤 (작은 창에서 아래가 잘리지 않게)
  popEl.style.maxHeight = (app.clientHeight - 16) + 'px';
  popEl.style.overflowY = 'auto';
  let left = ar.left - br.left;
  left = Math.min(left, app.clientWidth - popEl.offsetWidth - 8);
  popEl.style.left = Math.max(8, left) + 'px';
  let top = ar.bottom - br.top + 4;
  const h = popEl.offsetHeight;
  if (top + h > app.clientHeight - 8) top = Math.max(8, app.clientHeight - 8 - h); // 아래로 넘치면 위로 끌어올림
  popEl.style.top = top + 'px';
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
    const hol = holidayName(ds);
    let cell = `<div class="cal-cell ${inMonth ? '' : 'other'} ${ds === today ? 'today' : ''} ${ds === state.selectedDay ? 'selected' : ''} ${hol ? 'holiday' : (dow === 0 ? 'sun' : dow === 6 ? 'sat' : '')}" data-day="${ds}">`;
    cell += `<div class="cal-daynum">${cur.getDate()}</div>`;
    if (hol) cell += `<div class="cal-hol" title="${escapeHtml(hol)}">${escapeHtml(hol)}</div>`;
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
  // 과목명 → 과목 메인 페이지 URL (공지 옆 바로가기용)
  const courseUrlByName = {};
  (lms.courses || []).forEach((c) => { const cn = cleanCourse(c.name); if (cn && c.url && !courseUrlByName[cn]) courseUrlByName[cn] = c.url; });

  let html = '';

  // 새로 받은 수업 자료 패널 (확인 전까지 유지)
  if (state.newMaterials && state.newMaterials.length) {
    html += `<div class="newmat"><div class="newmat-head"><span class="ico">${ICO.inbox}</span><b>새로 받은 자료</b><span class="acc-count">${state.newMaterials.length}</span><button class="mini-read" id="clear-newmat" title="목록 지우기">확인</button></div>`;
    html += state.newMaterials.slice(0, 20).map((m) => {
      const isAsg = m.kind === 'assign';
      const tag = m.changed ? '<span class="lms-badge" style="background:var(--danger-soft);color:var(--danger);">수정</span>' : (isAsg ? '<span class="lms-badge">과제</span>' : '');
      return `<div class="newmat-row"><span class="subj-dot" style="background:${colorFor(m.course)}"></span><span class="nm-course" title="${escapeHtml(m.course)}">${escapeHtml(m.course)}</span>${tag}<span class="nm-title" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</span><button class="fbtn" data-${isAsg ? 'asgfolder' : 'matfolder'}="${escapeHtml(m.course)}">폴더</button></div>`;
    }).join('');
    html += `</div>`;
  }
  // 자동 다운로드 OFF일 때 안 받은 자료 안내
  if (!state.autoDownload) {
    const undone = ((lms.materials) || []).filter((m) => m && m.url && !state.materialsDone[m.url]);
    if (undone.length) html += `<div class="newmat"><div class="newmat-head"><span class="ico">${ICO.inbox}</span><b>안 받은 자료</b><span class="acc-count">${undone.length}</span><button class="mini-read" id="get-newmat" title="모두 다운로드">모두 받기</button></div></div>`;
  }

  html += `<div class="lms-section-title"><span class="ico">${ICO.pin}</span>과목별 공지사항</div>`;
  if (course.length) {
    const byCourse = {};
    course.forEach((n) => (byCourse[cleanCourse(n.courseName)] = byCourse[cleanCourse(n.courseName)] || []).push(n));
    Object.keys(byCourse).forEach((cn) => {
      const open = !!state.lmsOpenCourse[cn];
      const hasUnread = byCourse[cn].some((n) => !isRead(n.id));
      html += `<div class="acc-head" data-course="${escapeHtml(cn)}">
        <span class="subj-dot" style="background:${colorFor(cn)}"></span>
        <span class="name" title="${escapeHtml(cn)}">${escapeHtml(cn)}</span>
        ${hasUnread ? '<span class="unread-dot"></span>' : ''}
        <span class="acc-count">${byCourse[cn].length}</span>
        ${courseUrlByName[cn] ? `<button class="mini-read" data-gocourse="${escapeHtml(courseUrlByName[cn])}" title="과목 페이지 열기">바로가기</button>` : ''}
        ${hasUnread ? `<button class="mini-read" data-readcourse="${escapeHtml(cn)}" title="이 과목 공지 모두 읽음">읽음</button>` : ''}
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

  // 자료·과제 폴더 (과목별 바탕화면\Studeck 폴더 열기)
  // 자동받기에서 제외(false)한 과목은 폴더 목록에도 표시하지 않음
  const courseNames = (lms.courses || []).filter((c) => c.track !== false && state.matCourses[c.id] !== false)
    .map((c) => cleanCourse(c.name)).filter((v, i, a) => v && a.indexOf(v) === i);
  if (courseNames.length) {
    html += `<div class="lms-section-title"><span class="ico">${ICO.inbox}</span>자료 · 과제 폴더<span style="flex:1"></span><button class="mini-read" id="matset" title="자동 다운로드할 과목 선택">${ICO.edit}<span style="margin-left:3px;">자동받기</span></button></div>`;
    html += courseNames.map((cn) => `<div class="folder-row"><span class="subj-dot" style="background:${colorFor(cn)}"></span><span class="name" title="${escapeHtml(cn)}">${escapeHtml(cn)}</span><button class="fbtn" data-matfolder="${escapeHtml(cn)}">자료</button><button class="fbtn" data-auxfolder="${escapeHtml(cn)}">보조</button><button class="fbtn" data-asgfolder="${escapeHtml(cn)}">과제</button></div>`).join('');
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
  const n = unreadCount() + ((state.newMaterials && state.newMaterials.length) || 0);
  btn.classList.toggle('has-badge', n > 0);
  btn.setAttribute('data-badge', n > 99 ? '99+' : String(n));
}

async function lmsLogin() {
  $('lms-status').textContent = '로그인 창에서 직접 로그인해주세요…';
  await window.api.lmsLogin();
  await doLmsRefresh(false);
}
// 새로고침 결과에서 '새로 제출된' LMS 과제를 감지해 완료로 기록(+축하).
// 완료 기록은 state.lmsDone에 영구 저장 → 목록에서 사라져도 기록 탭에 남는다.
function detectLmsSubmissions(prevById) {
  const asg = (state.lms && state.lms.assignments) || [];
  let changed = false;
  const transitioned = [];
  asg.forEach((a) => {
    if (!a.submitted) return;
    if (!state.lmsDone[a.id]) {
      state.lmsDone[a.id] = { title: a.title, courseName: a.courseName, doneAt: Date.now() };
      changed = true;
      const prev = prevById[a.id];
      if (prev && !prev.submitted) transitioned.push(a); // 이번에 진짜 제출된 것만 축하
    }
  });
  if (changed) persist({ lmsDone: state.lmsDone });
  if (transitioned.length) {
    const cn = cleanCourse(transitioned[0].courseName) || 'LMS';
    showToast(transitioned.length === 1 ? `✅ ${cn} 과제 제출 완료!` : `✅ 과제 ${transitioned.length}개 제출 완료!`);
    transitioned.slice(0, 3).forEach((a) => window.api.notify('과제 제출 완료', `${cleanCourse(a.courseName) || 'LMS'} · ${a.title}`));
    if (currentTab === 'stats') renderStats();
  }
}

// 새 수업 자료를 감지해 자동 다운로드(바탕화면\Studeck\수업자료\과목) + "새로 받은 자료"에 기록.
// 공용 동기화: list의 파일들을 doneMap 기준으로 신규 다운로드 + 하루1회 변경확인.
// 파일명 중복은 main에서 방지(existed), 변경분은 같은 위치 덮어쓰기(changed).
async function syncDownloads(list, doneMap, kind, force) {
  const DAY = 24 * 60 * 60 * 1000, now = Date.now();
  let cand = (list || []).filter((m) => m && m.url);
  if (!force) cand = cand.filter((m) => state.matCourses[m.courseId] !== false); // 제외 과목만 빼고 전부
  const items = [];
  cand.forEach((m) => {
    const rec = doneMap[m.url];
    const course = cleanCourse(m.courseName) || '기타';
    // 과제인데 기록 경로가 '과제' 폴더가 아니면(옛 버그로 수업자료에 저장됨) 신규로 재수집
    const wrongFolder = rec && rec.path && kind === 'assign' && !/[\\/]과제[\\/]/.test(rec.path);
    if (!rec || wrongFolder) items.push({ url: m.url, course, title: m.title, kind, mode: 'new' });
    else if (force || !rec.checkedAt || (now - rec.checkedAt) > DAY) items.push({ url: m.url, course, title: m.title, kind, mode: 'recheck', dest: rec.path, sig: rec.sig });
  });
  if (!items.length) return { gotNew: [], changed: [] };
  const byUrl = {}; items.forEach((it) => (byUrl[it.url] = it));
  let results = [];
  try { results = (await window.api.lmsDownload(items)) || []; } catch (e) { return { gotNew: [], changed: [] }; }
  const gotNew = [], changed = [];
  results.forEach((r) => {
    if (!r || !r.ok) return;
    const it = byUrl[r.url]; if (!it) return;
    const prev = doneMap[r.url];
    doneMap[r.url] = { course: it.course, title: r.filename || it.title, path: r.path, at: (prev && prev.at) || now, sig: r.sig, checkedAt: now };
    if (!prev) { if (!r.existed) gotNew.push({ course: it.course, title: r.filename || it.title, at: now, kind }); }
    else if (r.changed) changed.push({ course: it.course, title: r.filename || it.title, at: now, kind, changed: true });
  });
  return { gotNew, changed };
}
async function downloadNewMaterials(force) {
  if (!state.autoDownload && !force) return;
  const mat = await syncDownloads((state.lms && state.lms.materials) || [], state.materialsDone, 'material', force);
  const asg = await syncDownloads((state.lms && state.lms.assignFiles) || [], state.assignDone, 'assign', force);
  const gotNew = [...mat.gotNew, ...asg.gotNew], changed = [...mat.changed, ...asg.changed];
  if (!gotNew.length && !changed.length) { persist({ materialsDone: state.materialsDone, assignDone: state.assignDone }); return; }
  const tagged = [...changed, ...gotNew];
  state.newMaterials = [...tagged, ...state.newMaterials].slice(0, 50);
  persist({ materialsDone: state.materialsDone, assignDone: state.assignDone, newMaterials: state.newMaterials });
  const parts = [];
  const newMat = gotNew.filter((g) => g.kind !== 'assign').length, newAsg = gotNew.filter((g) => g.kind === 'assign').length;
  if (newMat) parts.push(`새 자료 ${newMat}개`);
  if (newAsg) parts.push(`새 과제 ${newAsg}개`);
  if (changed.length) parts.push(`수정 ${changed.length}개`);
  showToast(`📁 ${parts.join(' · ')}`);
  window.api.notify('LMS 파일 ' + tagged.length + '개 업데이트', tagged.slice(0, 5).map((g) => `${g.changed ? '[수정] ' : g.kind === 'assign' ? '[과제] ' : ''}${g.course} · ${g.title}`).join('\n'));
  updateLmsBadge();
  if (currentTab === 'lms') renderLms();
  scheduleGitSync();  // 새 파일 받았으면 GitHub 동기화 예약
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
  const prevAssignById = {};
  ((state.lms && state.lms.assignments) || []).forEach((a) => { prevAssignById[a.id] = a; });
  state.lms = res.lms;
  detectLmsSubmissions(prevAssignById);
  await downloadNewMaterials();

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
// 완료 항목 통합: 내가 체크한 할 일 + 제출 완료된 LMS 과제(state.lmsDone).
// LMS 완료는 lmsDone에 영구 저장되어 과제가 목록에서 사라져도 기록에 남는다.
function completedItems() {
  const out = state.todos.filter((t) => t.done && t.doneAt)
    .map((t) => ({ kind: 'todo', id: t.id, text: t.text, subject: t.subject || '기타', doneAt: t.doneAt }));
  const md = state.lmsDone || {};
  Object.keys(md).forEach((id) => {
    const r = md[id];
    if (r && r.doneAt) out.push({ kind: 'lms', id, text: r.title || '과제', subject: cleanCourse(r.courseName) || '기타', doneAt: r.doneAt });
  });
  return out;
}
function renderStats() {
  const today = todayStr();
  const done = completedItems();
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

  // 과목별 공부시간 (집중 타이머 누적)
  const bySubjF = {};
  fsess.forEach((s) => { const k = s.subject || '기타'; bySubjF[k] = (bySubjF[k] || 0) + (s.minutes || 0); });
  const subjFNames = Object.keys(bySubjF).filter((k) => bySubjF[k] > 0).sort((a, b) => bySubjF[b] - bySubjF[a]);
  if (subjFNames.length) {
    const maxF = Math.max(...subjFNames.map((n) => bySubjF[n]));
    html += `<div class="sec-head first">과목별 공부시간</div>`;
    html += subjFNames.map((n) => `<div class="stat-bar-row">
      <span class="stat-bar-name" title="${escapeHtml(n)}">${escapeHtml(n)}</span>
      <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.round(bySubjF[n] / maxF * 100)}%;background:${colorFor(n)}"></span></span>
      <span class="stat-bar-val" style="width:auto;color:var(--muted)">${hm(bySubjF[n])}</span>
    </div>`).join('');
  }

  // 이월(밀린) 할 일 현황 — 자동 이월과 맞물림
  const deferred = state.todos.filter((t) => !t.done && !t.skipped && t.origDue).length;
  if (deferred) html += `<div class="study-line defer-line">${ICO.repeat} 이월된 할 일 <b>${deferred}</b>개 — 오늘 목록으로 옮겨져 있어요</div>`;

  // 넘긴 할 일 (부드럽게 남겨둔 미완료)
  const skippedList = state.todos.filter((t) => t.skipped).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  if (skippedList.length) {
    html += `<div class="sec-head first">넘긴 할 일 <span style="color:var(--muted);font-weight:600;">${skippedList.length}</span></div>`;
    html += skippedList.slice(0, 10).map((t) => `<div class="done-item skip"><span class="di-check skip">${ICO.x}</span>
      <span class="di-text" title="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span>
      ${t.subject ? `<span class="subj-chip">${escapeHtml(t.subject)}</span>` : ''}
      <span class="di-undo" data-restore="${escapeHtml(t.id)}" title="되돌리기">${ICO.undo}</span></div>`).join('');
  }

  // 완료 잔디(히트맵) — 최근 12주
  html += `<div class="sec-head first">완료 잔디 (최근 12주)</div>` + heatmapHtml(done);

  if (!total) {
    html += '<div class="empty-note">아직 완료한 할 일이 없어요. 하나씩 체크하거나 LMS 과제를 제출하면 여기에 기록이 쌓여요. 💪</div>';
    $('stats-content').innerHTML = html;
    return;
  }

  // 과목별 완료
  const bySubj = {};
  done.forEach((t) => { const k = t.subject || '기타'; bySubj[k] = (bySubj[k] || 0) + 1; });
  const names = Object.keys(bySubj).sort((a, b) => bySubj[b] - bySubj[a]);
  const max = Math.max(...names.map((n) => bySubj[n]));
  html += `<div class="sec-head first">과목별 완료 <span style="color:var(--muted);font-weight:600;">· 과목명을 눌러 펼치기</span></div>`;
  html += names.map((n) => {
    const open = !!state.statsOpenSubj[n];
    let row = `<div class="stat-bar-row clickable" data-subjrow="${escapeHtml(n)}">
      <span class="stat-bar-name" title="${escapeHtml(n)}">${escapeHtml(n)}</span>
      <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.round(bySubj[n] / max * 100)}%;background:${colorFor(n)}"></span></span>
      <span class="stat-bar-val">${bySubj[n]}</span>
    </div>`;
    if (open) {
      const items = done.filter((t) => (t.subject || '기타') === n).sort((a, b) => b.doneAt - a.doneAt);
      row += `<div class="subj-done-list">` + items.map((t) => {
        const dd = new Date(t.doneAt);
        return `<div class="subj-done-item">${t.kind === 'lms' ? '<span class="lms-badge">LMS</span>' : ''}<span class="sd-text" title="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span><span class="sd-date">${dd.getMonth() + 1}/${dd.getDate()}</span></div>`;
      }).join('') + `</div>`;
    }
    return row;
  }).join('');

  // 최근 완료
  const recent = done.slice().sort((a, b) => b.doneAt - a.doneAt).slice(0, 10);
  html += `<div class="sec-head" style="margin-top:12px;">최근 완료</div>`;
  html += recent.map((t) => {
    const dd = new Date(t.doneAt);
    const isLms = t.kind === 'lms';
    return `<div class="done-item"><span class="di-check">${ICO.check}</span>
      ${isLms ? '<span class="lms-badge">LMS</span>' : ''}
      <span class="di-text" title="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span>
      <span class="di-date">${dd.getMonth() + 1}/${dd.getDate()}</span>
      ${isLms ? '' : `<span class="di-undo" data-undo="${t.id}" title="되돌리기">${ICO.undo}</span>`}</div>`;
  }).join('');

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
// 그 주차의 첫 수업(가장 이른 요일·교시)의 시작 시각까지 반영한 Date
function classStartDateTime(subj, week) {
  const mon = attStartMonday(); if (!mon) return null;
  const s = (state.timetableFull || []).find((x) => x.name === subj);
  if (!s || !s.times || !s.times.length) return null;
  const ft = s.times.slice().sort((a, b) => a.day - b.day || a.start - b.start)[0];
  const d = new Date(mon);
  d.setDate(d.getDate() + (week - 1) * 7 + ft.day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(toMin(ft.start)); // 자정 기준 분 → 실제 수업 시작 시각
  return d;
}
function defaultAtt(subj, week) {
  const cs = classStartDateTime(subj, week); if (!cs) return '';
  // 그날이 아니라 '수업 시작 시각'이 지나야 자동 출석
  return cs.getTime() <= Date.now() ? '출석' : '';
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
  if (changed) rolloverOverdue();  // 자정 넘겨 켜둔 경우 지난 할 일 이월
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
  const play = e.target.closest('[data-play]'); if (play) { startFocus(play.dataset.play, play.dataset.playSubj || null); return; }
  const star = e.target.closest('[data-star]'); if (star) { const t = state.todos.find((x) => x.id === star.dataset.star); if (t) { t.starred = !t.starred; saveTodos(); renderMini(); } return; }
  const open = e.target.closest('[data-open]'); if (open) window.api.lmsOpen(open.dataset.open);
});
// 미니 모드에서도 우클릭 메뉴/더블클릭 편집 동작하게
$('mini-list').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.todo'); if (!row) return;
  e.preventDefault(); openTodoMenu(row.dataset.kind, row.dataset.id, e.clientX, e.clientY);
});
$('mini-list').addEventListener('dblclick', (e) => {
  const ed = e.target.closest('[data-edit]'); if (ed) startEditTodo(ed.dataset.edit);
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
  else if (b.dataset.tm === 'start') openTimerStart(b);
});
// 집중 전용화면 컨트롤
$('focus-view').addEventListener('click', (e) => {
  if (e.target.closest('#fv-back')) { exitFocus(); renderSummary(); return; }   // 전체화면만 닫고 타이머는 계속
  if (e.target.closest('#fv-pause')) { pauseTimer(); renderFocus(); return; }
  if (e.target.closest('#fv-stop')) { stopTimer(); return; }                    // 종료+기록(자동 exitFocus)
});
// 시간표 수업 블록 클릭 → 그 과목 자료 폴더 열기
$('grid-wrap').addEventListener('click', (e) => {
  const blk = e.target.closest('.block'); if (!blk || !blk.dataset.subj) return;
  window.api.openStudeckFolder('materials', blk.dataset.subj);
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
  const subaddbtn = e.target.closest('[data-subaddbtn]');
  if (expand) { state.expandedTodos[expand.dataset.expand] = !state.expandedTodos[expand.dataset.expand]; renderTodos(); return; }
  if (addsub) { const id = addsub.dataset.addsub; state.expandedTodos[id] = true; state.subAddOpen = id; renderTodos(); const inp = document.querySelector('[data-subadd]'); if (inp) inp.focus(); return; }
  if (subaddbtn) { state.subAddOpen = subaddbtn.dataset.subaddbtn; renderTodos(); const inp = document.querySelector('[data-subadd]'); if (inp) inp.focus(); return; }
  if (star) { const t = state.todos.find((x) => x.id === star.dataset.star); if (t) { t.starred = !t.starred; saveTodos(); renderTodos(); } return; }
  if (starLms) { const id = starLms.dataset.starLms; const i = state.starredLms.indexOf(id); if (i >= 0) state.starredLms.splice(i, 1); else state.starredLms.push(id); persist({ starredLms: state.starredLms }); renderTodos(); return; }
  if (play) { startFocus(play.dataset.play, play.dataset.playSubj || null); return; }
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
  if (!add) return;
  if (e.key === 'Enter') {
    const v = add.value.trim(); if (!v) return;
    const t = state.todos.find((x) => x.id === add.dataset.subadd);
    if (t) { t.subs = t.subs || []; t.subs.push({ text: v, done: false }); saveTodos(); state.subAddOpen = add.dataset.subadd; renderTodos(); const inp = document.querySelector('[data-subadd]'); if (inp) inp.focus(); }
  } else if (e.key === 'Escape') {
    collapseSubAdd(add.dataset.subadd); renderTodos();
  }
});
// 하위 항목 추가 취소: 입력을 비운 채 접을 때, 하위 항목이 하나도 없으면 패널까지 완전히 접는다
function collapseSubAdd(id) {
  state.subAddOpen = null;
  const t = state.todos.find((x) => x.id === id);
  if (t && !(t.subs && t.subs.length)) state.expandedTodos[id] = false;
}
// 하위 항목 입력이 비어 있는 채 포커스를 잃으면 접기(입력칸·빈 패널이 안 남게)
$('todo-list').addEventListener('focusout', (e) => {
  const add = e.target.closest && e.target.closest('[data-subadd]');
  if (add && !add.value.trim()) { collapseSubAdd(add.dataset.subadd); setTimeout(() => { if (currentTab === 'todos') renderTodos(); }, 0); }
});
// 제목 인라인 편집 (더블클릭 / 우클릭 메뉴 '수정' 공용)
function startEditTodo(id) {
  const t = state.todos.find((x) => x.id === id); if (!t) return;
  const ed = document.querySelector(`[data-edit="${id}"]`); if (!ed) return;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'edit-input'; inp.value = t.text;
  ed.replaceWith(inp); inp.focus(); inp.select();
  let committed = false;
  const commit = (save) => { if (committed) return; committed = true; if (save) { const v = inp.value.trim(); if (v) { t.text = v; saveTodos(); } } renderTodos(); };
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(true); if (ev.key === 'Escape') commit(false); });
  inp.addEventListener('blur', () => commit(true));
}
$('todo-list').addEventListener('dblclick', (e) => {
  const ed = e.target.closest('[data-edit]'); if (!ed) return;
  startEditTodo(ed.dataset.edit);
});
// 우클릭 컨텍스트 메뉴 (노션풍)
function placeAtCursor(x, y) {
  const app = $('app'), br = app.getBoundingClientRect();
  popEl.style.maxHeight = (app.clientHeight - 16) + 'px';
  popEl.style.overflowY = 'auto';
  let left = x - br.left, top = y - br.top;
  left = Math.min(left, app.clientWidth - popEl.offsetWidth - 8);
  top = Math.min(top, app.clientHeight - popEl.offsetHeight - 8);
  popEl.style.left = Math.max(8, left) + 'px';
  popEl.style.top = Math.max(8, top) + 'px';
}
// 밀린/오늘 할 일을 나중으로 미루기(수동 due 이동, origDue는 최초 밀림일 보존)
function deferTodo(id, dateStr) {
  const t = state.todos.find((v) => v.id === id); if (!t || !dateStr) return;
  t.deferCount = (t.deferCount || 0) + 1; // 수동 미루기 = '넘김' 횟수
  delete t.origDue;                        // '밀림'(자동 기한초과)과 구분
  t.due = dateStr; saveTodos(); rerenderTodoAreas();
}
function openDeferMenu(id, x, y) {
  closePopover();
  popEl = document.createElement('div'); popEl.className = 'popover menu';
  const add = (label, fn) => { const o = document.createElement('div'); o.className = 'opt'; o.textContent = label; o.onclick = () => { closePopover(); fn(); }; popEl.appendChild(o); };
  add('내일로', () => deferTodo(id, addDaysStr(todayStr(), 1)));
  add('모레로', () => deferTodo(id, addDaysStr(todayStr(), 2)));
  add('이번 주말로', () => deferTodo(id, comingWeekend()));
  add('다음 주로', () => deferTodo(id, addDaysStr(todayStr(), 7)));
  const sep = document.createElement('div'); sep.className = 'sep'; popEl.appendChild(sep);
  const di = document.createElement('input'); di.type = 'date'; di.value = todayStr();
  di.onchange = () => { if (di.value) { const v = di.value; closePopover(); deferTodo(id, v); } };
  popEl.appendChild(di);
  $('app').appendChild(popEl); placeAtCursor(x, y);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
function openTodoMenu(kind, id, x, y) {
  closePopover();
  popEl = document.createElement('div'); popEl.className = 'popover menu';
  const add = (label, fn, danger) => { const o = document.createElement('div'); o.className = 'opt' + (danger ? ' danger' : ''); o.textContent = label; o.onclick = () => { closePopover(); fn(); }; popEl.appendChild(o); };
  if (kind === 'lms') {
    const it = activeItems().find((i) => i.id === id) || {};
    add('집중 시작', () => startFocus(it.text, it.subject));
    add('제출 페이지 열기', () => { if (it.url) window.api.lmsOpen(it.url); });
    add(state.starredLms.includes(id) ? '별표 해제' : '별표', () => { const i = state.starredLms.indexOf(id); if (i >= 0) state.starredLms.splice(i, 1); else state.starredLms.push(id); persist({ starredLms: state.starredLms }); renderTodos(); });
  } else {
    const t = state.todos.find((v) => v.id === id); if (!t) return;
    add('집중 시작', () => startFocus(t.text, t.subject || null));
    add('하위 항목 추가', () => { state.expandedTodos[id] = true; state.subAddOpen = id; renderTodos(); const inp = document.querySelector('[data-subadd]'); if (inp) inp.focus(); });
    add('미루기…', () => openDeferMenu(id, x, y));
    add(t.skipped ? '넘김 해제' : '넘김으로 표시', () => { t.skipped = !t.skipped; if (t.skipped) { t.doneAt = Date.now(); } saveTodos(); rerenderTodoAreas(); });
    add(t.starred ? '별표 해제' : '별표', () => { t.starred = !t.starred; saveTodos(); renderTodos(); });
    add('수정', () => startEditTodo(id));
    add(t.done ? '완료 취소' : '완료로 표시', () => toggleTodo(id, !t.done));
    add('삭제', () => { state.todos = state.todos.filter((v) => v.id !== id); saveTodos(); renderTodos(); renderSummary(); }, true);
  }
  $('app').appendChild(popEl);
  placeAtCursor(x, y);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
$('todo-list').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.todo'); if (!row) return;
  e.preventDefault();
  openTodoMenu(row.dataset.kind, row.dataset.id, e.clientX, e.clientY);
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
// 자동 다운로드 대상 과목 선택 팝오버 (기본 전부 꺼짐 → 체크한 과목만)
function openMatCoursesPopover(anchor) {
  closePopover();
  popEl = document.createElement('div'); popEl.className = 'popover';
  popEl.style.maxHeight = '70vh'; popEl.style.overflowY = 'auto'; popEl.style.minWidth = '200px';
  const head = document.createElement('div');
  head.style.cssText = 'font-size:11px;font-weight:800;color:var(--muted);padding:4px 8px 6px;border-bottom:1px solid var(--line);margin-bottom:4px;';
  head.textContent = '자동 다운로드할 과목';
  popEl.appendChild(head);
  const courses = ((state.lms && state.lms.courses) || []).filter((c) => c.track !== false);
  if (!courses.length) { const em = document.createElement('div'); em.className = 'opt'; em.style.color = 'var(--muted)'; em.textContent = '추적 중인 강좌가 없어요'; popEl.appendChild(em); }
  courses.forEach((c) => {
    const o = document.createElement('label'); o.className = 'opt'; o.style.display = 'flex'; o.style.gap = '8px'; o.style.alignItems = 'center';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.matCourses[c.id] !== false;
    cb.onchange = () => { if (cb.checked) delete state.matCourses[c.id]; else state.matCourses[c.id] = false; persist({ matCourses: state.matCourses }); };
    const sp = document.createElement('span'); sp.textContent = cleanCourse(c.name); sp.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    o.appendChild(cb); o.appendChild(sp); popEl.appendChild(o);
  });
  const sep = document.createElement('div'); sep.className = 'sep'; popEl.appendChild(sep);
  const hint = document.createElement('div'); hint.className = 'opt'; hint.style.cssText = 'cursor:default;color:var(--muted);font-size:11px;white-space:normal;'; hint.textContent = '기본은 전부 자동으로 받아요. 안 받을 과목만 체크를 해제하세요.';
  popEl.appendChild(hint);
  $('app').appendChild(popEl); placePopover(anchor);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
$('lms-content').addEventListener('click', (e) => {
  const go = e.target.closest('[data-gocourse]');
  if (go) { window.api.lmsOpen(go.dataset.gocourse); return; }
  if (e.target.closest('#matset')) { openMatCoursesPopover(e.target.closest('#matset')); return; }
  const mf = e.target.closest('[data-matfolder]');
  if (mf) { window.api.openStudeckFolder('materials', mf.dataset.matfolder); return; }
  const xf = e.target.closest('[data-auxfolder]');
  if (xf) { window.api.openStudeckFolder('aux', xf.dataset.auxfolder); return; }
  const af = e.target.closest('[data-asgfolder]');
  if (af) { window.api.openStudeckFolder('assignment', af.dataset.asgfolder); return; }
  if (e.target.closest('#clear-newmat')) { state.newMaterials = []; persist({ newMaterials: [] }); renderLms(); updateLmsBadge(); return; }
  if (e.target.closest('#get-newmat')) { downloadNewMaterials(true); return; }
  const rc = e.target.closest('[data-readcourse]');
  if (rc) {
    const cn = rc.dataset.readcourse;
    ((state.lms && state.lms.courseNotices) || []).filter((n) => cleanCourse(n.courseName) === cn).forEach((n) => { if (!state.readIds.includes(n.id)) state.readIds.push(n.id); });
    persist({ readIds: state.readIds }); renderLms(); updateLmsBadge(); return;
  }
  const acc = e.target.closest('[data-course]');
  if (acc) { const cn = acc.dataset.course; state.lmsOpenCourse[cn] = !state.lmsOpenCourse[cn]; renderLms(); return; }
  if (e.target.closest('#gen-toggle')) { state.showGeneral = !state.showGeneral; renderLms(); return; }
  const notice = e.target.closest('.notice');
  if (notice) { markRead(notice.dataset.nid); window.api.lmsOpen(notice.dataset.open); renderLms(); return; }
  const open = e.target.closest('[data-open]'); if (open) window.api.lmsOpen(open.dataset.open);
});
$('stats-content').addEventListener('click', (e) => {
  const row = e.target.closest('[data-subjrow]');
  if (row) { const n = row.dataset.subjrow; state.statsOpenSubj[n] = !state.statsOpenSubj[n]; renderStats(); return; }
  const restore = e.target.closest('[data-restore]');
  if (restore) { const t = state.todos.find((x) => x.id === restore.dataset.restore); if (t) { t.skipped = false; t.doneAt = null; rolloverOverdue(); saveTodos(); renderStats(); rerenderTodoAreas(); } return; }
  const u = e.target.closest('[data-undo]'); if (!u) return;
  const t = state.todos.find((x) => x.id === u.dataset.undo);
  if (t) { t.done = false; t.doneAt = null; rolloverOverdue(); saveTodos(); renderStats(); renderSummary(); }
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
function openSettings() { $('inp-id').value = state.identifier || ''; $('settings-err').textContent = ''; $('settings').classList.remove('hidden'); refreshGitStatus(); }
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
$('inp-rollover').onchange = () => { state.rolloverOverdue = $('inp-rollover').checked; persist({ rolloverOverdue: state.rolloverOverdue }); if (state.rolloverOverdue) rolloverOverdue(); rerenderTodoAreas(); };
$('inp-autodl').onchange = () => { state.autoDownload = $('inp-autodl').checked; persist({ autoDownload: state.autoDownload }); };
if ($('inp-focus-goal')) $('inp-focus-goal').onchange = () => {
  const h = parseFloat($('inp-focus-goal').value);
  state.focusGoalMin = (!isNaN(h) && h > 0) ? Math.round(h * 60) : 120;
  persist({ focusGoalMin: state.focusGoalMin });
  const fv = $('focus-view'); if (fv && !fv.classList.contains('hidden')) renderFocus();
};
$('btn-open-studeck').onclick = () => window.api.openStudeckFolder('root');
// GitHub 동기화
async function refreshGitStatus() {
  try {
    const s = await window.api.gitSyncStatus();
    if (s && s.repo && $('inp-git-repo') && !$('inp-git-repo').value) $('inp-git-repo').value = s.repo;
    if ($('git-sync-msg')) $('git-sync-msg').textContent = (s && s.enabled) ? `연결됨: ${s.repo}` : '연결 안 됨';
  } catch (e) {}
}
if ($('btn-git-connect')) $('btn-git-connect').onclick = async () => {
  const repo = $('inp-git-repo').value.trim(), token = $('inp-git-token').value.trim();
  if (!repo || !token) { $('git-sync-msg').textContent = '저장소(owner/이름)와 토큰을 입력하세요.'; return; }
  $('git-sync-msg').textContent = '연결·동기화 중…';
  const r = await window.api.gitConnect(repo, token);
  $('git-sync-msg').textContent = r && r.ok ? '✅ 연결·동기화 완료' : ('오류: ' + ((r && (r.error || r.push)) || '실패'));
  $('inp-git-token').value = '';
};
if ($('btn-git-sync')) $('btn-git-sync').onclick = async () => {
  $('git-sync-msg').textContent = '동기화 중…';
  const r = await window.api.gitSync();
  $('git-sync-msg').textContent = r && r.ok ? '✅ 동기화 완료' : ('오류: ' + ((r && (r.error || r.push)) || '실패'));
};
// 파일 변경 후 자동 동기화(디바운스) — 연결돼 있을 때만
let _gitSyncT = null;
function scheduleGitSync() {
  clearTimeout(_gitSyncT);
  _gitSyncT = setTimeout(async () => {
    try { const s = await window.api.gitSyncStatus(); if (s && s.enabled) window.api.gitSync(); } catch (e) {}
  }, 8000);
}
$('inp-autostart').onchange = async () => {
  const on = await window.api.setAutoStart($('inp-autostart').checked);
  $('inp-autostart').checked = on;
  showToast(on ? '윈도우 시작 시 자동 실행을 켰어요' : '자동 실행을 껐어요');
};

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  ['dark', 'light', 'cbnu', 'baekjoon', 'gray'].forEach((t) => { const b = $('theme-' + t); if (b) b.classList.toggle('sel', state.theme === t); });
}
function setTheme(t) { state.theme = t; persist({ theme: t }); applyTheme(); }
function applyClockFormat() {
  ['h', 'hm', 'hms'].forEach((f) => { const b = $('clk-' + f); if (b) b.classList.toggle('sel', state.clockFormat === f); });
  updateClock();
}
function setClockFormat(f) { state.clockFormat = f; persist({ clockFormat: f }); applyClockFormat(); }
$('clk-h').onclick = () => setClockFormat('h');
$('clk-hm').onclick = () => setClockFormat('hm');
$('clk-hms').onclick = () => setClockFormat('hms');
$('theme-dark').onclick = () => setTheme('dark');
$('theme-light').onclick = () => setTheme('light');
$('theme-cbnu').onclick = () => setTheme('cbnu');
$('theme-baekjoon').onclick = () => setTheme('baekjoon');
$('theme-gray').onclick = () => setTheme('gray');
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
  state.theme = ['light', 'cbnu', 'baekjoon', 'gray'].includes(cfg.theme) ? cfg.theme : 'dark';
  applyTheme();
  state.focus = cfg.focus && Array.isArray(cfg.focus.sessions) ? cfg.focus : { sessions: [] };
  state.attendance = cfg.attendance && typeof cfg.attendance === 'object' ? { semesterStart: cfg.attendance.semesterStart || '', overrides: cfg.attendance.overrides || {} } : { semesterStart: '', overrides: {} };
  state.readIds = Array.isArray(cfg.readIds) ? cfg.readIds : [];
  state.starredLms = Array.isArray(cfg.starredLms) ? cfg.starredLms : [];
  state.notifyPrefs = Object.assign({ morningHour: 8, deadlineAlerts: true }, cfg.notifyPrefs || {});
  $('inp-morning').value = String(state.notifyPrefs.morningHour).padStart(2, '0') + ':00';
  $('inp-deadline').checked = state.notifyPrefs.deadlineAlerts !== false;
  state.rolloverOverdue = cfg.rolloverOverdue !== false;
  $('inp-rollover').checked = state.rolloverOverdue;
  state.lmsDone = (cfg.lmsDone && typeof cfg.lmsDone === 'object') ? cfg.lmsDone : {};
  state.materialsDone = (cfg.materialsDone && typeof cfg.materialsDone === 'object') ? cfg.materialsDone : {};
  state.assignDone = (cfg.assignDone && typeof cfg.assignDone === 'object') ? cfg.assignDone : {};
  // v1.1.10: 과제 파일이 잘못된 폴더(수업자료)로 저장되던 기록 1회 초기화 → 다음 새로고침에 '과제' 폴더로 재수집
  if (!cfg.assignFix1) { state.assignDone = {}; persist({ assignDone: {}, assignFix1: true }); }
  // v1.0.11: 예전 잘못 받은 기록(view.php HTML) 1회 초기화 → 다음 새로고침에 올바른 파일로 재다운로드
  if (!cfg.materialsFix2) { state.materialsDone = {}; persist({ materialsDone: {}, materialsFix2: true }); }
  state.newMaterials = Array.isArray(cfg.newMaterials) ? cfg.newMaterials : [];
  state.autoDownload = cfg.autoDownload !== false;
  $('inp-autodl').checked = state.autoDownload;
  state.matCourses = (cfg.matCourses && typeof cfg.matCourses === 'object') ? cfg.matCourses : {};
  state.clockFormat = ['h', 'hm', 'hms'].includes(cfg.clockFormat) ? cfg.clockFormat : 'hms';
  applyClockFormat();
  state.focusGoalMin = (typeof cfg.focusGoalMin === 'number' && cfg.focusGoalMin > 0) ? cfg.focusGoalMin : 120;
  if ($('inp-focus-goal')) $('inp-focus-goal').value = String(Math.round(state.focusGoalMin / 60 * 10) / 10);
  try { $('inp-autostart').checked = await window.api.getAutoStart(); } catch (e) {}
  state.todoDraft = { due: todayStr(), subject: null, repeat: null };
  rolloverOverdue();  // 실행 시 지난 미완료 할 일을 오늘로 이월
  renderSummary();
  updateClock();
  setInterval(updateClock, 1000);  // 헤더 시계(초 단위)
  updateLmsBadge();

  if (cfg.identifier) { state.identifier = cfg.identifier; loadTimetable(cfg.identifier); }
  else showTimetableState('empty');

  if (state.lms && state.lms.courses && state.lms.courses.length) {
    window.api.lmsStatus().then((s) => { if (s && s.valid) doLmsRefresh(true); });
  }
  // 시작 시 GitHub에서 최신 자료 받아오기(+로컬 변경 올리기)
  window.api.gitSyncStatus().then((s) => { if (s && s.enabled) window.api.gitSync(); }).catch(() => {});

  // 과제 제출 창을 닫으면 자동 새로고침 → 제출한 과제가 '완료'로 전환
  window.api.onSubmissionClosed(() => {
    if (state.lms && state.lms.courses && state.lms.courses.length && state.lms.sessionValid !== false) {
      setTimeout(() => doLmsRefresh(true), 600);
    }
  });

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
