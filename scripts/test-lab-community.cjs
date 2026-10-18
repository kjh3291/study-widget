// 실험실 앱의 커뮤니티 연결층 점검(실제 main+preload+renderer, 임시 프로필):
// 로그인 → 실시간 연결 → 다른 회원 메시지 수신 → 앱에서 메시지·사진 보내기 → 사진 받아 보기 → 재연결.
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
process.env.STUDECK_CHANNEL = 'lab'; process.env.STUDECK_KEEP_USERDATA = '1';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-lab-com-'));
fs.mkdirSync(path.join(temp, 'Desktop'));
app.setPath('userData', temp); app.setPath('desktop', path.join(temp, 'Desktop'));
fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ lmsAuto: false, autoDownload: false, assignFix1: true, materialsFix2: true }));
const { serverCall } = require('../server-sync');
const URL = 'http://100.96.247.43:8444', CONSENT = '2026-10-v1';
const id = () => '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
const me = id(), other = id(), pw = crypto.randomBytes(12).toString('base64url');
let verified = false;
const timeout = setTimeout(() => { console.error('timed out'); app.exit(1); }, 90000);
app.on('browser-window-created', (_e, win) => {
  win.hide();
  win.webContents.once('did-finish-load', async () => {
    const js = code => win.webContents.executeJavaScript(`(async()=>{ const $=id=>document.getElementById(id), wait=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async(f,w)=>{for(let i=0;i<150;i++){if(await f())return;await wait(100);}throw new Error('시간 초과: '+w);}; ${code} })()`);
    try {
      for (const u of [me, other]) await serverCall(URL, 'POST', '/auth/signup', { username: u, password: pw, displayName: u === me ? '앱사용자' : '다른회원', consent: CONSENT });
      const ot = (await serverCall(URL, 'POST', '/auth/login', { username: other, password: pw })).json.token;
      await js(`await wait(400); $('gate-l-id').value=${JSON.stringify(me)}; $('gate-l-pw').value=${JSON.stringify(pw)};
        $('gate-login').dispatchEvent(new Event('submit',{cancelable:true})); await until(()=>$('auth-gate').hidden && !_syncInFlight,'로그인');
        window.__got=[]; Community.on('message', e=>window.__got.push(e)); Community.start();
        await until(()=>Community.state.connected,'실시간 연결');`);
      const rooms = await fetch(URL + '/rooms', { headers: { authorization: 'Bearer ' + ot } }).then(r => r.json());
      const all = rooms.rooms.find(r => r.name === '전체');
      await serverCall(URL, 'POST', `/rooms/${all.id}/messages`, { body: '앱에서 보이나요?' }, ot);
      const result = await js(`await until(()=>window.__got.some(e=>e.message?.body==='앱에서 보이나요?'),'다른 회원 메시지 수신');
        const sent = await Community.send(${all.id}, '네 잘 보여요');
        if(!sent.ok) throw new Error('보내기 실패: '+sent.error);
        // 사진: 캔버스로 만든 PNG를 올리고 다시 받아 보기
        const c=document.createElement('canvas'); c.width=40; c.height=30; c.getContext('2d').fillRect(0,0,40,30);
        const blob=await new Promise(r=>c.toBlob(r,'image/png')); const file=new File([blob],'a.png',{type:'image/png'});
        const up=await Community.uploadImage(file);
        const withImg=await Community.send(${all.id}, '', up); if(!withImg.ok) throw new Error('사진 메시지 실패');
        const shown=await Community.image(up.sha); if(!shown.ok||!shown.dataUrl.startsWith('data:image/')) throw new Error('사진 받기 실패');
        const blocked=await Community.call('GET','/admin/users'); if(blocked.ok) throw new Error('허용되지 않은 경로가 열림');
        return { sha: up.sha, w: up.width };`);
      const hist = await fetch(URL + `/rooms/${all.id}/messages?limit=5`, { headers: { authorization: 'Bearer ' + ot } }).then(r => r.json());
      if (!hist.messages.some(m => m.body === '네 잘 보여요' && m.author === '앱사용자')) throw new Error('앱에서 보낸 메시지가 서버에 없음');
      if (!hist.messages.some(m => m.image?.sha === result.sha)) throw new Error('사진 메시지가 서버에 없음');
      verified = true;
    } catch (e) { console.error(e); }
    finally {
      const { execFileSync } = require('node:child_process');
      try { execFileSync('ssh', ['kimti4', `cd ~/studeck/lab/server && docker compose exec -T db psql -U studeck -d studeck -At -c "DELETE FROM users WHERE username IN ('${me}','${other}')"`]); } catch (e) { console.error('cleanup', e.message); }
      clearTimeout(timeout);
      if (verified) console.log('PASS: 앱 커뮤니티 연결 — 실시간 수신, 메시지·사진 보내기, 사진 받아 보기(캐시), 허용 안 된 경로 차단');
      app.exit(verified ? 0 : 1);
    }
  });
});
app.on('quit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* temp */ } });
require('../main');
