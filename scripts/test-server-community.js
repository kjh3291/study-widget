// 실험실 서버 커뮤니티 점검: 공지·채팅방·메시지 실시간 전달·사진·프로필 공개 범위·권한.
// 시험 계정(99…)을 만들고 하나를 실험실 DB에서 운영진으로 올린 뒤 끝나면 지운다. (실험실 서버 SSH 필요)
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { serverCall } = require('../server-sync');

const URL = 'http://100.96.247.43:8444', WS = 'ws://100.96.247.43:8444/ws', CONSENT = '2026-10-v1';
const sql = q => execFileSync('ssh', ['kimti4', `cd ~/studeck/lab/server && docker compose exec -T db psql -U studeck -d studeck -At -c "${q}"`]).toString().trim();
const pw = crypto.randomBytes(12).toString('base64url');
const PASS = m => console.log('PASS: ' + m);
const made = [], msgIds = [];
async function member(name) {
  const u = '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0'); made.push(u);
  await serverCall(URL, 'POST', '/auth/signup', { username: u, password: pw, displayName: name, consent: CONSENT });
  const l = await serverCall(URL, 'POST', '/auth/login', { username: u, password: pw });
  const token = l.json.token, h = { authorization: 'Bearer ' + token };
  return {
    id: l.json.user.id, username: u, token,
    get: p => fetch(URL + p, { headers: h }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })),
    send: (m, p, b) => serverCall(URL, m, p, b, token),
    upload: buf => fetch(URL + '/media', { method: 'POST', headers: { ...h, 'content-type': 'application/octet-stream' }, body: buf }).then(async r => ({ status: r.status, json: await r.json() })),
  };
}
// 실시간 연결: 받은 이벤트를 모아 두고 조건을 기다린다
function live(m) {
  const events = [], ws = new WebSocket(WS);
  const ready = new Promise((res, rej) => {
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: m.token }));
    ws.onmessage = e => { const ev = JSON.parse(e.data); events.push(ev); if (ev.type === 'ready') res(); };
    ws.onerror = rej;
  });
  const waitFor = async (pred, what) => { for (let i = 0; i < 50; i++) { const ev = events.find(pred); if (ev) return ev; await new Promise(r => setTimeout(r, 100)); } throw new Error('실시간 이벤트 없음: ' + what); };
  return { ready, waitFor, events, close: () => ws.close() };
}
// 아주 작은 PNG(1x1)
function tinyPng() {
  const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const A = await member('운영진가'), B = await member('회원나');
  sql(`UPDATE users SET role='admin' WHERE username='${A.username}'`);
  const la = live(A), lb = live(B);
  try {
    await Promise.all([la.ready, lb.ready]);
    await la.waitFor(e => e.type === 'presence' && e.userId === B.id && e.online, 'B 접속');
    PASS('실시간 연결(토큰 인증)·접속 상태 알림');

    const bad = new WebSocket(WS); let closed;
    await new Promise(r => { bad.onopen = () => bad.send(JSON.stringify({ type: 'auth', token: 'wrong' })); bad.onclose = e => { closed = e.code; r(); }; });
    assert.equal(closed, 4003);
    PASS('잘못된 토큰의 실시간 연결은 끊김');

    // 공지: 운영진만 작성 → 회원에게 실시간
    assert.equal((await B.send('POST', '/notices', { title: '회원이 쓴 공지', body: 'x' })).status, 403);
    const n = await A.send('POST', '/notices', { title: '이번 주 스터디', body: '토요일 2시', pinned: true });
    assert.equal(n.status, 200);
    await lb.waitFor(e => e.type === 'notice' && e.action === 'new' && e.notice.title === '이번 주 스터디', '공지 알림');
    const list = await B.get('/notices'); assert.equal(list.json.notices[0].pinned, true);
    PASS('공지: 운영진만 작성, 고정, 회원에게 실시간 알림');

    // 채팅: 전체방에 메시지 → 상대에게 실시간, 기록 조회
    const rooms = (await B.get('/rooms')).json.rooms; const all = rooms.find(r => r.name === '전체'); assert.ok(all);
    const msg = await B.send('POST', `/rooms/${all.id}/messages`, { body: '안녕하세요!' });
    assert.equal(msg.status, 200);
    const got = await la.waitFor(e => e.type === 'message' && e.action === 'new' && e.message.body === '안녕하세요!', '메시지');
    assert.equal(got.message.author, '회원나');
    const hist = await A.get(`/rooms/${all.id}/messages?limit=5`); assert.ok(hist.json.messages.some(m => m.body === '안녕하세요!'));
    PASS('채팅: 전체방 메시지 실시간 전달·기록 조회');

    // 방 만들기는 운영진만
    assert.equal((await B.send('POST', '/rooms', { name: '회원방' })).status, 403);
    const roomName = '스터디-' + crypto.randomInt(0, 1e6);
    const room = await A.send('POST', '/rooms', { name: roomName, topic: '자료구조 스터디' });
    await lb.waitFor(e => e.type === 'room' && e.room?.name === roomName, '새 방 알림');
    PASS('주제방은 운영진만 생성, 생성 알림');

    // 사진: 이미지가 아니면 거부, PNG 업로드 후 메시지 첨부·내려받기
    assert.equal((await B.upload(Buffer.from('not an image'))).status, 415);
    const up = await B.upload(tinyPng()); assert.equal(up.json.mime, 'image/png');
    const pm = await B.send('POST', `/rooms/${room.json.room.id}/messages`, { image: { sha: up.json.sha, width: 1, height: 1 } });
    assert.equal(pm.json.message.image.sha, up.json.sha);
    const img = await fetch(URL + '/media/' + up.json.sha, { headers: { authorization: 'Bearer ' + A.token } });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(URL + '/media/' + up.json.sha)).status, 401);
    assert.equal((await B.send('POST', `/rooms/${all.id}/messages`, { image: { sha: 'f'.repeat(64) } })).status, 400);
    PASS('사진: 이미지 형식만 허용, 첨부·보기(로그인 필요), 없는 사진 첨부 거부');

    // 삭제: 남의 메시지는 못 지움, 운영진은 지움 → 실시간
    assert.equal((await A.send('DELETE', `/messages/${msg.json.message.id}`)).status, 200);
    await lb.waitFor(e => e.type === 'message' && e.action === 'delete' && e.id === msg.json.message.id, '삭제 알림');
    const own = await A.send('POST', `/rooms/${all.id}/messages`, { body: '운영진 메시지' });
    assert.equal((await B.send('DELETE', `/messages/${own.json.message.id}`)).status, 404);
    PASS('메시지 삭제: 본인·운영진만, 삭제 실시간 반영');

    // 프로필: 공부 시간·시간표는 켰을 때만 공개
    await B.send('POST', '/sync', { since: 0, changes: [
      { kind: 'setting', id: 'focus', data: { v: { sessions: [{ date: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), minutes: 95, task: '자료구조' }] } }, updatedAt: Date.now() },
      { kind: 'course', id: 'name:자료구조', data: { o: 0, v: { name: '자료구조', times: [{ day: 1, start: '09:00', end: '10:30' }], professor: '비공개 정보' } }, updatedAt: Date.now() }] });
    let mem = (await A.get('/profiles')).json.members.find(m => m.id === B.id);
    assert.equal(mem.study, null); assert.equal(mem.timetable, null); assert.equal(mem.online, true);
    await B.send('PUT', '/me/profile', { nickname: '나나', bio: '자료구조 공부 중', avatar: up.json.sha, showStudy: true, showTimetable: true });
    await la.waitFor(e => e.type === 'profile' && e.userId === B.id, '프로필 변경 알림');
    mem = (await A.get('/profiles')).json.members.find(m => m.id === B.id);
    assert.equal(mem.nickname, '나나'); assert.equal(mem.study.todayMinutes, 95);
    assert.equal(mem.timetable[0].name, '자료구조'); assert.equal(mem.timetable[0].professor, undefined);
    PASS('프로필: 닉네임·사진·소개, 공부 시간·시간표는 켰을 때만(교수명 등 나머지는 비공개)');

    lb.close(); await la.waitFor(e => e.type === 'presence' && e.userId === B.id && !e.online, 'B 접속 종료');
    PASS('접속 종료 알림');
    // 서버 재시작 때 도는 정리 작업이 쓰이는 사진을 지우지 않아야 함
    execFileSync('ssh', ['kimti4', 'cd ~/studeck/lab/server && docker compose restart api >/dev/null 2>&1']);
    let st = 0; for (let i = 0; i < 30 && st !== 200; i++) { await new Promise(r => setTimeout(r, 500)); st = await fetch(URL + '/media/' + up.json.sha, { headers: { authorization: 'Bearer ' + A.token } }).then(r => r.status).catch(() => 0); }
    assert.equal(st, 200, '정리 작업 후에도 메시지에 쓰인 사진 유지');
    PASS('서버 재시작(정리 작업) 후에도 쓰이는 사진은 남음');
    await A.send('DELETE', `/rooms/${room.json.room.id}`);
    msgIds.push(msg.json.message.id, own.json.message.id, pm.json.message.id);
    console.log('ALL PASS');
  } finally {
    la.close(); lb.close();
    console.log('cleanup:', sql(`DELETE FROM users WHERE username IN (${made.map(u => `'${u}'`).join(',')})`));
    if (msgIds.length) {
      const left = sql(`SELECT count(*) FROM messages WHERE id IN (${msgIds.join(',')})`);
      if (left !== '0') { console.error('FAIL: 계정 삭제 후 메시지가 남음', left); process.exitCode = 1; } else console.log('PASS: 계정이 완전히 삭제되면 그 회원의 메시지도 삭제');
      sql(`DELETE FROM notices WHERE author_id IS NULL`);
    }
  }
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; });
