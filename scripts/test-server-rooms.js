// 실험실 서버 채팅방 정책 점검(2026-10-18 결정):
// 전체방 자동 참여·나가기 불가 / 친목 바로 생성, 스터디·이벤트는 운영진 승인 / 공개(참여)·비공개(초대) /
// 메시지·실시간은 방 멤버만 / 방별 안 읽은 수·읽음 / 전체방 고정 + 최근 메시지순
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { serverCall } = require('../server-sync');

const URL = 'http://100.96.247.43:8444', WS = 'ws://100.96.247.43:8444/ws', CONSENT = '2026-10-v1';
const sql = q => execFileSync('ssh', ['kimti4', `cd ~/studeck/lab/server && docker compose exec -T db psql -U studeck -d studeck -At -c "${q}"`]).toString().trim();
const pw = crypto.randomBytes(12).toString('base64url');
const PASS = m => console.log('PASS: ' + m);
const made = [];
async function member(name) {
  const u = '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0'); made.push(u);
  await serverCall(URL, 'POST', '/auth/signup', { username: u, password: pw, displayName: name, consent: CONSENT });
  const l = await serverCall(URL, 'POST', '/auth/login', { username: u, password: pw });
  const token = l.json.token, h = { authorization: 'Bearer ' + token };
  const get = p => fetch(URL + p, { headers: h }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
  return { id: l.json.user.id, username: u, token, get, send: (m, p, b) => serverCall(URL, m, p, b, token),
    rooms: async () => (await get('/rooms')).json.rooms };
}
function live(m) {
  const events = [], ws = new WebSocket(WS);
  const ready = new Promise(res => { ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: m.token })); ws.onmessage = e => { const ev = JSON.parse(e.data); events.push(ev); if (ev.type === 'ready') res(); }; });
  return { ready, events, close: () => ws.close() };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const A = await member('운영진'), B = await member('회원비'), C = await member('회원씨');
  sql(`UPDATE users SET role='admin' WHERE username='${A.username}'`);
  const lc = live(C);
  try {
    await lc.ready;
    // 전체방 자동 참여·고정·나가기 불가
    const allB = (await B.rooms())[0];
    assert.equal(allB.kind, 'all'); assert.equal(allB.pinned, true);
    assert.equal((await B.send('POST', `/rooms/${allB.id}/leave`)).json.error, 'cannot_leave_all');
    PASS('가입하면 전체방 자동 참여, 목록 맨 위 고정, 나갈 수 없음');

    // 친목방: 바로 생성(공개) → 다른 회원이 찾아서 참여
    const social = (await B.send('POST', '/rooms', { name: '오늘 저녁 뭐 먹지', kind: 'social' })).json.room;
    assert.equal(social.status, 'active'); assert.equal(social.myRole, 'owner');
    assert.ok((await C.get('/rooms/discover')).json.rooms.some(r => r.id === social.id));
    assert.equal((await C.get(`/rooms/${social.id}/messages`)).status, 404, '참여 전에는 메시지 못 봄');
    await C.send('POST', `/rooms/${social.id}/join`);
    assert.equal((await C.rooms()).find(r => r.id === social.id).memberCount, 2);
    PASS('친목방은 누구나 바로 생성, 공개방은 찾아서 참여(참여 전엔 내용 비공개)');

    // 스터디·이벤트: 승인 대기 → 운영진 승인/거절
    const study = (await B.send('POST', '/rooms', { name: '알고리즘 같이 풀어요', kind: 'study' })).json.room;
    const event = (await C.send('POST', '/rooms', { name: '가을 MT 준비방', kind: 'event' })).json.room;
    assert.equal(study.status, 'pending'); assert.equal(event.status, 'pending');
    assert.ok(!(await C.get('/rooms/discover')).json.rooms.some(r => r.id === study.id), '승인 전엔 찾기에 안 보임');
    assert.equal((await B.send('POST', `/admin/rooms/${study.id}/approve`)).status, 403, '일반 회원은 승인 불가');
    assert.ok((await A.get('/admin/rooms')).json.rooms.some(r => r.id === study.id));
    await A.send('POST', `/admin/rooms/${study.id}/approve`); await A.send('POST', `/admin/rooms/${event.id}/reject`);
    assert.equal((await B.rooms()).find(r => r.id === study.id).status, 'active');
    assert.ok((await C.get('/rooms/discover')).json.rooms.some(r => r.id === study.id));
    assert.ok(!(await C.rooms()).some(r => r.id === event.id), '거절된 방은 목록에서 사라짐');
    assert.equal((await C.send('POST', '/rooms', { name: 'x', kind: 'all' })).json.error, 'bad_kind');
    PASS('스터디·이벤트방은 운영진 승인 후 열림(거절 시 사라짐), 전체방 종류는 만들 수 없음');

    // 비공개방: 찾기에 안 보이고, 방장 초대로만 참여. 멤버가 아니면 메시지·실시간 모두 못 받음
    const priv = (await B.send('POST', '/rooms', { name: '비밀 기획', kind: 'social', visibility: 'private' })).json.room;
    assert.ok(!(await C.get('/rooms/discover')).json.rooms.some(r => r.id === priv.id));
    assert.equal((await C.send('POST', `/rooms/${priv.id}/join`)).status, 404);
    await B.send('POST', `/rooms/${priv.id}/messages`, { body: '비밀 메시지' });
    await sleep(300);
    assert.ok(!lc.events.some(e => e.type === 'message' && e.message?.body === '비밀 메시지'), '비멤버에게 실시간 전달 금지');
    assert.equal((await A.send('POST', `/rooms/${priv.id}/invite`, { userIds: [C.id] })).json.added, 1, '운영진은 초대 가능');
    assert.ok(lc.events.some(e => e.type === 'room' && e.action === 'invited' && e.roomId === priv.id) || (await sleep(300), lc.events.some(e => e.action === 'invited')));
    assert.equal((await C.get(`/rooms/${priv.id}/messages`)).json.messages[0].body, '비밀 메시지');
    assert.equal((await C.send('POST', `/rooms/${priv.id}/invite`, { userIds: [A.id] })).status, 403, '일반 멤버는 초대 불가');
    PASS('비공개방: 찾기·참여 불가, 비멤버는 내용·실시간 못 받음, 방장/운영진 초대로만 참여');

    // 방별 안 읽은 수·읽음, 정렬(전체방 고정 + 최근 메시지순)
    for (const t of ['하나', '둘', '셋']) await B.send('POST', `/rooms/${social.id}/messages`, { body: t });
    await C.send('POST', `/rooms/${study.id}/join`);
    let cr = await C.rooms(), sr = cr.find(r => r.id === social.id);
    assert.equal(sr.unread, 3); assert.equal(sr.lastMessage.body, '셋'); assert.equal(sr.lastMessage.author, '회원비');
    assert.equal(cr.find(r => r.id === study.id).unread, 0, '참여 전 메시지는 안 읽음에 안 셈');
    assert.equal((await B.rooms()).find(r => r.id === social.id).unread, 0, '내가 보낸 메시지는 안 읽음 아님');
    assert.equal(cr[0].kind, 'all'); assert.equal(cr[1].id, social.id, '전체방 다음은 최근 메시지 방');
    const msgs = (await C.get(`/rooms/${social.id}/messages`)).json.messages;
    await C.send('POST', `/rooms/${social.id}/read`, { lastId: msgs[1].id });
    assert.equal((await C.rooms()).find(r => r.id === social.id).unread, 1, '실제로 본 데까지만 읽음');
    await C.send('POST', `/rooms/${social.id}/read`, { lastId: msgs[2].id });
    await C.send('POST', `/rooms/${social.id}/read`, { lastId: msgs[0].id });
    assert.equal((await C.rooms()).find(r => r.id === social.id).unread, 0, '읽음은 뒤로 가지 않음');
    PASS('방별 안 읽은 수·마지막 메시지·읽음(본 데까지, 되돌아가지 않음)·정렬(전체 고정+최근순)');

    // 방장이 나가면 다음 사람이 방장, 운영진은 방 보관 가능
    await B.send('POST', `/rooms/${social.id}/leave`);
    assert.equal((await C.rooms()).find(r => r.id === social.id).myRole, 'owner');
    assert.equal((await A.send('DELETE', `/rooms/${study.id}`)).json.ok, true);
    assert.ok(!(await C.rooms()).some(r => r.id === study.id));
    PASS('방장이 나가면 다음 멤버가 방장, 운영진은 방 보관');
    console.log('ALL PASS');
  } finally {
    lc.close();
    console.log('cleanup:', sql(`DELETE FROM users WHERE username IN (${made.map(u => `'${u}'`).join(',')})`), sql(`UPDATE rooms SET status='archived', archived=true WHERE kind <> 'all' AND NOT EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = rooms.id)`));
  }
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; });
