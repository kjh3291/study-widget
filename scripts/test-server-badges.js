// 칭호·배지 서버 점검: 동기화된 기록으로 자동 배지, 처음 얻은 때 기록, 칭호 고르기, 멤버 목록 표시, 운영진 특별 배지 주기·회수
// 사용: node scripts/test-server-badges.js   (대상 서버는 scripts/lab-target.js)
const LAB = require('./lab-target');   // 서버 주소·DB 확인 방법(기본 실험실 서버)
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { serverCall } = require('../server-sync');
const URL = LAB.URL, CONSENT = '2026-10-v1';
const pw = crypto.randomBytes(12).toString('base64url');
const PASS = m => console.log('PASS: ' + m);
const made = [];
async function member(name) {
  const u = '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0'); made.push(u);
  await serverCall(URL, 'POST', '/auth/signup', { username: u, password: pw, displayName: name, consent: CONSENT });
  const l = await serverCall(URL, 'POST', '/auth/login', { username: u, password: pw });
  const token = l.json.token, h = { authorization: 'Bearer ' + token };
  return { id: l.json.user.id, username: u,
    get: p => fetch(URL + p, { headers: h }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })),
    send: (m, p, b) => serverCall(URL, m, p, b, token) };
}
const day = n => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);

(async () => {
  const A = await member('배지시험A'), B = await member('배지시험B');
  try {
    // 7일 연속 하루 100분(모두 한국 6시 시작) = 11시간 40분, 할 일 50개 완료
    const sessions = Array.from({ length: 7 }, (_, i) => ({ date: day(i), minutes: 100, start: `${day(i)}T21:00:00Z`.replace(day(i), day(i - 1)) }));
    const todos = Array.from({ length: 52 }, (_, i) => ({ kind: 'todo', id: 't' + i, data: { o: i, v: { id: 't' + i, text: '할 일 ' + i, done: i < 50 } }, updatedAt: Date.now() }));
    const r = await A.send('POST', '/sync', { since: 0, changes: [{ kind: 'setting', id: 'focus', data: { v: { sessions } }, updatedAt: Date.now() }, ...todos] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    let b = (await A.get('/me/badges')).json;
    assert.deepEqual(b.fresh.sort(), ['early-bird', 'first-focus', 'focus-10h', 'streak-7', 'todo-50'].sort());
    assert.equal(b.progress.find(p => p.id === 'focus-50h').earned, false); assert.equal(b.progress.find(p => p.id === 'focus-50h').label, '50시간 공부');
    const firstAt = b.badges.find(x => x.id === 'streak-7').earnedAt;
    b = (await A.get('/me/badges')).json;
    assert.deepEqual(b.fresh, [], '두 번째엔 새 배지 없음');
    assert.equal(b.badges.find(x => x.id === 'streak-7').earnedAt, firstAt, '처음 얻은 때 유지');
    // 기록이 줄어도 배지는 남음
    await A.send('POST', '/sync', { since: 0, changes: [{ kind: 'setting', id: 'focus', data: { v: { sessions: [] } }, updatedAt: Date.now() + 1000 }] });
    assert.equal((await A.get('/me/badges')).json.badges.length, 5, '얻은 배지는 빼앗지 않음');
    PASS('자동 배지: 동기화된 집중·할 일로 계산, 처음 얻은 때 기록, 기록이 줄어도 유지');

    assert.equal((await A.send('PUT', '/me/title', { badge: 'focus-100h' })).status, 400, '없는 배지는 칭호로 못 고름');
    assert.equal((await A.send('PUT', '/me/title', { badge: 'streak-7' })).status, 200);
    let mem = (await B.get('/profiles')).json.members.find(m => m.id === A.id);
    assert.equal(mem.title, '7일 연속'); assert.equal(mem.badgeCount, 5);
    assert.equal((await B.get(`/users/${A.id}/badges`)).json.badges.length, 5, '다른 회원 배지 보기');
    PASS('칭호: 가진 배지만 고를 수 있고, 멤버 목록에 칭호·배지 수 표시');

    assert.equal((await B.send('POST', `/admin/users/${A.id}/badges`, { label: 'COSMIC 1기' })).status, 403, '부원은 특별 배지를 못 줌');
    LAB.sql(`UPDATE users SET role='admin' WHERE username='${B.username}'`);
    assert.equal((await B.send('POST', `/admin/users/${A.id}/badges`, { label: 'x' })).status, 400, '이름이 너무 짧음');
    const g = await B.send('POST', `/admin/users/${A.id}/badges`, { label: 'COSMIC 1기', note: '창립 멤버' });
    assert.equal(g.status, 200); assert.match(g.json.badge, /^custom:\d+$/);
    b = (await A.get('/me/badges')).json;
    const sp = b.badges.find(x => x.id === g.json.badge);
    assert.deepEqual([sp.label, sp.desc, sp.special, sp.grantedBy], ['COSMIC 1기', '창립 멤버', true, '배지시험B']);
    await A.send('PUT', '/me/title', { badge: g.json.badge });
    assert.equal((await B.get('/profiles')).json.members.find(m => m.id === A.id).title, 'COSMIC 1기');
    assert.equal((await B.send('DELETE', `/admin/users/${A.id}/badges/streak-7`)).status, 400, '자동 배지는 회수 안 함');
    assert.equal((await B.send('DELETE', `/admin/users/${A.id}/badges/${encodeURIComponent(g.json.badge)}`)).status, 200);
    mem = (await B.get('/profiles')).json.members.find(m => m.id === A.id);
    assert.equal(mem.title, null, '회수하면 칭호도 해제'); assert.equal(mem.badgeCount, 5);
    PASS('특별 배지: 운영진만 주고(이름·까닭), 칭호로 쓰고, 회수하면 칭호 해제. 자동 배지는 회수 불가');
    console.log('ALL PASS');
  } finally {
    try { console.log('cleanup:', LAB.sql(`DELETE FROM users WHERE username IN (${made.map(u => `'${u}'`).join(',')})`)); } catch (e) { console.error('cleanup', e.message); }
  }
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; });
