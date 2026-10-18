const { app, BrowserWindow, ipcMain, screen, Notification, shell, net, session, dialog } = require('electron');
const { CHANNEL, IS_LAB, PROFILE } = require('./channel'); // userData 분리를 위해 가장 먼저
const SERVER_MODE = !!PROFILE.serverSync; // 서버 동기화(계정·데이터·파일·커뮤니티). 꺼져 있으면 예전 GitHub 동기화
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const lms = require('./lms');
const { trackChanges, initializeOutbox, sharedSnapshot } = require('./sync-model');
const { atomicJSON, readShared } = require('./sync-storage');
const { createSyncService } = require('./sync-service');
const { autoResolve, describeConflicts, resolveConflicts } = require('./sync-conflicts');
const { preserveMaterial, archiveGitChanges } = require('./material-history');
const { preserveIncomingDeletions, wasDeletedFile } = require('./deleted-files');
const { untrackLocalMaterials, filterIncomingMaterials } = require('./local-materials');
const { createServerStore, serverCall } = require('./server-sync');
const { createFileSync, scanLocal } = require('./file-sync');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

let win = null;

// ---------- 설정 저장/불러오기 ----------
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  const value = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('설정 파일을 읽을 수 없습니다. 백업 복구가 필요합니다.');
  return value;
}
function saveConfig(cfg) { atomicJSON(CONFIG_PATH, cfg); }

// ---------- 창 생성 ----------
function createWindow() {
  const cfg = loadConfig();
  const disp = screen.getPrimaryDisplay().workAreaSize;
  const bounds = cfg.bounds || {
    width: 430,
    height: 640,
    x: disp.width - 450,
    y: 40,
  };
  // 너무 좁거나 낮게 저장된 경우 보정 (세로로 찌그러지는 것 방지)
  if (!(bounds.width >= 380)) bounds.width = 430;
  if (!(bounds.height >= 420)) bounds.height = 640;

  win = new BrowserWindow({
    ...bounds,
    minWidth: 300,
    minHeight: 300,
    icon: path.join(__dirname, PROFILE.icon),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'index.html'), { query: { channel: CHANNEL, server: SERVER_MODE ? '1' : '0' } });

  const persist = () => {
    if (!win) return;
    try { const c = loadConfig(); c.bounds = win.getBounds(); saveConfig(c); }
    catch (error) { win.webContents.send('sync-status', { phase: 'error', error: '기기 저장 실패: ' + error.message }); }
  };
  win.on('moved', persist);
  win.on('resized', persist);
  win.on('close', event => { if (!allowQuit) { event.preventDefault(); win.webContents.send('request-quit'); } });
  win.on('closed', () => (win = null));
}

// ---------- IPC ----------
ipcMain.handle('load-config', () => loadConfig());

ipcMain.handle('save-config', (_e, data, conflictBases) => {
  const old = loadConfig();
  const c = trackChanges(old, data);
  if (conflictBases) Object.assign(c.pendingShared, conflictBases);
  saveConfig(c);
  if (c.syncRevision !== old.syncRevision) syncService.changed();
  return c;
});

ipcMain.handle('import-syllabus', async () => {
  const parent = win;
  const wasOnTop = parent && parent.isAlwaysOnTop();
  try {
    // The screen-saver window level can cover macOS native file panels.
    if (wasOnTop) parent.setAlwaysOnTop(false);
    const choice = await dialog.showOpenDialog(parent, { title: '강의계획서 PDF 선택', properties: ['openFile'], filters: [{ name: '강의계획서 PDF', extensions: ['pdf'] }] });
    if (choice.canceled || !choice.filePaths.length) return { canceled: true };
    return { ok: true, ...await require('./syllabus-pdf').readSyllabus(choice.filePaths[0]) };
  } catch { return { ok: false, error: 'PDF를 읽지 못했습니다. 암호가 없고 20MB 이하인 PDF로 다시 시도해 주세요.' }; }
  finally { if (wasOnTop && parent && !parent.isDestroyed()) parent.setAlwaysOnTop(true, 'screen-saver'); }
});

ipcMain.on('set-opacity', (_e, value) => {
  if (win) win.setOpacity(Math.max(0.2, Math.min(1, value)));
});

ipcMain.on('set-always-on-top', (_e, flag) => {
  if (win) win.setAlwaysOnTop(!!flag, 'screen-saver');
});

let allowQuit = false;
ipcMain.on('close-app', () => { allowQuit = true; app.quit(); });
ipcMain.on('minimize-app', () => win && win.minimize());

let miniPrevBounds = null;
ipcMain.on('set-mini', (_e, on) => {
  if (!win) return;
  if (on) {
    miniPrevBounds = win.getBounds();
    const b = win.getBounds();
    win.setBounds({ x: b.x + b.width - 320, y: b.y, width: 320, height: 400 });
  } else if (miniPrevBounds) {
    win.setBounds(miniPrevBounds);
  }
});

// ---------- 윈도우 시작 시 자동 실행 ----------
ipcMain.handle('get-auto-start', () => {
  try { return !!app.getLoginItemSettings().openAtLogin; } catch { return false; }
});
ipcMain.handle('set-auto-start', (_e, on) => {
  try {
    const opts = { openAtLogin: !!on };
    if (!app.isPackaged) {
      // 개발(electron .) 모드에선 electron.exe + 프로젝트 경로를 명시해야 부팅 후 앱이 뜬다.
      opts.path = process.execPath;
      opts.args = [path.resolve(__dirname)];
    }
    app.setLoginItemSettings(opts);
    return !!app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    console.error('set-auto-start fail', e);
    return false;
  }
});

