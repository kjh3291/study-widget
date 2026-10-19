// 실험실 서버 점검: 직책(부원·임원·회장)과 권한 분리, 승인 때 직책, 임원 신청, 회장은 최고 관리자만, 문의·답장
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
const newId = p => p + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
async function login(u) {
  const l = await serverCall(URL, 'POST', '/auth/login', { username: u, password: pw });
  const token = l.json.token, h = { authorization: 'Bearer ' + token };
  return { id: l.json.user.id, username: u, token, user: l.json.user,
    get: p => fetch(URL + p, { headers: h }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })),
    send: (m, p, b) => serverCall(URL, m, p, b, token) };
}
async function member(name, prefix = '99') {   // 99… = 실험실 자동 승인
  const u = newId(prefix); made.push(u);
  await serverCall(URL, 'POST', '/auth/signup', { username: u, password: pw, displayName: name, consent: CONSENT });
  return login(u);
}
function live(m) {
  const events = [], ws = new WebSocket(WS);
  const ready = new Promise(res => { ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: m.token })); ws.onmessage = e => { const ev = JSON.parse(e.data); events.push(ev); if (ev.type === 'ready') res(); }; });
  return { ready, events, close: () => ws.close() };
}

(async () => {
  const O = await member('최고관리'), A = await member('관리자'), B = await member('부원비');
  sql(`UPDATE users SET role='owner' WHERE username='${O.username}'; UPDATE users SET role='admin' WHERE username='${A.username}'`);
  const [lo, la, lb] = [live(O), live(A), live(B)];
  try {
    await Promise.all([lo.ready, la.ready, lb.ready]);
    // 가입 신청(자동 승인 아닌 학번) → 관리자가 승인하며 직책을 정함
    const P = newId('97'); made.push(P);
    await serverCall(URL, 'POST', '/auth/signup', { username: P, password: pw, displayName: '신청자', consent: CONSENT });
    const pid = (await A.get('/admin/users')).json.users.find(u => u.username === P).id;
    assert.equal((await A.send('POST', `/admin/users/${pid}/approve`, { position: 'president' })).json.error, 'president_owner_only', '관리자는 회장으로 승인 못 함');
    const ap = await A.send('POST', `/admin/users/${pid}/approve`, { position: 'officer' });
    assert.equal(ap.json.user.position, 'officer'); assert.equal(ap.json.user.role, 'member', '직책은 권한과 따로');
    assert.equal(B.user.position, 'member', '자동 승인·기본 직책은 부원');
    PASS('가입 승인 때 직책 지정(기본 부원), 회장은 최고 관리자만, 직책과 권한은 따로');

    // 직책 변경: 관리자는 회원의 부원↔임원, 회장은 최고 관리자만, 최고 관리자는 본인 직책도
    assert.equal((await A.send('POST', `/admin/users/${B.id}/position`, { position: 'officer' })).json.user.position, 'officer');
    assert.equal((await A.send('POST', `/admin/users/${B.id}/position`, { position: 'president' })).json.error, 'president_owner_only');
    assert.equal((await A.send('POST', `/admin/users/${O.id}/position`, { position: 'member' })).json.error, 'outranked', '관리자는 자기 이상 권한의 직책을 못 바꿈');
    assert.equal((await O.send('POST', `/admin/users/${B.id}/position`, { position: 'president' })).json.user.position, 'president');
    assert.equal((await A.send('POST', `/admin/users/${B.id}/position`, { position: 'member' })).json.error, 'president_owner_only', '회장 해제도 최고 관리자만');
    assert.equal((await O.send('POST', `/admin/users/${O.id}/position`, { position: 'president' })).json.user.position, 'president', '최고 관리자는 본인 직책');
    await sleep(300);
    assert.ok(lb.events.some(e => e.type === 'account' && e.what === 'position' && e.position === 'president'), '바뀐 사람에게 알림');
    const prof = (await B.get('/profiles')).json.members.find(m => m.id === B.id);
    assert.equal(prof.position, 'president'); assert.equal(prof.role, 'member', '회장이어도 권한은 일반 회원');
    assert.equal((await B.get('/admin/users')).status, 403, '직책이 회장이어도 운영진 관리는 권한(role)으로만');
    PASS('직책 변경 규칙(회장 지정·해제는 최고 관리자만), 프로필에 직책, 권한은 role로만');

    // 임원 신청: 부원만, 중복 불가, 관리자 승인 → 임원 / 거절 / 취소
    await O.send('POST', `/admin/users/${B.id}/position`, { position: 'member' });
    const rq = await B.send('POST', '/me/position-request', { message: '스터디 관리 맡고 싶어요' });
    assert.equal(rq.json.request.status, 'pending');
    assert.equal((await B.send('POST', '/me/position-request', {})).json.error, 'request_pending', '검토 중이면 다시 못 냄');
    await sleep(300);
    assert.ok(la.events.some(e => e.type === 'admin' && e.what === 'position-request'), '관리자에게 알림');
    const list = (await A.get('/admin/position-requests')).json.requests;
    const mine = list.find(r => r.user.id === B.id); assert.ok(mine && mine.message === '스터디 관리 맡고 싶어요');
    assert.equal((await B.get('/admin/position-requests')).status, 403);
    await A.send('POST', `/admin/position-requests/${mine.id}/approve`);
    assert.equal((await B.get('/me')).json.user.position, 'officer');
    assert.equal((await B.send('POST', '/me/position-request', {})).json.error, 'already_officer', '임원 이상은 신청 불가(회장 신청 없음)');
    await O.send('POST', `/admin/users/${B.id}/position`, { position: 'member' });
    const r2 = (await B.send('POST', '/me/position-request', {})).json.request;
    await A.send('POST', `/admin/position-requests/${r2.id}/reject`);
    assert.equal((await B.get('/me/position-request')).json.request.status, 'rejected');
    assert.equal((await B.get('/me')).json.user.position, 'member');
    await B.send('POST', '/me/position-request', {});
    assert.equal((await B.send('DELETE', '/me/position-request')).json.ok, true);
    assert.equal((await B.get('/me/position-request')).json.request.status, 'cancelled');
    PASS('임원 신청: 부원만·중복 불가·관리자 알림, 승인→임원, 거절, 취소');

    // 문의: 보내기 → 관리자 목록·알림 → 답장 → 보낸 사람 알림·내 문의에 답장
    assert.equal((await B.send('POST', '/inquiries', { category: 'bug', body: '짧' })).json.error, 'too_short');
    const iq = (await B.send('POST', '/inquiries', { category: 'bug', body: '시간표 화면에서 과목을 누르면 앱이 멈춰요', appVersion: 'v1.4.0', platform: 'win32 10.0 x64' })).json.inquiry;
    assert.equal(iq.status, 'new');
    await sleep(300);
    assert.ok(lo.events.some(e => e.type === 'admin' && e.what === 'inquiry'));
    const open = (await A.get('/admin/inquiries')).json;
    assert.ok(open.inquiries.some(q => q.id === iq.id && q.user.id === B.id && q.appVersion === 'v1.4.0')); assert.ok(open.counts.new >= 1);
    assert.equal((await B.get('/admin/inquiries')).status, 403);
    const upd = (await A.send('PATCH', `/admin/inquiries/${iq.id}`, { status: 'done', reply: '고쳤어요. 다음 버전에서 확인해 주세요.' })).json.inquiry;
    assert.equal(upd.status, 'done'); assert.ok(upd.repliedAt);
    await sleep(300);
    assert.ok(lb.events.some(e => e.type === 'account' && e.what === 'inquiry-reply' && e.id === iq.id));
    const my = (await B.get('/me/inquiries')).json.inquiries.find(q => q.id === iq.id);
    assert.equal(my.reply, '고쳤어요. 다음 버전에서 확인해 주세요.');
    assert.ok(!(await A.get('/admin/inquiries')).json.inquiries.some(q => q.id === iq.id), '처리 완료는 기본 목록에서 빠짐');
    assert.ok((await A.get('/admin/inquiries?status=done')).json.inquiries.some(q => q.id === iq.id));
    PASS('문의: 보내기(앱 버전·운영체제), 관리자 목록·알림, 상태·답장, 보낸 사람 알림·내 문의');
    console.log('ALL PASS');
  } finally {
    [lo, la, lb].forEach(l => l.close());
    sql(`DELETE FROM users WHERE username IN (${made.map(u => `'${u}'`).join(',')})`);
  }
})().catch(e => { console.error(e); process.exit(1); });
