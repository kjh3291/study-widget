// 새 버전 업그레이드: GitHub에 게시(Publish)된 릴리스를 확인해서, 사용자가 '업그레이드'를 누르면
//   윈도우(설치판): 받아서 바로 설치하고 다시 시작(electron-updater)
//   맥·윈도우 휴대용: 자동 설치가 안 돼서(맥은 Apple 서명이 있어야 함) 릴리스 페이지를 연다
// 실험실 앱(Studeck Lab)·개발 실행은 확인하지 않는다(운영 릴리스로 덮어쓰면 안 되므로).
// 릴리스는 CI가 초안(draft)으로 만들고, 사람이 Publish해야 여기서 보인다 = 확인한 버전만 퍼진다.

const RELEASES_URL = 'https://github.com/kjh3291/study-widget/releases/latest';
const FIRST_CHECK_MS = 20 * 1000, EVERY_MS = 6 * 60 * 60 * 1000;

// 어떤 방식으로 업그레이드할지(순수 함수, scripts/test-updater.js)
//   'auto'   받아서 설치·재시작  | 'manual' 새 버전 알림 + 릴리스 페이지 | 'off' 확인 안 함
function updateMode({ platform, isPackaged, isLab, portable }) {
  if (!isPackaged || isLab) return 'off';
  if (platform === 'win32' && !portable) return 'auto';
  if (platform === 'win32' || platform === 'darwin') return 'manual';
  return 'off';
}

// main.js에서 한 번 부른다. send(state) → 렌더러로 상태 전달
function setupUpdater({ app, shell, ipcMain, isLab, send, beforeInstall, log = console, updater = null, platform = process.platform, portable = !!process.env.PORTABLE_EXECUTABLE_DIR }) {
  const mode = updateMode({ platform, isPackaged: app.isPackaged, isLab, portable });
  let status = { state: 'idle', mode, current: app.getVersion() };
  const set = (patch) => { status = { ...status, ...patch }; send(status); };
  ipcMain.handle('update-status', () => status);
  if (mode === 'off') return { mode };

  const autoUpdater = updater || require('electron-updater').autoUpdater;   // 테스트는 가짜를 넣는다
  autoUpdater.autoDownload = false;            // 사용자가 '업그레이드'를 눌렀을 때만 받는다
  autoUpdater.autoInstallOnAppQuit = mode === 'auto';
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = { info: () => {}, warn: (m) => log.warn('[update]', m), error: (m) => log.error('[update]', m), debug: () => {} };

  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version, error: '' }));
  autoUpdater.on('update-not-available', () => { if (status.state === 'checking') set({ state: 'idle' }); });
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (e) => { if (status.state === 'downloading' || status.state === 'installing') set({ state: 'available', error: '받기에 실패했어요. 잠시 뒤 다시 눌러 주세요.' }); log.warn('[update]', e && e.message); });

  const check = () => { if (['downloading', 'ready', 'installing'].includes(status.state)) return; autoUpdater.checkForUpdates().catch((e) => log.warn('[update] check', e && e.message)); };
  setTimeout(check, FIRST_CHECK_MS).unref?.();
  setInterval(check, EVERY_MS).unref?.();

  // '업그레이드' 버튼
  ipcMain.handle('update-start', async () => {
    if (mode === 'manual') { await shell.openExternal(RELEASES_URL); return { ok: true, opened: true }; }
    if (status.state === 'ready') return { ok: true, ready: true };
    if (status.state !== 'available') return { ok: false, error: '받을 새 버전이 없어요.' };
    set({ state: 'downloading', percent: 0 });
    try { await autoUpdater.downloadUpdate(); return { ok: true }; }
    catch (e) { set({ state: 'available', error: '받기에 실패했어요. 잠시 뒤 다시 눌러 주세요.' }); return { ok: false, error: e.message }; }
  });
  // 렌더러가 저장·동기화를 끝낸 뒤 부른다 → 설치하고 다시 시작
  ipcMain.handle('update-install', () => {
    if (status.state !== 'ready') return { ok: false };
    set({ state: 'installing' });
    beforeInstall();                       // 창 닫기 막음 해제(트레이로 숨기지 않게)
    setImmediate(() => autoUpdater.quitAndInstall(true, true));   // 조용히 설치 + 설치 뒤 바로 실행
    return { ok: true };
  });
  return { mode };
}

module.exports = { updateMode, setupUpdater, RELEASES_URL };
