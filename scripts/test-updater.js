// 새 버전 업그레이드 점검(updater.js): 어떤 앱에서 켜지는지, 누르면 받기 → 다 받으면 설치·재시작
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { updateMode, setupUpdater, RELEASES_URL } = require('../updater');

assert.equal(updateMode({ platform: 'win32', isPackaged: true, isLab: false, portable: false }), 'auto', '윈도우 설치판: 자동 설치');
assert.equal(updateMode({ platform: 'win32', isPackaged: true, isLab: false, portable: true }), 'manual', '휴대용은 설치 불가 → 페이지');
assert.equal(updateMode({ platform: 'darwin', isPackaged: true, isLab: false }), 'manual', '맥: Apple 서명 없이는 자동 설치 불가 → 페이지');
assert.equal(updateMode({ platform: 'win32', isPackaged: true, isLab: true }), 'off', '실험실 앱은 운영 릴리스로 덮지 않음');
assert.equal(updateMode({ platform: 'win32', isPackaged: false, isLab: false }), 'off', '개발 실행은 끔');
assert.equal(updateMode({ platform: 'linux', isPackaged: true, isLab: false }), 'off');

(async () => {
  const handlers = {}, sent = [], opened = [];
  let installed = null, allowed = false, downloads = 0;
  const fake = Object.assign(new EventEmitter(), {
    checkForUpdates: async () => { fake.emit('update-available', { version: '1.5.1' }); },
    downloadUpdate: async () => { downloads++; fake.emit('download-progress', { percent: 42.4 }); fake.emit('update-downloaded', { version: '1.5.1' }); },
    quitAndInstall: (silent, run) => { installed = { silent, run }; },
  });
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const app = { isPackaged: true, getVersion: () => '1.5.0' };
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return { unref() {} }; };   // 첫 확인을 바로
  const realSetInterval = global.setInterval; global.setInterval = () => ({ unref() {} });
  const r = setupUpdater({ app, shell: { openExternal: async (u) => opened.push(u) }, ipcMain, isLab: false, send: (st) => sent.push(st), beforeInstall: () => { allowed = true; }, updater: fake, platform: 'win32', portable: false, log: { warn() {}, error() {} } });
  global.setTimeout = realSetTimeout; global.setInterval = realSetInterval;
  await new Promise((res) => setImmediate(res));
  assert.equal(r.mode, 'auto'); assert.equal(fake.autoDownload, false, '누르기 전에는 받지 않음');
  assert.deepEqual(await handlers['update-status'](), { state: 'available', mode: 'auto', current: '1.5.0', version: '1.5.1', error: '' });
  assert.equal((await handlers['update-install']()).ok, false, '다 받기 전에는 설치 안 함');
  assert.equal((await handlers['update-start']()).ok, true); assert.equal(downloads, 1);
  assert.ok(sent.some((s) => s.state === 'downloading' && s.percent === 42), '받는 중 % 전달');
  assert.equal((await handlers['update-status']()).state, 'ready');
  assert.equal((await handlers['update-install']()).ok, true);
  await new Promise((res) => setImmediate(res));
  assert.equal(allowed, true, '트레이로 숨기지 않고 종료되게');
  assert.deepEqual(installed, { silent: true, run: true }, '조용히 설치하고 다시 실행');

  // 맥: 누르면 릴리스 페이지
  const h2 = {}; const fake2 = Object.assign(new EventEmitter(), { checkForUpdates: async () => {}, downloadUpdate: async () => { throw new Error('should not'); } });
  const opened2 = [];
  setupUpdater({ app, shell: { openExternal: async (u) => opened2.push(u) }, ipcMain: { handle: (c, f) => { h2[c] = f; } }, isLab: false, send: () => {}, beforeInstall() {}, updater: fake2, platform: 'darwin', log: { warn() {}, error() {} } });
  assert.equal((await h2['update-start']()).opened, true); assert.deepEqual(opened2, [RELEASES_URL]);
  // 실험실: 확인 안 함(업데이트 모듈도 안 부름)
  const h3 = {};
  assert.equal(setupUpdater({ app, shell: {}, ipcMain: { handle: (c, f) => { h3[c] = f; } }, isLab: true, send() {}, beforeInstall() {}, updater: null }).mode, 'off');
  assert.equal(h3['update-start'], undefined);
  console.log('PASS: 새 버전 업그레이드 — 윈도우 설치판은 눌러서 받고 설치·재시작, 맥·휴대용은 내려받기 페이지, 실험실·개발 실행은 끔');
})().catch((e) => { console.error(e); process.exitCode = 1; });
