// Exercise the production main process + isolated preload with synthetic user data.
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-main-sync-'));
const desktop = path.join(temp, 'Desktop'); fs.mkdirSync(desktop);
app.setPath('userData', temp); app.setPath('desktop', desktop);
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ lmsAuto: false, autoDownload: false, rolloverOverdue: false, assignFix1: true, materialsFix2: true, todos: [{ id: 'legacy', text: '업데이트 전 할 일', done: false }] }));
let verified = false;
const timeout = setTimeout(() => { console.error('Production IPC smoke timed out'); app.exit(1); }, 20000);
app.on('browser-window-created', (_e, win) => {
  win.hide();
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async()=>{
        await new Promise(r=>setTimeout(r,100));
        const config=await window.api.loadConfig();
        if(!config.pendingShared?.todos)throw new Error('Legacy local data not migrated');
        state.todos.push({id:'new',text:'네트워크 없이 추가한 할 일',done:false});
        await persist({todos:state.todos});
        const saved=await window.api.loadConfig();
        if(saved.todos.length!==2||!saved.pendingShared.todos)throw new Error('IPC did not persist outbox');
        if(!document.getElementById('sync-now'))throw new Error('Sync button missing');
        return true;
      })()`);
      if (!result) throw new Error('Renderer smoke failed');
      verified = true;
      // Native quit must take the same renderer flush path as the close button.
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
});
app.on('will-quit', () => {
  clearTimeout(timeout);
  const saved = JSON.parse(fs.readFileSync(path.join(temp, 'config.json')));
  if (!verified || saved.todos.length !== 2 || !saved.pendingShared.todos) process.exitCode = 1;
  else console.log('PASS: production main/preload IPC, legacy migration, durable offline outbox and native app quit');
});
// Windows can retain Chromium file locks through will-quit. Cleanup must never
// raise an uncaught exception/native error dialog and prevent the tested quit.
app.on('quit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* CI/temp cleanup after process exit. */ } });
require('../main');
