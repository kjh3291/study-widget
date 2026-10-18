// 실험실 서버 집중(열품타식) 점검: 새벽 5시 기준 공부 날짜, 실시간 공부 중 표시(공개한 사람만), 오늘·이번 주 랭킹, 스터디방 랭킹
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { serverCall } = require('../server-sync');

const URL = 'http://100.96.247.43:8444', WS = 'ws://100.96.247.43:8444/ws', CONSENT = '2026-10-v1';
const sql = q => execFileSync('ssh', ['kimti4', `cd ~/studeck/lab/server && docker compose exec -T db psql -U studeck -d studeck -At -c "${q}"`]).toString().trim();
const pw = crypto.randomBytes(12).toString('base64url');
const PASS = m => console.log('PASS: ' + m);
const made = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 서버와 같은 규칙: 한국 시간에서 5시간 뺀 날짜
const studyDay = (t = Date.now()) => new Date(t + 9 * 3600e3 - 5 * 3600e3).toISOString().slice(0, 10);
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function member(name) {
  const u = '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0'); made.push(u);
  await serverCall(URL, 'POST', '/auth/signup', { username: u, password: pw, displayName: name, consent: CONSENT });
  const l = await serverCall(URL, 'POST', '/auth/login', { username: u, password: pw });
  const token = l.json.token, h = { authorization: 'Bearer ' + token };
  const get = p => fetch(URL + p, { headers: h }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
  const send = (m, p, b) => serverCall(URL, m, p, b, token);
  return { id: l.json.user.id, username: u, token, get, send,
    sessions: list => send('POST', '/sync', { since: 0, changes: [{ kind: 'setting', id: 'focus', updatedAt: Date.now(), data: { v: { sessions: list } } }] }),
    profile: showStudy => send('PUT', '/me/profile', { nickname: '', bio: '', showStudy, showTimetable: false }) };
}
function live(m) {
  const events = [], ws = new WebSocket(WS);
  const ready = new Promise(res => { ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: m.token })); ws.onmessage = e => { const ev = JSON.parse(e.data); events.push(ev); if (ev.type === 'ready') res(); }; });
  return { ready, events, send: o => ws.send(JSON.stringify(o)), close: () => ws.close() };
}

