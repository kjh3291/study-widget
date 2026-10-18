// 실험실 앱 계정 화면 점검(실제 main+renderer, 임시 프로필): 임시 비밀번호 → 새 비밀번호 강제,
// 내 계정 화면·탈퇴, 최고 관리자의 회원 관리(복구·운영진 지정). 시험 계정은 끝나면 실험실 DB에서 지운다.
// 사용: npx electron scripts/test-lab-accounts.cjs [스크린샷 폴더]
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
process.env.STUDECK_CHANNEL = 'lab'; process.env.STUDECK_KEEP_USERDATA = '1';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-lab-acc-'));
fs.mkdirSync(path.join(temp, 'Desktop'));
app.setPath('userData', temp); app.setPath('desktop', path.join(temp, 'Desktop'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ lmsAuto: false, autoDownload: false, assignFix1: true, materialsFix2: true, bounds: { x: 0, y: 0, width: 430, height: 760 } }));
const { serverCall } = require('../server-sync');
const URL = 'http://100.96.247.43:8444', CONSENT = '2026-10-v1';
const shots = process.argv.find(a => a.startsWith('--shots='))?.slice(8);
const sql = q => execFileSync('ssh', ['kimti4', `cd ~/studeck/lab/server && docker compose exec -T db psql -U studeck -d studeck -At -c "${q}"`]).toString().trim();
const id = () => '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
const owner = id(), member = id(), pw = crypto.randomBytes(12).toString('base64url'), newPw = crypto.randomBytes(12).toString('base64url');
let verified = false;
const timeout = setTimeout(() => { console.error('timed out'); app.exit(1); }, 90000);
app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = code => win.webContents.executeJavaScript(`(async()=>{ const $=id=>document.getElementById(id), wait=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async(f,w)=>{for(let i=0;i<120;i++){if(f())return;await wait(100);}throw new Error('시간 초과: '+w);};
      const submit=id=>$(id).dispatchEvent(new Event('submit',{cancelable:true})); ${code} })()`);
    const shot = async name => { if (shots) fs.writeFileSync(path.join(shots, name), (await win.webContents.capturePage()).toPNG()); };
    try {
      await serverCall(URL, 'POST', '/auth/signup', { username: owner, password: pw, displayName: '김관리', consent: CONSENT });
      await serverCall(URL, 'POST', '/auth/signup', { username: member, password: pw, displayName: '이회원', consent: CONSENT });
      sql(`UPDATE users SET role='owner' WHERE username='${owner}'`);
      const ot = (await serverCall(URL, 'POST', '/auth/login', { username: owner, password: pw })).json.token;
      const mid = (await fetch(URL + '/admin/users', { headers: { authorization: 'Bearer ' + ot } }).then(r => r.json())).users.find(u => u.username === member).id;
      const temp = (await serverCall(URL, 'POST', `/admin/users/${mid}/temp-password`, {}, ot)).json.tempPassword;

      // 1. 임시 비밀번호로 로그인 → 새 비밀번호 강제
      await js(`await wait(400); $('gate-l-id').value=${JSON.stringify(member)}; $('gate-l-pw').value=${JSON.stringify(temp)}; submit('gate-login');
        await until(()=>!$('gate-change').hidden,'새 비밀번호 화면');
        if(!$('auth-gate').hidden===false) throw new Error('시작 화면이 닫히면 안 됨');
        $('gate-c-pw').value=${JSON.stringify(newPw)}; $('gate-c-pw2').value=${JSON.stringify(newPw)}; submit('gate-change');
        await until(()=>$('auth-gate').hidden && !_syncInFlight,'로그인 완료');`);
      const relog = await serverCall(URL, 'POST', '/auth/login', { username: member, password: newPw });
      if (relog.status !== 200 || relog.json.user.mustChangePassword) throw new Error('새 비밀번호 적용 안 됨');

      // 2. 내 계정 화면 → 탈퇴(비밀번호 확인)
      await js(`openSettings(); await wait(300); $('btn-account').click(); await until(()=>document.querySelector('#account-panel [data-gh-link]'),'내 계정 화면');
        const t=$('account-panel').textContent; if(!t.includes('이회원')||!t.includes('GitHub 연결')||!t.includes('탈퇴')) throw new Error('내 계정 내용 오류');`);
      await shot('account-panel.png');
      await js(`UI.testAutoConfirm=true; document.querySelector('#account-panel [data-withdraw]').click(); await until(()=>$('ac-wd-pw'),'탈퇴 시트');
        $('ac-wd-pw').value=${JSON.stringify(newPw)}; $('ac-wd').requestSubmit();
        await until(()=>!$('auth-gate').hidden && $('gate-msg').textContent.includes('탈퇴'),'탈퇴 후 시작 화면');`);
      if ((await serverCall(URL, 'POST', '/auth/login', { username: member, password: newPw })).json.error !== 'deleted') throw new Error('탈퇴 후 로그인이 막혀야 함');

      // 3. 최고 관리자로 로그인 → 회원 관리: 복구 → 운영진 지정
      await js(`$('gate-l-id').value=${JSON.stringify(owner)}; $('gate-l-pw').value=${JSON.stringify(pw)}; submit('gate-login');
        await until(()=>$('auth-gate').hidden && !_syncInFlight,'관리자 로그인');
        window.confirm=()=>true; UI.testAutoConfirm=true; openSettings(); await wait(300); await until(()=>!$('admin-box').hidden,'운영진 상자');
        $('btn-members').click(); await until(()=>document.querySelector('#members-panel .mrow[data-name="이회원"] [data-act="restore"]'),'삭제된 회원');`);
      await shot('members-panel.png');
      await js(`document.querySelector('#members-panel .mrow[data-name="이회원"] [data-act="restore"]').click();
        await until(()=>document.querySelector('#members-panel .mrow[data-name="이회원"] [data-act="role"][data-role="admin"]'),'복구 후 운영진 지정 버튼');
        document.querySelector('#members-panel .mrow[data-name="이회원"] [data-act="role"][data-role="admin"]').click();
        await until(()=>document.querySelector('#members-panel .mrow[data-name="이회원"] [data-act="role"][data-role="member"]'),'운영진 지정됨');`);
      const users = (await fetch(URL + '/admin/users', { headers: { authorization: 'Bearer ' + ot } }).then(r => r.json())).users;
      const m = users.find(u => u.username === member);
      if (m.status !== 'approved' || m.role !== 'admin') throw new Error('복구·운영진 지정 결과 오류: ' + JSON.stringify(m));
      verified = true;
    } catch (e) { console.error(e); }
    finally {
      try { sql(`DELETE FROM users WHERE username IN ('${owner}','${member}')`); } catch (e) { console.error('cleanup', e.message); }
      clearTimeout(timeout);
      if (verified) console.log('PASS: 임시 비밀번호 → 새 비밀번호 강제, 내 계정 화면·탈퇴(로그인 차단), 최고 관리자 회원 관리(복구·운영진 지정)');
      app.exit(verified ? 0 : 1);
    }
  });
});
app.on('quit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* temp */ } });
require('../main');
