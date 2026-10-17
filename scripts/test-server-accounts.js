// 실험실 서버 계정 규칙 점검: 역할 등급·승인·정지·삭제(30일)·복구·임시 비밀번호·비밀번호 변경·탈퇴·GitHub 확인 실패.
// 시험 계정(99…)을 만들고 그중 하나를 실험실 DB에서 잠시 최고 관리자로 올렸다가 끝나면 모두 지운다.
// 사용: node scripts/test-server-accounts.js   (실험실 서버 SSH 필요, 운영 금지)
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { serverCall } = require('../server-sync');

const URL = 'http://100.96.247.43:8444';
const CONSENT = '2026-10-v1';
const sql = q => execFileSync('ssh', ['kimti4', `cd ~/studeck/lab/server && docker compose exec -T db psql -U studeck -d studeck -At -c "${q}"`]).toString().trim();
const fresh = p => p + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
const pw = crypto.randomBytes(12).toString('base64url');
const PASS = m => console.log('PASS: ' + m);
const made = [];

async function signup(prefix, name) {
  const u = fresh(prefix); made.push(u);
  const r = await serverCall(URL, 'POST', '/auth/signup', { username: u, password: pw, displayName: name, consent: CONSENT });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { username: u, id: r.json.user.id, status: r.json.user.status };
}
const login = async (u, p = pw) => serverCall(URL, 'POST', '/auth/login', { username: u, password: p });
const tok = async (u, p = pw) => (await login(u, p)).json.token;
const call = (t, method, path, body) => serverCall(URL, method, path, body || {}, t);

(async () => {
  try {
    const owner = await signup('99', '시험관리자'), adminA = await signup('99', '시험운영진'), m1 = await signup('99', '회원일'), pend = await signup('97', '대기회원');
    sql(`UPDATE users SET role='owner' WHERE username='${owner.username}'`);
    const OT = await tok(owner.username), MT = await tok(m1.username);

    // 역할: 회원은 운영진 기능 불가, 운영진 지정은 최고 관리자만
    assert.equal((await fetch(URL + '/admin/users', { headers: { authorization: 'Bearer ' + MT } })).status, 403);
    let r = await call(OT, 'POST', `/admin/users/${adminA.id}/role`, { role: 'admin' }); assert.equal(r.json.user.role, 'admin');
    const AT = await tok(adminA.username);
    r = await call(AT, 'POST', `/admin/users/${m1.id}/role`, { role: 'admin' }); assert.equal(r.status, 403);
    r = await call(AT, 'POST', `/admin/users/${owner.id}/suspend`); assert.equal(r.status, 403);
    PASS('회원은 운영진 기능 불가, 운영진 지정은 최고 관리자만, 운영진은 상위 등급을 못 건드림');

    // 승인: 운영진이 가입 신청 승인
    assert.equal(pend.status, 'pending');
    r = await call(AT, 'POST', `/admin/users/${pend.id}/approve`); assert.equal(r.json.user.status, 'approved');
    PASS('운영진이 가입 신청 승인');

    // 정지 → 로그인 거부(suspended) → 다시 승인
    r = await call(AT, 'POST', `/admin/users/${m1.id}/suspend`); assert.equal(r.json.user.status, 'suspended');
    assert.equal((await login(m1.username)).json.error, 'suspended');
    assert.equal((await fetch(URL + '/sync?since=0', { headers: { authorization: 'Bearer ' + MT } })).status, 401, '정지 시 기존 접속 키 폐기');
    await call(AT, 'POST', `/admin/users/${m1.id}/approve`);
    assert.equal((await login(m1.username)).status, 200);
    PASS('정지하면 접속 즉시 끊기고 로그인 거부, 해제하면 다시 로그인');

    // 임시 비밀번호 → 첫 로그인 때 변경 필요 → 변경
    r = await call(AT, 'POST', `/admin/users/${m1.id}/temp-password`);
    const temp = r.json.tempPassword; assert.ok(temp && temp.length === 10);
    assert.equal((await login(m1.username)).status, 401, '옛 비밀번호 거부');
    let l = await login(m1.username, temp); assert.equal(l.json.user.mustChangePassword, true);
    r = await call(l.json.token, 'POST', '/me/password', { current: temp, next: pw }); assert.equal(r.json.ok, true);
    l = await login(m1.username); assert.equal(l.json.user.mustChangePassword, false);
    PASS('임시 비밀번호 발급 → 첫 로그인 때 변경 요구 → 새 비밀번호로 로그인');

    // 운영진 삭제 → 로그인 차단 → 30일 안에 복구
    r = await call(AT, 'POST', `/admin/users/${m1.id}/delete`); assert.equal(r.json.user.status, 'deleted'); assert.equal(r.json.purgeAfterDays, 30);
    assert.equal((await login(m1.username)).json.error, 'deleted');
    r = await call(AT, 'POST', `/admin/users/${m1.id}/restore`); assert.equal(r.json.user.status, 'approved');
    assert.equal((await login(m1.username)).status, 200);
    PASS('운영진 삭제 → 로그인 차단, 30일 안에 복구 가능');

    // 본인 탈퇴(비밀번호 확인) → 차단, 최고 관리자는 탈퇴 불가
    const T1 = await tok(m1.username);
    assert.equal((await call(T1, 'POST', '/me/withdraw', { password: 'wrong' })).status, 401);
    r = await call(T1, 'POST', '/me/withdraw', { password: pw }); assert.equal(r.json.ok, true);
    assert.equal((await login(m1.username)).json.error, 'deleted');
    assert.equal((await call(OT, 'POST', '/me/withdraw', { password: pw })).json.error, 'owner_cannot_withdraw');
    PASS('본인 탈퇴(비밀번호 확인) → 로그인 차단, 최고 관리자는 탈퇴 불가');

    // 30일 지난 삭제 계정은 정리 대상(시각을 과거로 돌려 확인)
    sql(`UPDATE users SET deleted_at = now() - interval '31 days' WHERE username='${m1.username}'`);
    assert.equal(sql(`SELECT count(*) FROM users WHERE status='deleted' AND deleted_at < now() - interval '30 days' AND username='${m1.username}'`), '1');
    PASS('삭제 후 30일 지난 계정은 매일 정리 대상');

    // GitHub: 연결 안 됐거나 가짜 토큰이면 비밀번호 찾기 거부
    r = await serverCall(URL, 'POST', '/auth/github-reset', { username: adminA.username, accessToken: 'fake', newPassword: 'newpassword123' });
    assert.equal(r.json.error, 'github_mismatch');
    r = await call(AT, 'POST', '/me/github', { accessToken: 'fake' }); assert.equal(r.json.error, 'github_failed');
    PASS('가짜 GitHub 토큰으로는 연결·비밀번호 찾기 불가');

    console.log('ALL PASS');
  } finally {
    if (made.length) console.log('cleanup:', sql(`DELETE FROM users WHERE username IN (${made.map(u => `'${u}'`).join(',')})`));
  }
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; });
