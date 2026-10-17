// 실험실 앱(main+preload+renderer)을 임시 프로필로 띄워 실험실 서버와 실제로 주고받는지 확인한다.
// 사용: npx electron scripts/test-lab-main.cjs   (Tailscale로 실험실 서버에 연결돼 있어야 함)
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
process.env.STUDECK_CHANNEL = 'lab';
process.env.STUDECK_KEEP_USERDATA = '1';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-lab-main-'));
const desktop = path.join(temp, 'Desktop'); fs.mkdirSync(desktop);
// 실험실 폴더의 보조자료 파일(로그인 후 서버로 올라가야 함)과 수업자료(올라가면 안 됨)
fs.mkdirSync(path.join(desktop, 'Studeck-Lab', '테스트과목', '보조자료'), { recursive: true });
fs.mkdirSync(path.join(desktop, 'Studeck-Lab', '테스트과목', '수업자료'), { recursive: true });
fs.writeFileSync(path.join(desktop, 'Studeck-Lab', '테스트과목', '보조자료', '정리노트.txt'), '실험실 파일');
fs.writeFileSync(path.join(desktop, 'Studeck-Lab', '테스트과목', '수업자료', '강의.pdf'), 'LMS 자료');
app.setPath('userData', temp); app.setPath('desktop', desktop);
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ lmsAuto: false, autoDownload: false, rolloverOverdue: false, assignFix1: true, materialsFix2: true }));
const { serverCall } = require('../server-sync');
const URL = 'http://100.96.247.43:8444';
const user = '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0'), pw = crypto.randomBytes(12).toString('base64url');
let verified = false;
const timeout = setTimeout(() => { console.error('lab main test timed out'); app.exit(1); }, 40000);
app.on('browser-window-created', (_e, win) => {
  win.hide();
  win.webContents.once('did-finish-load', async () => {
    try {
      const ui = await win.webContents.executeJavaScript(`(async()=>{
        await new Promise(r=>setTimeout(r,400));
        return { lab: IS_LAB, badge: !!document.querySelector('header .lab-badge'), server: !!document.getElementById('server-box') && !document.getElementById('server-box').hidden,
          git: !!document.getElementById('git-box'), title: document.title, gate: !document.getElementById('auth-gate').hidden,
          everytime: !!document.getElementById('inp-id') || !!document.getElementById('btn-setup') || !!document.getElementById('btn-refresh') || typeof window.api.fetchTimetable === 'function' };
      })()`);
      if (!ui.lab || !ui.badge || !ui.server || ui.git || ui.title !== 'Studeck Lab' || !ui.gate || ui.everytime) throw new Error('실험실 화면 구성 오류: ' + JSON.stringify(ui));
      const result = await win.webContents.executeJavaScript(`(async()=>{
        const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
        const until = async (fn, what) => { for (let i = 0; i < 100; i++) { if (fn()) return; await wait(100); } throw new Error('시간 초과: ' + what); };
        const submit = id => $(id).dispatchEvent(new Event('submit', { cancelable: true }));
        // 가입 신청: 학번 형식 검사 → 정상 신청(99 가짜 학번은 실험실에서 자동 승인)
        $('gate-tab-signup').click();
        $('gate-s-id').value = 'abc'; $('gate-s-name').value = '테스트'; $('gate-s-pw').value = ${JSON.stringify(pw)}; $('gate-s-pw2').value = ${JSON.stringify(pw)};
        submit('gate-signup'); await wait(50);
        if (!$('gate-msg').textContent.includes('학번')) throw new Error('학번 검사 없음');
        $('gate-s-id').value = ${JSON.stringify(user)}; $('gate-s-pw2').value = 'mismatch';
        submit('gate-signup'); await wait(50);
        if (!$('gate-msg').textContent.includes('일치')) throw new Error('비밀번호 확인 검사 없음');
        $('gate-s-pw2').value = ${JSON.stringify(pw)};
        submit('gate-signup'); await wait(50);
        if (!$('gate-msg').textContent.includes('동의')) throw new Error('동의 검사 없음');
        $('gate-s-consent').checked = true;
        submit('gate-signup');
        await until(() => !$('gate-login').hidden && $('gate-msg').className === 'ok', '가입 신청');
        if ($('gate-l-id').value !== ${JSON.stringify(user)}) throw new Error('로그인 칸에 학번 미입력');
        state.todos.push({ id: 'lab-t1', text: '실험실 앱에서 추가', done: false });
        await persist({ todos: state.todos });
        // 로그인 → 시작 화면 사라지고 동기화
        $('gate-l-pw').value = ${JSON.stringify(pw)};
        submit('gate-login');
        await until(() => $('auth-gate').hidden, '로그인 후 시작 화면 닫힘');
        await until(() => _syncStatus.phase === 'synced', '동기화 완료');
        await until(() => !_syncInFlight, '파일 동기화 완료');
        const r = { ok: true };
        const cfg = await window.api.loadConfig();
        if (Object.keys(cfg.pendingShared || {}).length) throw new Error('미전송 남음: ' + Object.keys(cfg.pendingShared));
        if (JSON.stringify(cfg).includes(${JSON.stringify(pw)})) throw new Error('비밀번호가 설정에 저장됨');
        const st = await window.api.gitSyncStatus();
        const gh = await window.api.gitConnect('a/b', 'x');
        if (gh.ok) throw new Error('실험실에서 GitHub 연결이 허용됨');
        // 로그아웃 → 시작 화면으로 복귀, 데이터는 기기에 남음
        window.confirm = () => true;
        $('btn-srv-logout').click();
        await until(() => !$('auth-gate').hidden, '로그아웃 후 시작 화면');
        const after = await window.api.loadConfig();
        if (after.sync.enabled || after.sync.token || !after.todos.some(t => t.id === 'lab-t1')) throw new Error('로그아웃 상태 오류');
        return { phase: st.phase, user: st.username };
      })()`);
      // 다른 기기처럼 서버에 직접 로그인해 올라간 할 일을 확인
      const other = await serverCall(URL, 'POST', '/auth/login', { username: user, password: pw, deviceName: 'checker' });
      const pulled = await fetch(URL + '/sync?since=0', { headers: { authorization: 'Bearer ' + other.json.token } }).then(x => x.json());
      if (!pulled.changes.some(c => c.kind === 'todo' && c.id === 'lab-t1' && c.data.v.text === '실험실 앱에서 추가')) throw new Error('서버에 할 일이 없음');
      const files = await fetch(URL + '/files?since=0', { headers: { authorization: 'Bearer ' + other.json.token } }).then(x => x.json());
      const paths = files.files.map(f => f.path);
      if (!paths.includes('테스트과목/보조자료/정리노트.txt') || paths.some(p => p.includes('수업자료'))) throw new Error('파일 동기화 오류: ' + JSON.stringify(paths));
      if (result.phase !== 'synced' || result.user !== user) throw new Error('상태 오류: ' + JSON.stringify(result));
      verified = true;
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
});
app.on('will-quit', () => {
  clearTimeout(timeout);
  if (!verified) process.exitCode = 1;
  else console.log('PASS: 실험실 시작 화면(에타 없음) → 학번·비밀번호 확인·동의 검사 → 가입 신청 → 로그인 → 할 일·보조자료 파일 서버 업로드(수업자료 제외) → 다른 기기에서 확인, 비밀번호 미저장, GitHub 차단, 로그아웃 시 시작 화면 복귀');
});
app.on('quit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* temp cleanup */ } });
require('../main');