// ---------- 알림 ----------
ipcMain.on('notify', (_e, { title, body } = {}) => {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title: title || '알림', body: body || '' }).show();
  } catch (e) {
    console.error('notify fail', e);
  }
});

// ---------- LMS IPC ----------
ipcMain.handle('lms-login', async () => {
  const r = await lms.openLoginWindow();
  return r;
});

ipcMain.handle('lms-status', async () => {
  try {
    return await lms.checkSession();
  } catch (e) {
    return { valid: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('lms-refresh', async () => {
  const cfg = loadConfig();
  try {
    const result = await lms.refresh(cfg.lms || {});
    if (result.needLogin) {
      const c = loadConfig();
      c.lms = Object.assign({}, c.lms, { sessionValid: false });
      saveConfig(c);
      return { needLogin: true, lms: c.lms };
    }
    if (result.error) return { error: result.error, lms: cfg.lms || null };
    const c = loadConfig();
    c.lms = result;
    saveConfig(c);
    return { ok: true, lms: result };
  } catch (e) {
    return { error: String(e && e.message || e), lms: cfg.lms || null };
  }
});

// 과제(url)당 제출 창 1개만: 같은 과제를 또 누르면 기존 창을 닫고 새로 띄운다.
const subWindows = new Map(); // url -> BrowserWindow
ipcMain.on('lms-open', (_e, url) => {
  const existing = subWindows.get(url);
  if (existing && !existing.isDestroyed()) {
    existing._replacing = true;   // 교체로 닫는 것 → 제출확인 스킵
    try { existing.close(); } catch (e) {}
  }
  const w = lms.openInSession(url);
  subWindows.set(url, w);
  if (w && typeof w.on === 'function') {
    w.on('closed', () => {
      if (subWindows.get(url) === w) subWindows.delete(url);
      // 사용자가 직접 닫았을 때만(교체 아님) 자동 새로고침(제출→완료 전환) 트리거
      if (!w._replacing && win && !win.isDestroyed()) win.webContents.send('lms-submission-closed');
    });
  }
});

ipcMain.handle('lms-dump', async () => {
  const cfg = loadConfig();
  try {
    return await lms.dumpDebug(cfg.lms || {});
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
});

// ---------- 수업 자료 다운로드 / 폴더 (바탕화면\Studeck) ----------
const STUDECK_DIR = () => path.join(app.getPath('desktop'), PROFILE.studeckFolder);
function safeName(s) {
  return String(s || '').normalize('NFC').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '기타';
}
function parseCdFilename(cd) {
  if (!cd) return '';
  let m = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (m) { try { return decodeURIComponent(m[1].replace(/"/g, '').trim()); } catch (e) { return m[1].replace(/"/g, '').trim(); } }
  m = /filename="?([^";]+)"?/i.exec(cd);
  return m ? m[1].trim() : '';
}
function uniquePath(dir, filename) {
  if (!fs.existsSync(path.join(dir, filename))) return path.join(dir, filename);
  const ext = path.extname(filename), base = path.basename(filename, ext);
  let i = 2;
  while (fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) i++;
  return path.join(dir, `${base} (${i})${ext}`);
}
const hdr = (headers, k) => { const v = headers && headers[k]; return Array.isArray(v) ? v[0] : (v || ''); };
const EXT_BY_CT = {
  'application/pdf': '.pdf', 'application/haansofthwp': '.hwp', 'application/x-hwp': '.hwp',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls', 'application/zip': '.zip', 'application/haansofthwpx': '.hwpx',
  'image/png': '.png', 'image/jpeg': '.jpg', 'text/plain': '.txt',
};
function extFromCT(ct) { const key = String(ct || '').split(';')[0].trim().toLowerCase(); return EXT_BY_CT[key] || ''; }
// Moodle/coursemos 뷰어 HTML에서 실제 파일 링크 추출.
// pluginfile(첨부) 우선, ubfile/일반 download.php, 파일 확장자 직링크 순.
// 테마 로고·파비콘 등 화면 자산(pluginfile로도 서빙됨)은 제외.
function extractFileUrl(html, base) {
  html = html || '';
  const urls = [];
  const re = /(?:href|src|data)\s*=\s*["']([^"']+)["']/gi;
  let m; while ((m = re.exec(html))) urls.push(m[1].replace(/&amp;/g, '&'));
  const abs = (u) => { try { return new URL(u, base).href; } catch (e) { return u; } };
  const bad = (u) => /\/theme[_/]|\/favicon|\/logo|\/pix\/|image\.php/i.test(u);
  const pick = (test) => { const u = urls.find((x) => test(x) && !bad(x)); return u ? abs(u) : ''; };
  return pick((u) => /pluginfile\.php\/\d+\/mod_/i.test(u))          // 진짜 첨부(mod_ubfile/mod_resource 등)
    || pick((u) => /pluginfile\.php\//i.test(u))                     // 기타 pluginfile
    || pick((u) => /\/mod\/ubfile\/download\.php/i.test(u))
    || pick((u) => /download\.php\?/i.test(u))
    || pick((u) => /\.(pdf|hwpx?|pptx?|docx?|xlsx?|zip|txt|csv|mp3)(\?|$)/i.test(u));
}
// 수동 리다이렉트 추적 GET (최종 URL/헤더/본문 확보)
function httpGet(url, ses, maxRedirect, referer) {
  maxRedirect = maxRedirect == null ? 5 : maxRedirect;
  return new Promise((resolve) => {
    let done = false; const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const go = (u, n) => {
      let req;
      try { req = net.request({ url: u, session: ses, redirect: 'manual' }); }
      catch (e) { finish({ ok: false, error: String(e && e.message || e) }); return; }
      if (referer) { try { req.setHeader('Referer', referer); } catch (e) {} }
      req.on('response', (res) => {
        const sc = res.statusCode;
        const loc = hdr(res.headers, 'location');
        if (sc >= 300 && sc < 400 && loc && n > 0) {
          let next = loc; try { next = new URL(loc, u).href; } catch (e) {}
          res.on('data', () => {}); res.on('end', () => go(next, n - 1)); res.on('error', () => go(next, n - 1));
          return;
        }
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => finish({ ok: sc < 400, statusCode: sc, headers: res.headers, body: Buffer.concat(chunks), finalUrl: u }));
        res.on('error', (e) => finish({ ok: false, error: String(e) }));
      });
      req.on('error', (e) => finish({ ok: false, error: String(e && e.message || e) }));
      req.end();
    };
    go(url, maxRedirect);
  });
}
const sha1 = (buf) => require('crypto').createHash('sha1').update(buf).digest('hex');
// url 자료의 바이트를 얻는다: net.request 우선, 실패 시 브라우저 세션 다운로드(임시파일) 폴백.
async function fetchMaterialBytes(url, title) {
  const ses = session.fromPartition(lms.PARTITION);
  let body = null, ct = '', cd = '', fromUrl = url;
  const r = await httpGet(url, ses);
  if (r && r.ok) {
    ct = hdr(r.headers, 'content-type'); cd = hdr(r.headers, 'content-disposition'); body = r.body; fromUrl = r.finalUrl;
    if (/text\/html/i.test(ct) && !/attachment/i.test(cd)) {
      const isHtml = (rr) => /text\/html/i.test(hdr(rr && rr.headers, 'content-type'));
      const fileUrl = extractFileUrl(body.toString('utf8'), r.finalUrl);
      const r2 = fileUrl ? await httpGet(fileUrl, ses, 5, url) : null;
      if (!r2 || !r2.ok || isHtml(r2)) body = null;
      else { ct = hdr(r2.headers, 'content-type'); cd = hdr(r2.headers, 'content-disposition'); body = r2.body; fromUrl = r2.finalUrl; if (/text\/html/i.test(ct)) body = null; }
    }
  }
  if (body) {
    let filename = parseCdFilename(cd);
    if (!filename) { const u = decodeURIComponent((fromUrl.split('?')[0].split('/').pop()) || ''); filename = (/\.[a-z0-9]{2,5}$/i.test(u) && !/\.(php|acl|do|jsp)$/i.test(u)) ? u : (safeName(title) + (extFromCT(ct) || '.pdf')); }
    filename = safeName(filename);
    if (/\.(php|acl|do|jsp|htm|html)$/i.test(filename)) filename = safeName(title) + (extFromCT(ct) || '.pdf');
    return { body, filename };
  }
  // 브라우저 세션 다운로드 폴백(ubfile 등)
  try {
    const b = await lms.downloadToTemp(url);
    if (b && b.ok) { const buf = fs.readFileSync(b.path); try { fs.unlinkSync(b.path); } catch (e) {} return { body: buf, filename: safeName(b.filename || (safeName(title) + '.pdf')) }; }
  } catch (e) {}
  return null;
}
// mode: 'new'(신규) | 'recheck'(변경 감지). recheck는 dest(기존 경로)·prevSig 전달.
async function downloadMaterial(url, course, title, opts) {
  opts = opts || {};
  const got = await fetchMaterialBytes(url, title);
  if (!got || !got.body) return { url, ok: false, error: 'download-fail' };
  const sig = sha1(got.body);
  const dir = path.join(STUDECK_DIR(), safeName(course), opts.kind === 'assign' ? '과제' : '수업자료');
  const dest = opts.mode === 'recheck' && opts.dest ? opts.dest : path.join(dir, got.filename);
  try {
    const existed = fs.existsSync(dest);
    if (!existed && opts.kind === 'assign' && ((opts.mode === 'recheck' && opts.dest) || await wasDeletedFile(STUDECK_DIR(), dest))) {
      return { url, ok: true, path: dest, filename: path.basename(dest), sig, changed: false, existed: true, deleted: true };
    }
    const oldSig = existed ? sha1(fs.readFileSync(dest)) : null;
    if (existed && oldSig === sig) return { url, ok: true, path: dest, filename: path.basename(dest), sig, changed: false, existed: true };
    if (existed && opts.kind === 'assign') {
      const backup = path.join(STUDECK_DIR(), '.studeck', 'backups', 'submissions', safeName(course));
      fs.mkdirSync(backup, { recursive: true });
      fs.copyFileSync(dest, path.join(backup, oldSig + '-' + path.basename(dest)));
    }
    if (existed && opts.kind !== 'assign') preserveMaterial(STUDECK_DIR(), path.relative(STUDECK_DIR(), dest), fs.readFileSync(dest));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, got.body);
    return { url, ok: true, path: dest, filename: path.basename(dest), sig, changed: existed };
  } catch (e) { return { url, ok: false, error: String(e && e.message || e) }; }
}
ipcMain.handle('lms-download', async (_e, items) => {
  const out = [];
  for (const it of (items || [])) out.push(await downloadMaterial(it.url, it.course, it.title, { mode: it.mode, dest: it.dest, prevSig: it.sig, kind: it.kind }));
  return out;
});
const CAT_DIR = { materials: '수업자료', aux: '보조자료', assignment: '과제' };
ipcMain.handle('open-studeck-folder', (_e, { kind, course } = {}) => {
  try {
    let dir = STUDECK_DIR();
    if (kind === 'subject') dir = path.join(dir, safeName(course));
    else if (CAT_DIR[kind]) dir = path.join(dir, safeName(course), CAT_DIR[kind]);
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return { ok: true, dir };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// 예전 '분류 먼저'(수업자료/과목) 구조를 '과목 먼저'(과목/수업자료)로 1회 이동
function migrateFolders() {
  try {
    const base = STUDECK_DIR();
    if (!fs.existsSync(base)) return;
    const marker = path.join(base, '.studeck-migrated');
    if (fs.existsSync(marker)) return;
    const cats = ['수업자료', '보조자료', '과제'];
    for (const cat of cats) {
      const catDir = path.join(base, cat);
      if (!fs.existsSync(catDir) || !fs.statSync(catDir).isDirectory()) continue;
      for (const course of fs.readdirSync(catDir)) {
        const from = path.join(catDir, course);
        try { if (!fs.statSync(from).isDirectory()) continue; } catch (e) { continue; }
        const to = path.join(base, safeName(course), cat);
        try {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          if (!fs.existsSync(to)) fs.renameSync(from, to);
          else { for (const f of fs.readdirSync(from)) { try { fs.renameSync(path.join(from, f), path.join(to, f)); } catch (e) {} } }
        } catch (e) { /* 개별 실패 무시 */ }
      }
      try { if (!fs.readdirSync(catDir).length) fs.rmdirSync(catDir); } catch (e) {}
    }
    try { fs.writeFileSync(marker, new Date().toISOString(), 'utf8'); } catch (e) {}
  } catch (e) { console.error('migrateFolders fail', e); }
}

// ---------- GitHub 동기화 (파일: 수업자료/보조자료/과제) ----------
function git(args, cwd) {
  // credential.helper='' → Windows Git Credential Manager를 꺼서 로그인 팝업 방지(토큰은 원격 URL에 있음).
  // GIT_TERMINAL_PROMPT/GCM 환경변수 → 어떤 대화형 자격증명 프롬프트도 뜨지 않게.
  const full = ['-c', 'credential.helper=', ...args];
  const env = Object.assign({}, process.env, {
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  });
  return new Promise((resolve) => {
    execFile('git', full, { cwd, windowsHide: true, timeout: 120000, env, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || '').toString(), err: (stderr || (err && err.message) || '').toString() });
    });
  });
}
const gitRemote = (repo, token) => `https://x-access-token:${token}@github.com/${repo}.git`;
const redact = (s, token) => (token ? String(s || '').split(token).join('***') : String(s || ''));
async function ensureRepo(dir, repo, token) {
  fs.mkdirSync(dir, { recursive: true });
  const checked = async (args) => {
    const r = await git(args, dir);
    if (!r.ok) throw new Error(redact(r.err || r.out || 'Git 실행 실패', token));
  };
  if (!fs.existsSync(path.join(dir, '.git'))) {
    await checked(['init']);
    await checked(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  }
  await checked(['config', 'user.email', 'studeck@local']);
  await checked(['config', 'user.name', 'Studeck']);
  const ignorePath = path.join(dir, '.gitignore');
  const old = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf8') : '';
  const missing = ['.studeck-migrated', '.studeck/backups/', '.DS_Store', '/삭제한 파일/', '/*/수업자료/', '/*/수업자료/'.normalize('NFD')].filter(x => !old.split(/\r?\n/).includes(x));
  if (missing.length) fs.appendFileSync(ignorePath, (old && !old.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
  await checked(['rm', '-r', '--cached', '--ignore-unmatch', '--', '삭제한 파일']);
  await untrackLocalMaterials(dir);
  const remote = await git(['remote', 'get-url', 'origin'], dir);
  await checked(['remote', remote.ok ? 'set-url' : 'add', 'origin', gitRemote(repo, token)]);
}
let syncQueue = Promise.resolve();
function gitSync(dir, repo, token) {
  const run = async () => {
    await ensureRepo(dir, repo, token);
    const fail = r => ({ ok: false, error: redact([r.err, r.out].filter(Boolean).join('\n') || 'Git 실행 실패', token).slice(-1000) });
    const conflicts = await git(['diff', '--name-only', '--diff-filter=U'], dir);
    if (!conflicts.ok) return fail(conflicts);
    if (conflicts.out.trim()) {
      await autoResolve(dir);
      if ((await git(['ls-files', '-u'], dir)).out.trim()) return { ok: false, error: '파일 충돌을 먼저 해결해야 합니다. 자동 업로드를 중단했습니다.' };
    }
    readShared(path.join(dir, '.studeck/config.json'));
    await archiveGitChanges(dir);
    const add = await git(['add', '-A'], dir);
    if (!add.ok) return fail(add);
    const diff = await git(['diff', '--cached', '--quiet'], dir);
    if (!diff.ok) {
      const commit = await git(['commit', '-m', 'studeck sync ' + new Date().toISOString().slice(0, 19)], dir);
      if (!commit.ok) return fail(commit);
    }
    const remote = await git(['ls-remote', '--heads', 'origin', 'main'], dir);
    if (!remote.ok) return fail(remote);
    if (remote.out.trim()) {
      // Explicit merge policy is required by modern Git for independently initialized devices.
      const fetched = await git(['fetch', 'origin', 'main'], dir);
      if (!fetched.ok) return fail(fetched);
      const incoming = await filterIncomingMaterials(dir);
      await archiveGitChanges(dir, true, incoming);
      const stagedHistory = await git(['add', '-A'], dir);
      if (!stagedHistory.ok) return fail(stagedHistory);
      if (!(await git(['diff', '--cached', '--quiet'], dir)).ok) {
        const historyCommit = await git(['commit', '-m', 'Preserve previous materials'], dir);
        if (!historyCommit.ok) return fail(historyCommit);
      }
      await preserveIncomingDeletions(dir, incoming);
      const pull = await git(['merge', '--allow-unrelated-histories', incoming, '--no-edit'], dir);
      if (!pull.ok) {
        await autoResolve(dir);
        if ((await git(['ls-files', '-u'], dir)).out.trim()) return fail(pull);
        // A merge can fail without creating conflict entries (e.g. a locked file).
        const check = await git(['merge-base', '--is-ancestor', incoming, 'HEAD'], dir);
        if (!check.ok) return fail(pull);
      }
    }
    readShared(path.join(dir, '.studeck/config.json'));
    const push = await git(['push', '-u', 'origin', 'main'], dir);
    return push.ok ? { ok: true } : fail(push);
  };
  const result = syncQueue.then(run);
  syncQueue = result.catch(() => {});
  return result;
}
const SYNC_DATA_PATH = () => path.join(STUDECK_DIR(), '.studeck', 'config.json');
const notifySync = status => { if (win && !win.isDestroyed()) win.webContents.send('sync-status', status); };
// 서버 모드: 같은 병합 엔진에 전송부만 서버로 바꾼다(보조자료·과제 파일은 fileSync가 따로 맞춤).
const serverStore = SERVER_MODE ? createServerStore({ file: path.join(app.getPath('userData'), 'server-mirror.json') }) : null;
// 서버 모드: 보조자료·과제 파일을 서버 개인 공간과 맞춘다(서버에서 지워진 파일은 기기 휴지통으로).
const fileSync = SERVER_MODE ? createFileSync({ root: STUDECK_DIR, stateFile: path.join(app.getPath('userData'), 'file-sync.json'), trash: p => shell.trashItem(p) }) : null;
const syncService = createSyncService(SERVER_MODE ? {
  load: loadConfig, save: saveConfig,
  read: serverStore.read, write: serverStore.write, transport: serverStore.transport,
  conflicts: async () => null, resolveFiles: async () => {}, dirty: async () => false, autoResolve: 'local',
  notify: notifySync,
} : {
  load: loadConfig, save: saveConfig,
  read: () => readShared(SYNC_DATA_PATH()),
  write: value => atomicJSON(SYNC_DATA_PATH(), value, path.join(STUDECK_DIR(), '.studeck/backups/writes')),
  transport: s => gitSync(STUDECK_DIR(), s.repo, s.token),
  conflicts: () => describeConflicts(STUDECK_DIR()),
  resolveFiles: choice => resolveConflicts(STUDECK_DIR(), choice),
  dirty: async () => { const r = await git(['status', '--porcelain'], STUDECK_DIR()); if (!r.ok) throw new Error('파일 상태 확인 실패'); return !!r.out.trim(); },
  notify: notifySync,
});
// ---------- 실험실 서버 계정(가입·로그인·로그아웃). 비밀번호는 저장하지 않고 기기 토큰만 둔다. ----------
const SERVER_ERRORS = { bad_username: '아이디는 학번(숫자 8~10자리)입니다.', bad_name: '이름을 2~20자로 입력해 주세요.', weak_password: '비밀번호는 8자 이상이어야 합니다.',
  username_taken: '이미 있는 아이디입니다.', bad_credentials: '아이디 또는 비밀번호가 틀렸습니다.', not_approved: '운영진 승인 대기 중입니다.',
  suspended: '정지된 계정입니다. 운영진에게 문의하세요.', deleted: '삭제(탈퇴)된 계정입니다. 30일 안에는 운영진이 복구할 수 있습니다.',
  consent_required: '이용 안내에 동의해야 가입할 수 있습니다.', locked: '비밀번호를 여러 번 틀려 잠시 잠겼습니다. 15분 뒤 다시 시도하세요.',
  too_many: '시도가 너무 많습니다. 잠시 뒤 다시 시도하세요.', github_mismatch: '이 학번에 연결된 GitHub 계정과 다릅니다(또는 GitHub이 연결되지 않은 계정).',
  github_failed: 'GitHub 정보를 확인하지 못했습니다.', github_taken: '이 GitHub 계정은 다른 회원에게 이미 연결돼 있습니다.',
  owner_cannot_withdraw: '최고 관리자는 탈퇴할 수 없습니다.', outranked: '같거나 높은 등급의 회원은 바꿀 수 없습니다.', self: '자기 자신은 바꿀 수 없습니다.',
  owner_only: '최고 관리자만 할 수 있습니다.', bad_state: '지금 상태에서는 할 수 없는 작업입니다.' };
const serverError = (r, fallback) => SERVER_ERRORS[r.json.error] || r.json.message || fallback + ' (' + r.status + ')';
async function serverTry(fn) {
  try { return await fn(); }
  catch (e) { return { ok: false, error: e.name === 'TimeoutError' || /fetch failed/.test(e.message) ? '서버에 연결할 수 없습니다(Tailscale 연결 확인).' : e.message }; }
}
ipcMain.handle('server-signup', (_e, { username, password, displayName, consent } = {}) => serverTry(async () => {
  if (!SERVER_MODE) return { ok: false, error: '서버 동기화를 쓰지 않는 버전입니다.' };
  const r = await serverCall(PROFILE.serverUrl, 'POST', '/auth/signup', { username, password, displayName, consent });
  if (r.status !== 201) return { ok: false, error: serverError(r, '가입 실패') };
  return { ok: true, status: r.json.user.status };
}));
ipcMain.handle('server-login', (_e, { username, password } = {}) => serverTry(async () => {
  if (!SERVER_MODE) return { ok: false, error: '서버 동기화를 쓰지 않는 버전입니다.' };
  if (syncService.isRunning()) return { ok: false, error: '진행 중인 동기화가 끝난 뒤 다시 시도해 주세요.' };
  const r = await serverCall(PROFILE.serverUrl, 'POST', '/auth/login', { username, password, deviceName: require('os').hostname() + ' (' + process.platform + ')' });
  if (r.status !== 200) return { ok: false, error: serverError(r, '로그인 실패') };
  const c = loadConfig();
  c.sync = { enabled: true, mode: 'server', url: PROFILE.serverUrl, username: r.json.user.username, displayName: r.json.user.displayName, role: r.json.user.role, token: r.json.token };
  saveConfig(c);
  return { ok: true, user: r.json.user };
}));
// 서버에서 내 역할(운영진 여부)을 다시 받아 저장한다(역할이 바뀌었거나 예전 로그인일 때).
ipcMain.handle('server-refresh-me', () => serverTry(async () => {
  const c = loadConfig(), s = c.sync || {};
  if (!SERVER_MODE || !s.token) return { ok: false };
  const res = await fetch(s.url + '/me', { headers: { authorization: 'Bearer ' + s.token }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { ok: false, status: res.status };
  const { user } = await res.json();
  if (user.role !== s.role || user.displayName !== s.displayName) { c.sync = { ...s, role: user.role, displayName: user.displayName }; saveConfig(c); }
  return { ok: true, role: user.role, mustChangePassword: !!user.mustChangePassword };
}));
// 운영진: 가입 신청 목록·승인·거절(로그인한 기기 토큰으로 호출)
ipcMain.handle('admin-users', () => serverTry(async () => {
  const s = loadConfig().sync || {};
  if (!SERVER_MODE || !s.token) return { ok: false, error: '로그인이 필요합니다.' };
  const res = await fetch(s.url + '/admin/users', { headers: { authorization: 'Bearer ' + s.token }, signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  if (res.status === 403) return { ok: false, error: '운영진만 볼 수 있습니다.', notAdmin: true };
  if (!res.ok) return { ok: false, error: '목록을 불러오지 못했습니다 (' + res.status + ')' };
  return { ok: true, users: json.users };
}));
ipcMain.handle('admin-action', (_e, { id, action, role } = {}) => serverTry(async () => {
  const s = loadConfig().sync || {};
  if (!SERVER_MODE || !s.token || !['approve', 'reject', 'suspend', 'delete', 'restore', 'temp-password', 'role'].includes(action)) return { ok: false, error: '잘못된 요청입니다.' };
  const r = await serverCall(s.url, 'POST', '/admin/users/' + Number(id) + '/' + action, action === 'role' ? { role } : {}, s.token);
  if (r.status !== 200) return { ok: false, error: serverError(r, '처리 실패') };
  return { ok: true, user: r.json.user, tempPassword: r.json.tempPassword };
}));
// ---------- 내 계정 ----------
async function accountCall(method, url, body) {
  const s = loadConfig().sync || {};
  if (!SERVER_MODE || !s.token) return { ok: false, error: '로그인이 필요합니다.' };
  const r = method === 'GET'
    ? await fetch(s.url + url, { headers: { authorization: 'Bearer ' + s.token }, signal: AbortSignal.timeout(15000) }).then(async x => ({ status: x.status, json: await x.json().catch(() => ({})) }))
    : await serverCall(s.url, method, url, body, s.token);
  if (r.status !== 200) return { ok: false, error: serverError(r, '처리 실패') };
  return { ok: true, ...r.json };
}
ipcMain.handle('account-me', () => serverTry(() => accountCall('GET', '/me')));
ipcMain.handle('account-password', (_e, { current, next } = {}) => serverTry(() => accountCall('POST', '/me/password', { current, next })));
ipcMain.handle('account-withdraw', (_e, { password } = {}) => serverTry(async () => {
  const r = await accountCall('POST', '/me/withdraw', { password });
  if (r.ok) { const c = loadConfig(); c.sync = { ...(c.sync || {}), enabled: false, token: '' }; saveConfig(c); }
  return r;
}));
ipcMain.handle('account-github-link', (_e, accessToken) => serverTry(() => accountCall('POST', '/me/github', { accessToken })));
ipcMain.handle('account-github-unlink', () => serverTry(() => accountCall('DELETE', '/me/github', {})));
ipcMain.handle('github-reset', (_e, { username, accessToken, newPassword } = {}) => serverTry(async () => {
  const r = await serverCall(PROFILE.serverUrl, 'POST', '/auth/github-reset', { username, accessToken, newPassword });
  if (r.status !== 200) return { ok: false, error: serverError(r, '비밀번호 찾기 실패') };
  return { ok: true };
}));
// GitHub 기기 인증(device flow): 앱에 코드가 뜨면 github.com/login/device에서 입력. 받은 토큰은 서버 확인에만 쓰고 저장하지 않는다.
ipcMain.handle('github-device-start', () => serverTry(async () => {
  if (!PROFILE.githubClientId) return { ok: false, error: 'GitHub 연결이 아직 준비되지 않았습니다(Client ID 미설정).' };
  const res = await fetch('https://github.com/login/device/code', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: PROFILE.githubClientId, scope: 'read:user user:email' }), signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  if (!j.device_code) return { ok: false, error: 'GitHub 인증을 시작하지 못했습니다: ' + (j.error_description || j.error || res.status) };
  shell.openExternal(j.verification_uri);
  return { ok: true, userCode: j.user_code, verificationUri: j.verification_uri, deviceCode: j.device_code, interval: j.interval || 5, expiresIn: j.expires_in };
}));
ipcMain.handle('github-device-poll', (_e, deviceCode) => serverTry(async () => {
  const res = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: PROFILE.githubClientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }), signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  if (j.access_token) return { ok: true, accessToken: j.access_token };
  if (j.error === 'authorization_pending' || j.error === 'slow_down') return { ok: false, pending: true, slowDown: j.error === 'slow_down' };
  return { ok: false, error: j.error === 'expired_token' ? '시간이 지나 코드가 만료됐습니다. 다시 시도하세요.' : j.error === 'access_denied' ? 'GitHub에서 거부했습니다.' : 'GitHub 인증 실패: ' + (j.error || res.status) };
}));
// ---------- 커뮤니티(공지·채팅·프로필) ----------
// 허용된 경로만 대신 호출한다(토큰은 main에서 붙임).
const COMMUNITY_PATH = /^\/(notices|rooms|messages|profiles|me\/profile)(\/[\w-]+)*(\/messages)?(\?[\w=&-]*)?$/;
ipcMain.handle('community-call', (_e, { method, path: p, body } = {}) => serverTry(async () => {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !COMMUNITY_PATH.test(String(p))) return { ok: false, error: '잘못된 요청입니다.' };
  return accountCall(method, p, body || {});
}));
ipcMain.handle('community-socket-info', () => {
  const s = loadConfig().sync || {};
  if (!SERVER_MODE || !s.enabled || !s.token) return { ok: false };
  return { ok: true, wsUrl: s.url.replace(/^http/, 'ws') + '/ws', token: s.token };
});
ipcMain.handle('community-upload', (_e, bytes) => serverTry(async () => {
  const s = loadConfig().sync || {};
  if (!SERVER_MODE || !s.token) return { ok: false, error: '로그인이 필요합니다.' };
  const res = await fetch(s.url + '/media', { method: 'POST', headers: { authorization: 'Bearer ' + s.token, 'content-type': 'application/octet-stream' },
    body: Buffer.from(bytes), signal: AbortSignal.timeout(60000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json.error === 'not_image' ? '사진 파일만 올릴 수 있어요.' : res.status === 413 ? '사진이 너무 커요(10MB 초과).' : '사진 올리기 실패(' + res.status + ')' };
  return { ok: true, sha: json.sha };
}));
// 사진은 내용 해시가 이름이라 바뀌지 않으므로 기기에 캐시한다.
ipcMain.handle('community-media', (_e, sha) => serverTry(async () => {
  if (!/^[0-9a-f]{64}$/.test(String(sha))) return { ok: false };
  const cacheDir = path.join(app.getPath('userData'), 'media-cache'), file = path.join(cacheDir, sha);
  const mimeFile = file + '.type';
  if (!fs.existsSync(file)) {
    const s = loadConfig().sync || {};
    if (!s.token) return { ok: false };
    const res = await fetch(s.url + '/media/' + sha, { headers: { authorization: 'Bearer ' + s.token }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) return { ok: false };
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    fs.writeFileSync(mimeFile, res.headers.get('content-type') || 'image/jpeg');
  }
  const mime = fs.existsSync(mimeFile) ? fs.readFileSync(mimeFile, 'utf8') : 'image/jpeg';
  return { ok: true, dataUrl: 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64') };
}));
// 운영 앱 데이터를 실험실로 복사(운영 설정 파일은 읽기만 한다). 가져온 내용은 미전송 변경이 되어 서버로 올라간다.
ipcMain.handle('import-prod-data', () => {
  if (!IS_LAB) return { ok: false, error: '실험실 앱 전용입니다.' };
  try {
    const prodFile = path.join(app.getPath('appData'), 'everytime-widget', 'config.json');
    const prod = JSON.parse(fs.readFileSync(prodFile, 'utf8'));
    const patch = sharedSnapshot(prod);
    saveConfig(trackChanges(loadConfig(), patch));
    let copied = 0;
    const prodDir = path.join(app.getPath('desktop'), 'Studeck');
    for (const [rel, f] of Object.entries(scanLocal(prodDir, 50 * 1024 * 1024).files)) {
      const dest = path.join(STUDECK_DIR(), ...rel.split('/'));
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.abs, dest); fs.utimesSync(dest, new Date(f.mtimeMs), new Date(f.mtimeMs));
      copied++;
    }
    return { ok: true, todos: (patch.todos || []).length, events: (patch.events || []).length, courses: (patch.timetableFull || []).length, files: copied };
  } catch (e) { return { ok: false, error: '운영 앱 데이터를 읽지 못했습니다: ' + e.message }; }
});
ipcMain.handle('server-logout', () => serverTry(async () => {
  if (syncService.isRunning()) return { ok: false, error: '동기화 중입니다.' };
  const c = loadConfig(), s = c.sync || {};
  if (s.token) await serverCall(s.url, 'POST', '/auth/logout', {}, s.token).catch(() => {});
  c.sync = { enabled: false, mode: 'server', url: s.url || PROFILE.serverUrl, username: s.username || '', token: '' };
  saveConfig(c);
  return { ok: true };
}));
ipcMain.handle('git-connect', async (_e, { repo, token } = {}) => {
  if (SERVER_MODE) return { ok: false, error: '이 버전은 GitHub 동기화 대신 Studeck 서버로 동기화합니다.' };
  if (syncService.isRunning()) return { ok: false, error: '진행 중인 동기화가 끝난 뒤 연결을 바꿔 주세요.' };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '') || !token) return { ok: false, error: '저장소(owner/repo)와 토큰을 확인해 주세요.' };
  const c = loadConfig(); c.sync = { repo, token, enabled: true }; saveConfig(c);
  return { ok: true };
});
// 실험실은 서버(데이터 → 파일 순서), 운영은 GitHub
ipcMain.handle('git-sync', async (_e, resolution) => {
  // 처음 서버와 맞추는 기기: 서버가 비어 있으면 이 기기 데이터를 올리고(첫 기기),
  // 이미 데이터가 있으면 서버 데이터로 시작한다(다른 기기의 옛 데이터로 덮어쓰지 않음).
  const pre = loadConfig().sync || {};
  if (SERVER_MODE && pre.enabled && pre.token && serverStore.isFresh(pre) && !syncService.isRunning()) {
    const first = await serverStore.transport(pre);
    if (!first.ok) return { ok: false, error: first.error };
    if (Object.keys(serverStore.read()).length) {
      const c = loadConfig(); c.pendingShared = {}; saveConfig(c);
      notifySync({ phase: 'syncing', error: '', conflicts: null, adopted: true });
    }
  }
  const result = await syncService.run(resolution);
  if (!SERVER_MODE || !result?.ok) return result;
  const conn = loadConfig().sync || {};
  if (!conn.enabled || !conn.token) return result;
  const files = await fileSync.run(conn);
  return { ...result, files };
});
// 실험실 서버 파일: 사용량·휴지통·복구·이전 버전·되돌리기(복구·되돌린 내용은 다음 동기화 때 기기에 받아진다)
async function fileApi(method, url, body) {
  const s = loadConfig().sync || {};
  if (!SERVER_MODE || !s.token) throw new Error('로그인이 필요합니다.');
  const res = await fetch(s.url + url, { method, headers: { authorization: 'Bearer ' + s.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error === 'not_found' ? '서버에 해당 파일이 없습니다.' : '파일 서버 오류(' + res.status + ')');
  return json;
}
ipcMain.handle('files-overview', () => serverTry(async () => {
  const [usage, trash] = await Promise.all([fileApi('GET', '/files/usage'), fileApi('GET', '/files/trash')]);
  const current = Object.entries(fileSync.remoteFiles()).filter(([, f]) => !f.deleted).map(([p, f]) => ({ path: p, size: f.size, updatedAt: f.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return { ok: true, usage, trash: trash.trash, current };
}));
ipcMain.handle('files-versions', (_e, p) => serverTry(async () => ({ ok: true, ...(await fileApi('GET', '/files/versions?path=' + encodeURIComponent(p))) })));
ipcMain.handle('files-restore', (_e, p) => serverTry(async () => ({ ok: true, ...(await fileApi('POST', '/files/restore', { path: p })) })));
ipcMain.handle('files-revert', (_e, { path: p, vid } = {}) => serverTry(async () => ({ ok: true, ...(await fileApi('POST', '/files/revert', { path: p, vid })) })));
ipcMain.handle('git-sync-status', () => {
  const s = (loadConfig().sync) || {};
  if (SERVER_MODE) return { ...syncService.status(), enabled: !!s.enabled, mode: 'server', server: PROFILE.serverUrl, username: s.username || '', displayName: s.displayName || '', role: s.role || 'member', hasToken: !!s.token };
  return { ...syncService.status(), enabled: !!s.enabled, repo: s.repo || '', hasToken: !!s.token, gitDir: fs.existsSync(path.join(STUDECK_DIR(), '.git')) };
});
ipcMain.handle('git-disconnect', () => { if (syncService.isRunning()) return { ok: false, error: '동기화 중입니다.' }; const c = loadConfig(); c.sync = { enabled: false, repo: c.sync?.repo || '', token: '' }; saveConfig(c); return { ok: true }; });

// 주기적 자동 백업: config.json을 7일마다 backups/에 복사, 최근 5개 유지
function autoBackup() {
  try {
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const list = () => fs.readdirSync(dir).filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    const files = list();
    const latest = files.length ? files[files.length - 1] : null;
    let need = true;
    if (latest) { const m = latest.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); if (Date.now() - d.getTime() < 7 * 86400000) need = false; } }
    if (need && fs.existsSync(CONFIG_PATH)) {
      const t = new Date();
      const name = `backup-${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}.json`;
      fs.copyFileSync(CONFIG_PATH, path.join(dir, name));
      const after = list();
      while (after.length > 5) { try { fs.unlinkSync(path.join(dir, after.shift())); } catch (e) {} }
      console.log('config auto-backed up:', name);
    }
  } catch (e) { console.error('backup fail', e); }
}

// 단일 인스턴스: 이미 실행 중이면 두 번째 프로세스는 즉시 종료하고
// 기존 창을 앞으로 가져온다(자동 실행 + 수동 실행 중복 등으로 창 2개 뜨는 것 방지).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) createWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(PROFILE.appUserModelId);
    autoBackup();
    migrateFolders();
    try {
      const cfg = loadConfig();
      if (!cfg.pendingShared) {
        let baseline = {};
        try { baseline = readShared(SYNC_DATA_PATH()); } catch { /* Keep legacy local data pending until the conflict is resolved. */ }
        saveConfig(initializeOutbox(cfg, baseline));
      }
      // 서버 모드로 처음 켜졌는데 예전 GitHub 동기화 설정이 있으면: 로그인 전 상태로 바꾸고 GitHub 토큰은 지운다.
      // 할 일·일정·시간표 등 데이터는 그대로 두었다가 로그인하면 서버로 올라간다(서버가 비어 있을 때).
      const now = loadConfig();
      if (SERVER_MODE && now.sync && now.sync.mode !== 'server') {
        now.sync = { enabled: false, mode: 'server', url: PROFILE.serverUrl, username: '', token: '', migratedFromGithub: !!now.sync.repo };
        saveConfig(now);
      }
      createWindow();
    }
    catch (error) { dialog.showErrorBox('설정 파일 확인 필요', error.message + '\n기존 설정 파일은 보존했습니다.'); allowQuit = true; app.quit(); }
  });
}

// Hidden LMS pages must not cancel quit via beforeunload and leave a windowless app.
app.on('before-quit', event => {
  if (!allowQuit && win && !win.isDestroyed()) { event.preventDefault(); win.webContents.send('request-quit'); return; }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isVisible()) window.destroy();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