(async () => {
  const A = await member('집중에이'), B = await member('집중비'), C = await member('비공개씨');
  const wa = live(A), wb = live(B), wc = live(C);
  try {
    await Promise.all([wa.ready, wb.ready, wc.ready]);
    await A.profile(true); await B.profile(true); await C.profile(false);
    const today = studyDay(), yesterday = addDays(today, -1);

    // 공부 날짜 규칙: 한국 시간 새벽 4시는 전날, 5시는 그날
    const kst = (d, h) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00+09:00`);
    assert.equal(studyDay(kst('2026-10-19', 4)), '2026-10-18'); assert.equal(studyDay(kst('2026-10-19', 5)), '2026-10-19');
    const r0 = (await A.get('/focus/ranking')).json;
    assert.equal(r0.dayStartHour, 5); assert.equal(r0.from, today, '서버도 같은 공부 날짜');
    PASS('공부 날짜는 한국 시간 새벽 5시 기준(서버·앱 같은 규칙)');

    // 기록: seconds가 있으면 그 값, 옛 기록은 minutes×60
    await A.sessions([{ date: today, seconds: 3000, minutes: 50, subject: '알고리즘' }, { date: today, minutes: 10, subject: '영어' }, { date: yesterday, seconds: 7200, subject: '알고리즘' }]);
    await B.sessions([{ date: today, seconds: 5400, subject: '자료구조' }]);
    await C.sessions([{ date: today, seconds: 9000, subject: '비밀' }]);
    let r = (await A.get('/focus/ranking?period=today')).json;
    const mine = id => r.ranking.find(x => x.userId === id);
    assert.equal(mine(A.id).seconds, 3600); assert.equal(mine(B.id).seconds, 5400);
    assert.ok(mine(B.id).rank < mine(A.id).rank, '많이 한 사람이 위');
    assert.equal(mine(C.id), undefined, '비공개는 랭킹에 안 보임');
    assert.equal(r.me.seconds, 3600); assert.equal(r.me.public, true);
    const rc = (await C.get('/focus/ranking')).json;
    assert.equal(rc.me.public, false); assert.equal(rc.me.seconds, 9000); assert.ok(rc.me.rank <= rc.ranking.find(x => x.userId === B.id).rank, '비공개여도 내 순위는 나에게만');
    PASS('오늘 랭킹: 공개한 사람만, 시간순, 비공개는 자기 시간·순위만 봄');

    const w = (await A.get('/focus/ranking?period=week')).json;
    assert.equal(new Date(w.from + 'T00:00:00Z').getUTCDay(), 1, '주는 월요일부터');
    const expectWeek = 3600 + (yesterday >= w.from ? 7200 : 0);
    assert.equal(w.ranking.find(x => x.userId === A.id).seconds, expectWeek);
    PASS('이번 주 랭킹(월요일 시작, 어제 기록 포함)');

    // 실시간: A가 재기 시작 → B는 알림 받음. 비공개 C가 재도 아무도 모름
    wa.send({ type: 'focus', state: 'running', subject: '알고리즘', elapsed: 120 });
    wc.send({ type: 'focus', state: 'running', subject: '비밀', elapsed: 0 });
    await sleep(800);
    const evA = wb.events.find(e => e.type === 'focus' && e.userId === A.id);
    assert.ok(evA && evA.state === 'running' && evA.subject === '알고리즘' && evA.seconds >= 120);
    assert.ok(!wb.events.some(e => e.type === 'focus' && e.userId === C.id), '비공개 회원의 공부 중은 안 알림');
    const lv = (await B.get('/focus/live')).json.live;
    assert.ok(lv.some(x => x.userId === A.id && x.state === 'running'));
    assert.ok(!lv.some(x => x.userId === C.id));
    assert.ok((await C.get('/focus/live')).json.live.some(x => x.userId === C.id), '나는 내 상태를 봄');
    r = (await B.get('/focus/ranking')).json;
    assert.ok(r.ranking.find(x => x.userId === A.id).seconds >= 3600 + 120, '재는 중인 시간도 랭킹에 반영');
    assert.equal(r.ranking.find(x => x.userId === A.id).studying, true);
    PASS('실시간 공부 중: 공개한 사람만 알림·목록, 재는 중인 시간도 랭킹에 합산');

    wa.send({ type: 'focus', state: 'paused', subject: '알고리즘', elapsed: 200 });
    await sleep(600);
    assert.ok(wb.events.some(e => e.type === 'focus' && e.userId === A.id && e.state === 'paused'));
    wa.close(); await sleep(800);
    assert.ok(wb.events.some(e => e.type === 'focus' && e.userId === A.id && e.state === 'stopped'), '연결이 끊기면 공부 중 해제');
    assert.ok(!(await B.get('/focus/live')).json.live.some(x => x.userId === A.id));
    PASS('일시정지·연결 끊김 시 공부 중 해제 알림');

    // 스터디방 랭킹: 그 방 멤버만, 비멤버는 못 봄
    const room = (await B.send('POST', '/rooms', { name: '집중 스터디', kind: 'social' })).json.room;
    await A.send('POST', `/rooms/${room.id}/join`);
    const rr = (await B.get(`/focus/ranking?room=${room.id}`)).json;
    assert.deepEqual(rr.ranking.map(x => x.userId).sort(), [A.id, B.id].sort());
    assert.equal((await C.get(`/focus/ranking?room=${room.id}`)).status, 404);
    PASS('방 랭킹은 그 방 멤버끼리만');

    // 프로필 오늘 공부 시간도 같은 날짜 규칙·초 단위
    const prof = (await B.get('/profiles')).json.members.find(m => m.id === A.id);
    assert.equal(prof.study.todayMinutes, 60);
    PASS('프로필의 오늘 공부 시간도 새벽 5시 기준');
    console.log('ALL PASS');
  } finally {
    [wb, wc].forEach(w => w.close());
    sql(`DELETE FROM rooms WHERE kind <> 'all' AND owner_id IN (SELECT id FROM users WHERE username IN (${made.map(u => `'${u}'`).join(',')})); DELETE FROM users WHERE username IN (${made.map(u => `'${u}'`).join(',')})`);
  }
})().catch(e => { console.error(e); process.exit(1); });
