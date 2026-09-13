const { app, BrowserWindow, ipcMain, screen, Notification, shell, net, session } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');
const lms = require('./lms');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

let win = null;

// ---------- 설정 저장/불러오기 ----------
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('config save fail', e);
  }
}

// ---------- 에브리타임 공유 링크 → 식별자 추출 ----------
function extractIdentifier(input) {
  if (!input) return '';
  const s = String(input).trim();
  // everytime.kr/@Abc123  또는  @Abc123  또는  Abc123
  const m = s.match(/@([A-Za-z0-9]+)/);
  if (m) return m[1];
  // URL 마지막 경로 조각
  const parts = s.replace(/[?#].*$/, '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

// ---------- 아주 작은 XML 파서 (에브리타임 응답 전용) ----------
function decodeEntities(str) {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? decodeEntities(m[1]) : '';
}

function parseTimetable(xml) {
  const subjects = [];
  const subjectBlocks = xml.match(/<subject[\s\S]*?<\/subject>/g) || [];
  for (const block of subjectBlocks) {
    const nameTag = block.match(/<name[^>]*>/);
    const profTag = block.match(/<professor[^>]*>/);
    const name = nameTag ? attr(nameTag[0], 'value') : '';
    const professor = profTag ? attr(profTag[0], 'value') : '';

    const dataTags = block.match(/<data[^>]*\/?>/g) || [];
    const times = [];
    for (const d of dataTags) {
      const day = parseInt(attr(d, 'day'), 10);
      const start = parseInt(attr(d, 'starttime'), 10);
      const end = parseInt(attr(d, 'endtime'), 10);
      const place = attr(d, 'place');
      if (Number.isNaN(day) || Number.isNaN(start) || Number.isNaN(end)) continue;
      times.push({ day, start, end, place });
    }
    if (name || times.length) subjects.push({ name, professor, times });
  }
  return subjects;
}

// ---------- 에브리타임 API 호출 ----------
function fetchTimetable(identifier) {
  return new Promise((resolve, reject) => {
    const id = extractIdentifier(identifier);
    if (!id) return reject(new Error('식별자가 비어 있습니다.'));

    const body = `identifier=${encodeURIComponent(id)}&friendInfo=true`;
    const options = {
      hostname: 'api.everytime.kr',
      path: '/find/timetable/table/friend',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EverytimeWidget/1.0',
        'Accept': '*/*',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`서버 응답 오류 (HTTP ${res.statusCode}). 공유 링크가 맞는지, 시간표가 '공개'로 공유됐는지 확인해 주세요.`));
        }
        if (/<error/i.test(data)) {
          return reject(new Error('에브리타임에서 오류를 반환했습니다. 공유 링크(식별자)가 유효하지 않거나 비공개일 수 있어요.'));
        }
        const subjects = parseTimetable(data);
        if (!subjects.length) {
          return reject(new Error('시간표에서 과목을 찾지 못했습니다. 공유 링크가 맞는지 확인해 주세요.'));
        }
        resolve(subjects);
      });
    });
    req.on('error', (e) => reject(new Error('네트워크 오류: ' + e.message)));
    req.write(body);
    req.end();
  });
}

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
    icon: path.join(__dirname, 'icon.ico'),
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
  win.loadFile('index.html');

  const persist = () => {
    if (!win) return;
    const c = loadConfig();
    c.bounds = win.getBounds();
    saveConfig(c);
  };
  win.on('moved', persist);
  win.on('resized', persist);
  win.on('closed', () => (win = null));
}

// ---------- IPC ----------
ipcMain.handle('load-config', () => loadConfig());

ipcMain.handle('save-config', (_e, data) => {
  const c = loadConfig();
  Object.assign(c, data);
  saveConfig(c);
  return c;
});

