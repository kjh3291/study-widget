// 실험실 앱(main+preload+renderer)을 임시 프로필로 띄워 실험실 서버와 실제로 주고받는지 확인한다.
// 사용: npx electron scripts/test-lab-main.cjs   (Tailscale로 실험실 서버에 연결돼 있어야 함)
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
process.env.STUDECK_CHANNEL = 'lab';
process.env.STUDECK_KEEP_USERDATA = '1';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-lab-main-'));
const desktop = path.join(temp, 'Desktop'); fs.mkdirSync(desktop);
app.setPath('userData', temp); app.setPath('desktop', desktop);
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ lmsAuto: false, autoDownload: false, rolloverOverdue: false, assignFix1: true, materialsFix2: true }));
const { serverCall } = require('../server-sync');
const URL = 'http://100.96.247.43:8444';
const user = 'test_' + crypto.randomBytes(5).toString('hex'), pw = crypto.randomBytes(12).toString('base64url');
let verified = false;
const timeout = setTimeout(() => { console.error('lab main test timed out'); app.exit(1); }, 40000);
app.on('browser-window-created', (_e, win) => {
  win.hide();
  win.webContents.once('did-finish-load', async () => {
    try {
      const ui = await win.webContents.executeJavaScript(`(async()=>{
        await new Promise(r=>setTimeout(r,200));
        return { lab: IS_LAB, badge: !!document.querySelector('.lab-badge'), server: !!document.getElementById('server-box') && !document.getElementById('server-box').hidden,
          git: !!document.getElementById('git-box'), title: document.title };
      })()`);
      if (!ui.lab || !ui.badge || !ui.server || ui.git || ui.title !== 'Studeck Lab') throw new Error('실험실 화면 구성 오류: ' + JSON.stringify(ui));
      const result = await win.webContents.executeJavaScript(`(async()=>{
        const su = await window.api.serverSignup(${JSON.stringify(user)}, ${JSON.stringify(pw)}, '테스트');
        if (!su.ok) throw new Error('가입 실패: ' + su.error);
        state.todos.push({ id: 'lab-t1', text: '실험실 앱에서 추가', done: false });
        await persist({ todos: state.todos });
        const li = await window.api.serverLogin(${JSON.stringify(user)}, ${JSON.stringify(pw)});
        if (!li.ok) throw new Error('로그인 실패: ' + li.error);
        state.syncEnabled = true;
        const r = await initSync();
        if (!r?.ok) throw new Error('동기화 실패: ' + r?.error);
        const cfg = await window.api.loadConfig();
        if (Object.keys(cfg.pendingShared || {}).length) throw new Error('미전송 남음: ' + Object.keys(cfg.pendingShared));
        if (JSON.stringify(cfg).includes(${JSON.stringify(pw)})) throw new Error('비밀번호가 설정에 저장됨');
        const st = await window.api.gitSyncStatus();
        const gh = await window.api.gitConnect('a/b', 'x');
        if (gh.ok) throw new Error('실험실에서 GitHub 연결이 허용됨');
        return { phase: st.phase, user: st.username };
      })()`);
      // 다른 기기처럼 서버에 직접 로그인해 올라간 할 일을 확인
      const other = await serverCall(URL, 'POST', '/auth/login', { username: user, password: pw, deviceName: 'checker' });
      const pulled = await fetch(URL + '/sync?since=0', { headers: { authorization: 'Bearer ' + other.json.token } }).then(x => x.json());
      if (!pulled.changes.some(c => c.kind === 'todo' && c.id === 'lab-t1' && c.data.v.text === '실험실 앱에서 추가')) throw new Error('서버에 할 일이 없음');
      if (result.phase !== 'synced' || result.user !== user) throw new Error('상태 오류: ' + JSON.stringify(result));
      verified = true;
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
});
app.on('will-quit', () => {
  clearTimeout(timeout);
  if (!verified) process.exitCode = 1;
  else console.log('PASS: 실험실 앱 화면(LAB·서버 박스) → 가입·로그인 → 할 일 서버 업로드 → 다른 기기에서 확인, 비밀번호 미저장, GitHub 차단');
});
app.on('quit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* temp cleanup */ } });
require('../main');
