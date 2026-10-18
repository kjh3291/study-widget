// test-prod-switch.js가 띄우는 운영 앱(채널 prod, 서버 모드). 준비된 프로필로 시작 → 로그인 → 동기화 후 결과 저장.
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const { PROFILE_DIR, USER, PW, RESULT_FILE } = process.env;
app.setPath('userData', PROFILE_DIR); app.setPath('desktop', path.join(PROFILE_DIR, 'Desktop'));
const timeout = setTimeout(() => { fs.writeFileSync(RESULT_FILE, JSON.stringify({ error: 'timeout' })); app.exit(1); }, 90000);
let handled = false; // 첫 창(메인)만. LMS 숨은 창은 건너뜀
app.on('browser-window-created', (_e, win) => {
  if (handled) return; handled = true;
  win.hide();
  win.webContents.once('did-finish-load', async () => {
    try {
      const r = await win.webContents.executeJavaScript(`(async()=>{ const $=id=>document.getElementById(id), wait=ms=>new Promise(r=>setTimeout(r,ms));
        const until=async(f,w)=>{for(let i=0;i<300;i++){if(f())return;await wait(100);}throw new Error('시간 초과: '+w);};
        await wait(500);
        const ui = { gate: !$('auth-gate').hidden, gitBox: !!$('git-box'), importBtn: !!$('btn-srv-import'), lab: !!document.querySelector('.lab-badge'), title: document.title };
        $('gate-l-id').value=${JSON.stringify(USER)}; $('gate-l-pw').value=${JSON.stringify(PW)};
        $('gate-login').dispatchEvent(new Event('submit',{cancelable:true}));
        await until(()=>$('auth-gate').hidden,'로그인'); await until(()=>_syncStatus.phase==='synced' && !_syncInFlight,'동기화');
        return { ui, todos: state.todos.map(t=>t.id).sort() };
      })()`);
      const cfg = JSON.parse(fs.readFileSync(path.join(PROFILE_DIR, 'config.json'), 'utf8'));
      fs.writeFileSync(RESULT_FILE, JSON.stringify({ ...r, sync: { mode: cfg.sync.mode, enabled: cfg.sync.enabled, hasRepo: 'repo' in cfg.sync, migratedFromGithub: cfg.sync.migratedFromGithub },
        configText: JSON.stringify(cfg), pending: Object.keys(cfg.pendingShared || {}) }));
      clearTimeout(timeout); app.exit(0);
    } catch (e) { fs.writeFileSync(RESULT_FILE, JSON.stringify({ error: String(e) })); app.exit(1); }
  });
});
require('../main');