ipcMain.handle('fetch-timetable', async (_e, identifier) => {
  try {
    const subjects = await fetchTimetable(identifier);
    return { ok: true, subjects };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.on('set-opacity', (_e, value) => {
  if (win) win.setOpacity(Math.max(0.2, Math.min(1, value)));
});

ipcMain.on('set-always-on-top', (_e, flag) => {
  if (win) win.setAlwaysOnTop(!!flag, 'screen-saver');
});

ipcMain.on('close-app', () => app.quit());
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
const STUDECK_DIR = () => path.join(app.getPath('desktop'), 'Studeck');
function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '기타';
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
// Moodle/coursemos 뷰어 HTML에서 실제 파일(pluginfile) 링크 추출
function extractFileUrl(html, base) {
  const m = /(?:href|src|data)\s*=\s*["']([^"']*pluginfile\.php\/[^"']+)["']/i.exec(html || '');
  if (!m) return '';
  let u = m[1].replace(/&amp;/g, '&');
  try { u = new URL(u, base).href; } catch (e) {}
  return u;
}
// 수동 리다이렉트 추적 GET (최종 URL/헤더/본문 확보)
function httpGet(url, ses, maxRedirect) {
  maxRedirect = maxRedirect == null ? 5 : maxRedirect;
  return new Promise((resolve) => {
    let done = false; const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const go = (u, n) => {
      let req;
      try { req = net.request({ url: u, session: ses, redirect: 'manual' }); }
      catch (e) { finish({ ok: false, error: String(e && e.message || e) }); return; }
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
async function downloadMaterial(url, course, title) {
  const ses = session.fromPartition(lms.PARTITION);
  let r = await httpGet(url, ses);
  if (!r || !r.ok) return { url, ok: false, status: r && r.statusCode, error: r && r.error };
  let ct = hdr(r.headers, 'content-type');
  let cd = hdr(r.headers, 'content-disposition');
  let body = r.body, fromUrl = r.finalUrl;
  // 뷰어 HTML이면 실제 파일 링크를 찾아 한 번 더 받는다
  if (/text\/html/i.test(ct) && !/attachment/i.test(cd)) {
    const fileUrl = extractFileUrl(body.toString('utf8'), r.finalUrl);
    if (!fileUrl) return { url, ok: false, error: 'no-file-link' };
    const r2 = await httpGet(fileUrl, ses);
    if (!r2 || !r2.ok) return { url, ok: false, status: r2 && r2.statusCode, error: 'file-fetch-fail' };
    ct = hdr(r2.headers, 'content-type'); cd = hdr(r2.headers, 'content-disposition');
    body = r2.body; fromUrl = r2.finalUrl;
    if (/text\/html/i.test(ct)) return { url, ok: false, error: 'not-a-file' };
  }
  // 파일명 결정 (content-disposition → 최종 URL → 제목+확장자). .php로는 절대 저장 안 함.
  let filename = parseCdFilename(cd);
  if (!filename) {
    const u = decodeURIComponent((fromUrl.split('?')[0].split('/').pop()) || '');
    filename = (/\.[a-z0-9]{2,5}$/i.test(u) && !/\.(php|acl|do|jsp)$/i.test(u)) ? u : (safeName(title) + (extFromCT(ct) || '.pdf'));
  }
  filename = safeName(filename);
  if (/\.(php|acl|do|jsp|htm|html)$/i.test(filename)) filename = safeName(title) + (extFromCT(ct) || '.pdf');
  const dir = path.join(STUDECK_DIR(), '수업자료', safeName(course));
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const dest = uniquePath(dir, filename);
  try { fs.writeFileSync(dest, body); return { url, ok: true, path: dest, filename }; }
  catch (e) { return { url, ok: false, error: String(e && e.message || e) }; }
}
ipcMain.handle('lms-download', async (_e, items) => {
  const out = [];
  for (const it of (items || [])) out.push(await downloadMaterial(it.url, it.course, it.title));
  return out;
});
ipcMain.handle('open-studeck-folder', (_e, { kind, course } = {}) => {
  try {
    let dir = STUDECK_DIR();
    if (kind === 'materials') dir = path.join(dir, '수업자료', safeName(course));
    else if (kind === 'assignment') dir = path.join(dir, '과제', safeName(course));
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return { ok: true, dir };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

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

app.whenReady().then(() => {
  app.setAppUserModelId('cbnu.study.widget');
  autoBackup();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
