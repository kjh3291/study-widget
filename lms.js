// ------------------------------------------------------------------
// 충북대 LMS (Moodle + coursemos) 연동
//  - 로그인은 사용자가 실제 LMS 창에서 직접. 앱은 비밀번호를 다루지 않는다.
//  - persist:lms 파티션에 세션 쿠키만 유지해 재사용.
//  - 히든 창으로 페이지를 열어 렌더된 DOM을 파싱한다(공개 API 미사용).
// ------------------------------------------------------------------
const { BrowserWindow, session } = require('electron');

const LMS_ORIGIN = 'https://lms.chungbuk.ac.kr';
const PARTITION = 'persist:lms';

// ---------- 세션/창 ----------
function isLoginUrl(u) {
  return !u || /\/login\//.test(u) || !u.startsWith(LMS_ORIGIN);
}
function lmsSession() { return session.fromPartition(PARTITION); }

// 세션 쿠키를 '호스트 쿠키 in-place 갱신'으로 30일 영구화(재시작 후 복원).
// 핵심: cookies.set에 domain을 넘기지 않아 기존 호스트 쿠키를 덮어씀 → .도메인 중복 쿠키 생성 안 함.
// 과거 중복(.lms…)이 남아있으면 1회 제거.
async function persistCookies() {
  const ses = lmsSession();
  const far = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  try {
    const cookies = await ses.cookies.get({});
    for (const c of cookies) {
      const host = (c.domain || '').replace(/^\./, '');
      if (!/chungbuk\.ac\.kr$/.test(host)) continue;
      // 잘못 만들어진 도메인(.붙은) 또는 빈 값 중복 쿠키 제거 (세션 깨짐 방지)
      if ((c.domain && c.domain[0] === '.') || !c.value) {
        try { await ses.cookies.remove(`https://${host}${c.path || '/'}`, c.name); } catch (e) {}
        try { await ses.cookies.remove(`http://${host}${c.path || '/'}`, c.name); } catch (e) {}
        continue;
      }
      if (c.expirationDate) continue; // 이미 영구 쿠키면 스킵
      try {
        await ses.cookies.set({
          url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`,
          name: c.name, value: c.value, path: c.path,
          secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
          expirationDate: far,
        });
      } catch (e) { /* 개별 실패 무시 */ }
    }
    await ses.cookies.flushStore();
  } catch (e) { /* noop */ }
}

let scrapeWin = null;
function getScrapeWin() {
  if (scrapeWin && !scrapeWin.isDestroyed()) return scrapeWin;
  scrapeWin = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  scrapeWin.on('closed', () => (scrapeWin = null));
  return scrapeWin;
}

// url 로드 후 페이지 컨텍스트에서 fnBody(문자열)를 실행해 결과 반환.
// 로그인 페이지로 튕기면 { needLogin:true }.
// 특정 webContents로 스크래핑
async function scrapeWith(wc, url, fnBody, waitMs) {
  try {
    await wc.loadURL(url);
  } catch (e) {
    if (!/ERR_ABORTED/.test(String(e && e.message))) return { error: String(e && e.message || e) };
  }
  const finalUrl = wc.getURL();
  if (isLoginUrl(finalUrl)) return { needLogin: true };
  if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
  try {
    const data = await wc.executeJavaScript(`(function(){${fnBody}})();`, false);
    return { data };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}
function scrape(url, fnBody, waitMs) {
  return scrapeWith(getScrapeWin().webContents, url, fnBody, waitMs);
}

// 병렬 로드용 히든 창 풀
let pool = [];
function getPool(n) {
  pool = pool.filter((w) => !w.isDestroyed());
  while (pool.length < n) {
    const w = new BrowserWindow({ show: false, webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    w.on('closed', () => { pool = pool.filter((x) => x !== w); });
    pool.push(w);
  }
  return pool.slice(0, n);
}

// ---------- 로그인 창 (사용자가 직접 로그인) ----------
let loginWin = null;
function openLoginWindow() {
  return new Promise((resolve) => {
    if (loginWin && !loginWin.isDestroyed()) {
      loginWin.focus();
      return resolve({ ok: true, already: true });
    }
    loginWin = new BrowserWindow({
      width: 500,
      height: 680,
      title: 'LMS 로그인 (직접 로그인하세요)',
      autoHideMenuBar: true,
      alwaysOnTop: true,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    loginWin.loadURL(LMS_ORIGIN + '/login/index.php');

    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    const check = () => {
      if (loginWin.isDestroyed()) return;
      const u = loginWin.webContents.getURL();
      if (!isLoginUrl(u)) {
        // 로그인 페이지를 벗어남 = 로그인 성공으로 간주
        finish({ ok: true });
        setTimeout(() => {
          if (loginWin && !loginWin.isDestroyed()) loginWin.close();
        }, 400);
      }
    };
    loginWin.webContents.on('did-navigate', check);
    loginWin.webContents.on('did-navigate-in-page', check);
    loginWin.on('closed', () => {
      loginWin = null;
      finish({ ok: true, closed: true });
    });
  });
}

// 이미 로그인된 세션으로 특정 페이지(과제 제출 등)를 실제 창으로 열기
function openInSession(url) {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    title: 'LMS',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(url && url.startsWith('http') ? url : LMS_ORIGIN);
  return win; // 호출측(main)에서 닫힘 이벤트 추적용
}

// ---------- 세션 유효성 확인 ----------
async function checkSession() {
  const r = await scrape(LMS_ORIGIN + '/', 'return document.title || "";');
  const valid = !r.needLogin && !r.error;
  if (valid) await persistCookies(); // 킵얼라이브(활동 갱신) + 쿠키 영구화
  return { valid };

}

// ---------- 페이지 파서 (페이지 컨텍스트에서 실행되는 함수 본문 문자열) ----------

// 대시보드에서 수강 강좌 목록 추출
const FN_COURSES = `
  var map = {};
  document.querySelectorAll('a[href*="/course/view.php?id="]').forEach(function(a){
    var m = (a.href || '').match(/id=(\\d+)/);
    if (!m) return;
    var id = m[1];
    var name = (a.textContent || '').replace(/\\s+/g,' ').trim();
    if (name && name.length > 1 && !map[id]) map[id] = name;
  });
  return Object.keys(map).map(function(id){ return { id: id, name: map[id] }; });
`;

// 과제 목록: /mod/assign/index.php?id=<courseId>
const FN_ASSIGN = `
  var out = [];
  document.querySelectorAll('table tr').forEach(function(tr){
    var a = tr.querySelector('a[href*="/mod/assign/view.php?id="]');
    if (!a) return;
    var url = a.href;
    var cm = (url.match(/id=(\\d+)/) || [])[1] || null;
    var title = (a.textContent || '').replace(/\\s+/g,' ').trim();
    var cells = Array.prototype.map.call(tr.querySelectorAll('td'), function(td){
      return (td.textContent || '').replace(/\\s+/g,' ').trim();
    });
    var dueText = '';
    cells.forEach(function(c){
      if (/\\d{4}[-.\\/년]\\s*\\d{1,2}[-.\\/월]\\s*\\d{1,2}/.test(c) || /\\d{1,2}월\\s*\\d{1,2}일/.test(c)) dueText = c;
    });
    var rowText = (tr.textContent || '');
    var submitted = /제출\\s*완료|제출됨|submitted|채점|평가완료/i.test(rowText);
    out.push({ cmid: cm, title: title, url: url, dueText: dueText, submitted: submitted });
  });
  return out;
`;

// 강좌/게시판 페이지에서 공지 글(ubboard article) 추출: 텍스트 "제목 YYYY-MM-DD"
const FN_ARTICLES = `
  var out = [];
  document.querySelectorAll('a[href*="ubboard/article.php"]').forEach(function(a){
    var raw = (a.textContent || '').replace(/\\s+/g,' ').trim();
    if (!raw) return;
    out.push({ raw: raw, url: a.href });
  });
  return out;
`;

// 강좌 페이지 1회 로드로 공지 글 + 자체 공지 게시판 URL 동시 반환
const FN_COURSE_PAGE = `
  var arts = [];
  document.querySelectorAll('a[href*="ubboard/article.php"]').forEach(function(a){
    var raw = (a.textContent || '').replace(/\\s+/g,' ').trim();
    if (raw) arts.push({ raw: raw, url: a.href });
  });
  var board = '';
  var vs = document.querySelectorAll('a[href*="ubboard/view.php?id="]');
  for (var i=0;i<vs.length;i++){
    var m = (vs[i].href||'').match(/view\\.php\\?id=(\\d+)/);
    if (!m || m[1] === '17') continue;
    if (/공지/.test(vs[i].textContent||'')) { board = vs[i].href; break; }
  }
  // 수업 자료(파일) 링크 — 강의자료 모듈. 동영상(vod)은 제외.
  var mats = [];
  var seen = {};
  document.querySelectorAll('a[href*="/mod/resource/view.php?id="], a[href*="/mod/ubfile/view.php?id="]').forEach(function(a){
    var t = (a.textContent || '').replace(/\\s+/g,' ').trim();
    var h = a.href || '';
    if (!h || seen[h]) return;
    seen[h] = 1;
    mats.push({ title: t, url: h });
  });
  return { articles: arts, board: board, materials: mats };
`;

// ---------- 강좌명 정리 (coursemos 대시보드 카드 라벨 제거) ----------
// "정규 강좌 학부 진행중 데이터 구조 (5110014-01) 임화정" -> "데이터 구조"
function cleanCourseName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/^(정규|비교과|일반|교양|전공|공통|강좌|과정|학부|대학원|진행\s*중|진행중|완료|예정|신청|수강)\s+/, '');
  } while (s !== prev);
  s = s.replace(/\s*\([^)]*\d[^)]*\).*$/, '').trim(); // 뒤쪽 "(학수번호) 교수명" 제거
  return s || String(raw || '').trim();
}

// ---------- 날짜 파싱 (Node 측) ----------
function parseKDate(s) {
  if (!s) return null;
  var t = String(s);
  var m = t.match(/(\d{4})[-.\/년]\s*(\d{1,2})[-.\/월]\s*(\d{1,2})/);
  var y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    var m2 = t.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (!m2) return null;
    y = new Date().getFullYear(); mo = +m2[1]; d = +m2[2];
  }
  if (!mo || !d) return null;
  var mm = String(mo).padStart(2, '0');
  var dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}
function parseKTime(s) {
  if (!s) return null;
  var m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(+m[1]).padStart(2, '0')}:${m[2]}`;
}

// 과제 제출 페이지(mod/assign/view.php)에서 '내가 제출한 첨부파일' 링크 수집
const FN_ASSIGN_FILES = `
  var out=[], seen={};
  document.querySelectorAll('a[href*="pluginfile.php"]').forEach(function(a){
    var h=a.href||'';
    if(!/assignsubmission_file|submission_files|mod_assign/i.test(h)) return;
    if(/theme|\\/pix\\/|favicon|logo/i.test(h)) return;
    if(seen[h]) return; seen[h]=1;
    out.push({ title:(a.textContent||'').replace(/\\s+/g,' ').trim(), url:h });
  });
  return out;
`;

// ---------- 전체 새로고침 ----------
// prev: 기존 config.lms (track 플래그/이전 공지 비교용). 반환: 새 lms 객체 or {needLogin:true}
async function refresh(prev) {
  prev = prev || {};
  const prevCourses = prev.courses || [];
  const trackMap = {};
  prevCourses.forEach((c) => (trackMap[c.id] = c.track !== false));

  // 1) 강좌 발견 (대시보드)
  const cr = await scrape(LMS_ORIGIN + '/', FN_COURSES);
  if (cr.needLogin) return { needLogin: true };
  if (cr.error) return { error: cr.error };
  const discovered = (cr.data || []).map((c) => ({
    id: c.id,
    name: cleanCourseName(c.name),
    url: `${LMS_ORIGIN}/course/view.php?id=${c.id}`,  // 과목 메인 페이지(공지 옆 바로가기용)
    track: trackMap[c.id] !== undefined ? trackMap[c.id] : true,
  }));
  const courses = discovered.length ? discovered : prevCourses;

  const assignments = [];
  const courseNotices = [];
  const materials = [];
  const tracked = courses.filter((c) => c.track !== false);

  // 강좌 1개 로드(과제 + 과목별 공지 + 자료) — 특정 창으로
  async function loadCourse(wc, c) {
    const out = { assignments: [], notices: [], materials: [], needLogin: false };
    const ar = await scrapeWith(wc, `${LMS_ORIGIN}/mod/assign/index.php?id=${c.id}`, FN_ASSIGN);
    if (ar.needLogin) { out.needLogin = true; return out; }
    (ar.data || []).forEach((a) => out.assignments.push({
      id: `${c.id}:${a.cmid || a.title}`, courseId: c.id, courseName: c.name, title: a.title,
      due: parseKDate(a.dueText), dueTime: parseKTime(a.dueText), submitted: !!a.submitted, url: a.url,
    }));
    const seenT = new Map();
    const cp = await scrapeWith(wc, `${LMS_ORIGIN}/course/view.php?id=${c.id}`, FN_COURSE_PAGE);
    if (cp && cp.needLogin) { out.needLogin = true; return out; }
    const cpd = (cp && cp.data) || { articles: [], board: '', materials: [] };
    (cpd.articles || []).forEach((n) => addNotice(out.notices, seenT, c, n));
    if (cpd.board) {
      const nr = await scrapeWith(wc, cpd.board, FN_ARTICLES);
      (nr && nr.data || []).forEach((n) => addNotice(out.notices, seenT, c, n));
    }
    (cpd.materials || []).forEach((m) => {
      if (!m || !m.url) return;
      out.materials.push({ id: m.url, courseId: c.id, courseName: c.name, title: (m.title || '자료').trim(), url: m.url });
    });
    return out;
  }

  // 창 풀로 병렬 처리(동시 최대 3)
  const workers = getPool(Math.min(3, Math.max(1, tracked.length)));
  let idx = 0, needLogin = false;
  await Promise.all(workers.map(async (w) => {
    while (idx < tracked.length && !needLogin) {
      const c = tracked[idx++];
      const r = await loadCourse(w.webContents, c);
      if (r.needLogin) { needLogin = true; break; }
      r.assignments.forEach((a) => assignments.push(a));
      r.notices.forEach((n) => courseNotices.push(n));
      r.materials.forEach((m) => materials.push(m));
    }
  }));
  if (needLogin) return { needLogin: true };

  // 제출 완료한 과제의 첨부파일 수집(제출한 것만) — 과목별 '과제' 폴더로 저장하기 위함
  const assignFiles = [];
  const submitted = assignments.filter((a) => a.submitted && a.url);
  if (submitted.length) {
    const aw = getPool(Math.min(3, submitted.length));
    let k = 0;
    await Promise.all(aw.map(async (w) => {
      while (k < submitted.length) {
        const a = submitted[k++];
        const fr = await scrapeWith(w.webContents, a.url, FN_ASSIGN_FILES);
        (fr && fr.data || []).forEach((f) => {
          if (f && f.url) assignFiles.push({ id: f.url, courseId: a.courseId, courseName: a.courseName, assignTitle: a.title, title: f.title || a.title, url: f.url });
        });
      }
    }));
  }

  // 전체(시스템) 공지: 사이트 공통 게시판(id=17)
  const generalNotices = [];
  const gSeen = new Map();
  const gr = await scrape(`${LMS_ORIGIN}/mod/ubboard/view.php?id=17`, FN_ARTICLES);
  (gr && gr.data || []).forEach((n) => addNotice(generalNotices, gSeen, { id: '', name: '' }, n));

  await persistCookies(); // 로그인 상태 → 세션 쿠키 영구화(재시작 후 복원)

  return {
    courses,
    assignments,
    courseNotices,
    generalNotices,
    materials,
    assignFiles,
    lastSync: Date.now(),
    sessionValid: true,
  };
}

// article "제목 YYYY-MM-DD" → 공지 객체로 추가(제목 기준 dedupe, 날짜 있는 쪽 우선)
function addNotice(arr, seen, course, n) {
  if (!n || !n.url) return;
  const m = String(n.raw).match(/(\d{4}-\d{1,2}-\d{1,2})\s*$/);
  const title = (m ? n.raw.slice(0, m.index) : n.raw).replace(/\s+/g, ' ').trim();
  if (!title || title.length < 2) return;
  const date = m ? m[1] : '';
  if (seen.has(title)) {
    const ex = seen.get(title);
    if (date && !ex.date) { ex.date = date; ex.url = n.url; } // 날짜/링크 보강
    return;
  }
  const obj = { id: n.url, courseId: course.id, courseName: course.name, title, date, url: n.url };
  seen.set(title, obj);
  arr.push(obj);
}

// ---------- 디버그: 로그인 세션으로 원본 HTML 덤프 (셀렉터 확정용) ----------
async function dumpDebug(prev) {
  const fs = require('fs');
  const path = require('path');
  const { app } = require('electron');
  const dir = path.join(app.getPath('userData'), 'lms-debug');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}

  // 덤프 중에는 어떤 파일도 실제로 다운로드되지 않게 취소(신용관리 등 자료 페이지가 다운로드를 유발하는 것 방지)
  const dumpSes = lmsSession();
  const cancelDL = (e, item) => { try { item.cancel(); } catch (_) {} };
  dumpSes.on('will-download', cancelDL);

  const EXTRACT = `(function(){var out=[];document.querySelectorAll('a[href]').forEach(function(a){var h=a.href||'';if(/\\/mod\\/|\\/report\\/|\\/local\\/|board|attend|ubcompletion|notice|공지/i.test(h+' '+(a.textContent||'')))out.push({t:(a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40),h:h});});return {title:document.title,url:location.href,links:out.slice(0,150)};})()`;
  const saved = [];
  const save = async (label, url, waitMs) => {
    const wc = getScrapeWin().webContents;
    try { await wc.loadURL(url); } catch (e) { if (!/ERR_ABORTED/.test(String(e && e.message))) { saved.push(`${label}: ERROR ${e.message}`); return null; } }
    const finalUrl = wc.getURL();
    if (isLoginUrl(finalUrl)) { saved.push(`${label}: needLogin`); return { needLogin: true }; }
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs)); // AJAX 로드 대기
    let html = '', meta = null, txt = '';
    try { html = await wc.executeJavaScript('document.documentElement.outerHTML', false); } catch (e) {}
    try { meta = await wc.executeJavaScript(EXTRACT, false); } catch (e) {}
    try { txt = await wc.executeJavaScript('(document.querySelector("#region-main,.course-content,main,table")||document.body).innerText', false); } catch (e) {}
    try { fs.writeFileSync(path.join(dir, label + '.html'), `<!-- ${url} final:${finalUrl} -->\n` + html, 'utf8'); } catch (e) {}
    if (meta) { try { fs.writeFileSync(path.join(dir, label + '.links.json'), JSON.stringify(meta, null, 1), 'utf8'); } catch (e) {} }
    if (txt) { try { fs.writeFileSync(path.join(dir, label + '.txt'), txt.replace(/\n{3,}/g, '\n\n'), 'utf8'); } catch (e) {} }
    saved.push(`${label}: ok len=${html.length} links=${meta ? meta.links.length : 0}`);
    return { meta };
  };

  await save('00-dashboard', LMS_ORIGIN + '/');
  const courses = (prev && prev.courses) || [];
  const academic = courses.filter((c) => c.track !== false && !/폭력예방|인권|비교과/.test(c.name)).slice(0, 3);
  let i = 1;
  for (const c of academic) {
    const label = `${String(i * 10).padStart(2, '0')}-course-${c.id}`;
    await save(label, `${LMS_ORIGIN}/course/view.php?id=${c.id}`);
    // (ubfile 뷰어 페이지 캡처는 실제 파일 다운로드를 유발하므로 제거)
    // ubfile 파일 목록 페이지(리다이렉트 안 함) — 실제 다운로드 링크 확인용
    await save(label + '-ubfile-index', `${LMS_ORIGIN}/mod/ubfile/index.php?id=${c.id}`);
    // 과제 목록 + 제출 페이지 1개 — 제출 첨부 링크 구조 확인용
    const ar = await save(label + '-assign-index', `${LMS_ORIGIN}/mod/assign/index.php?id=${c.id}`);
    const assignLink = ar && ar.meta && ar.meta.links && ar.meta.links
      .map((x) => x.h).find((h) => /\/mod\/assign\/view\.php\?id=\d+/.test(h || ''));
    if (assignLink) await save(label + '-assign-view', assignLink);
    // 온라인 출석부(진도) — AJAX 로드 대기 후 캡처(+표 텍스트)
    await save(label + '-online', `${LMS_ORIGIN}/local/ubonattend/index.php?id=${c.id}`, 4000);
    i++;
  }
  try { dumpSes.removeListener('will-download', cancelDL); } catch (e) {}
  return { dir, saved };
}

// 로그인 세션(persist:lms)의 실제 브라우저 다운로드로 파일을 '임시 경로'에 받기.
// ubfile 처럼 view.php가 '첨부 다운로드'로만 파일을 주는 경우(net.request로는 강좌로 튕김) 사용.
// 호출측(main)이 임시파일을 읽어 해시 비교 후 최종 위치에 저장/덮어쓰기 결정.
function downloadToTemp(url) {
  return new Promise((resolve) => {
    const path = require('path');
    const os = require('os');
    const ses = lmsSession();
    let settled = false, downloading = false, win = null;
    const finish = (r) => {
      if (settled) return; settled = true;
      try { ses.removeListener('will-download', onWill); } catch (e) {}
      try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) {}
      resolve(r);
    };
    const onWill = (event, item) => {
      downloading = true;
      try {
        const name = (item.getFilename() || 'file').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'file';
        const tmp = path.join(os.tmpdir(), `studeck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${name}`);
        item.setSavePath(tmp);
        item.once('done', (e, state) => finish({ ok: state === 'completed', path: tmp, filename: name }));
      } catch (e) { finish({ ok: false, error: String(e && e.message || e) }); }
    };
    ses.on('will-download', onWill);
    win = new BrowserWindow({ show: false, webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.webContents.on('did-finish-load', () => setTimeout(() => { if (!downloading) finish({ ok: false, error: 'no-download' }); }, 2500));
    win.loadURL(url).catch(() => {});
    setTimeout(() => { if (!downloading) finish({ ok: false, error: 'timeout' }); }, 30000);
  });
}

module.exports = { openLoginWindow, openInSession, refresh, checkSession, dumpDebug, downloadToTemp, PARTITION };
