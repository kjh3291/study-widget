// 실험실 서버 파일 저장소 점검: 업로드·받기·버전·늦은 도착·휴지통·복구·되돌리기·크기 제한·격리.
// 사용: node scripts/test-server-files.js [서버주소=http://100.96.247.43:8444]  (운영 주소 금지)
const LAB = require('./lab-target');   // 서버 주소·DB 확인 방법(기본 실험실 서버)
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { serverCall } = require('../server-sync');

const URL = process.argv[2] || LAB.URL;
if (/:8443\b|ts\.net/.test(URL)) { console.error('운영 서버에는 실행하지 않습니다.'); process.exit(1); }
const id = () => '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
const pw = crypto.randomBytes(12).toString('base64url');
const PASS = m => console.log('PASS: ' + m);

async function account() {
  const u = id();
  await serverCall(URL, 'POST', '/auth/signup', { username: u, password: pw, displayName: '파일시험', consent: '2026-10-v1' });
  const l = await serverCall(URL, 'POST', '/auth/login', { username: u, password: pw });
  assert.equal(l.status, 200);
  const auth = { authorization: 'Bearer ' + l.json.token };
  const q = (p, extra = '') => `?path=${encodeURIComponent(p)}${extra}`;
  return {
    username: u,
    put: (p, buf, at) => fetch(URL + '/files/content' + q(p, '&updatedAt=' + at), { method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: buf }).then(async r => ({ status: r.status, json: await r.json() })),
    get: (p) => fetch(URL + '/files/content' + q(p), { headers: auth }).then(async r => ({ status: r.status, buf: Buffer.from(await r.arrayBuffer()) })),
    getSha: (sha) => fetch(URL + '/files/content?sha=' + sha, { headers: auth }).then(r => r.status),
    del: (p, at) => fetch(URL + '/files' + q(p, '&updatedAt=' + at), { method: 'DELETE', headers: auth }).then(r => r.json()),
    json: (u, opt = {}) => fetch(URL + u, { ...opt, headers: { ...auth, ...(opt.body ? { 'content-type': 'application/json' } : {}) } }).then(r => r.json()),
  };
}

(async () => {
  const A = await account(), B = await account();
  const P = '자료구조/보조자료/정리노트.pdf';
  const v1 = Buffer.from('버전 1 내용'), v2 = Buffer.from('버전 2 내용'), old = Buffer.from('오래된 오프라인 수정');

  let r = await A.put(P, v1, 1000); assert.equal(r.json.result, 'stored');
  r = await A.put(P, v1, 1500); assert.equal(r.json.result, 'unchanged');
  r = await A.get(P); assert.equal(r.buf.toString(), '버전 1 내용');
  PASS('업로드·같은 내용 재업로드는 변화 없음·내려받기 일치(한글 경로)');

  r = await A.put(P, v2, 2000); assert.equal(r.json.result, 'stored');
  r = await A.put(P, old, 1800); assert.equal(r.json.result, 'kept_as_version');
  r = await A.get(P); assert.equal(r.buf.toString(), '버전 2 내용');
  const versions = (await A.json('/files/versions?path=' + encodeURIComponent(P))).versions;
  assert.equal(versions.length, 2);
  PASS('나중 수정이 현재 파일, 늦게 도착한 오래된 수정은 이전 버전으로 보관(선택 창 없음)');

  const changes = await A.json('/files?since=0');
  assert.equal(changes.files.length, 1); assert.equal(changes.files[0].path, P);
  const again = await A.json('/files?since=' + changes.cursor);
  assert.equal(again.files.length, 0);
  PASS('변경분 목록과 커서');

  let d = await A.del(P, 1900); assert.equal(d.result, 'newer_edit_kept');
  d = await A.del(P, 3000); assert.equal(d.result, 'trashed');
  assert.equal((await A.get(P)).status, 404);
  const trash = (await A.json('/files/trash')).trash;
  assert.equal(trash[0].path, P);
  const del = (await A.json('/files?since=' + changes.cursor)).files[0];
  assert.equal(del.deleted, true);
  PASS('삭제는 휴지통으로(다른 기기에 삭제로 전달), 삭제보다 나중 수정이 있으면 수정 유지');

  await A.json('/files/restore', { method: 'POST', body: JSON.stringify({ path: P }) });
  assert.equal((await A.get(P)).buf.toString(), '버전 2 내용');
  PASS('휴지통에서 복구');

  const v1row = versions.find(v => v.size === v1.length);
  const rev = await A.json('/files/revert', { method: 'POST', body: JSON.stringify({ path: P, vid: v1row.vid }) });
  assert.equal(rev.file.size, v1.length);
  assert.equal((await A.get(P)).buf.toString(), '버전 1 내용');
  PASS('이전 버전으로 되돌리기(지금 파일은 버전으로 남음)');

  assert.equal((await B.get(P)).status, 404);
  assert.equal(await B.getSha(crypto.createHash('sha256').update(v1).digest('hex')), 404);
  assert.equal((await B.json('/files?since=0')).files.length, 0);
  PASS('다른 계정은 내 파일·내용 해시로도 접근 불가');

  r = await A.put('../../etc/passwd', v1, 1); assert.equal(r.status, 400);
  r = await A.put('noFolder.pdf', v1, 1); assert.equal(r.status, 400);
  r = await A.put('a/b/big.bin', Buffer.alloc(50 * 1024 * 1024 + 1), 1); assert.equal(r.status, 413);
  const usage = await A.json('/files/usage');
  assert.ok(usage.used > 0 && usage.limit >= 1024 * 1024 * 1024);
  assert.equal((await fetch(URL + '/admin/storage', { headers: { authorization: 'Bearer ' + (await serverCall(URL, 'POST', '/auth/login', { username: A.username, password: pw })).json.token } })).status, 403, '저장 공간 현황은 운영진만');
  PASS('위험한 경로 거부, 50MB 초과 거부, 사용량 표시, 저장 공간 현황은 운영진만');
  // 학기 단위 정리: 실험실 손잡이(/files/expire-now)로 '1년 뒤'를 흉내 낸다
  const C = await account();
  const T = '알고리즘/보조자료/학기노트.pdf';
  const tv = Buffer.from('이번 학기 노트'), tv2 = Buffer.from('고친 노트');
  await C.put(T, tv, 5000); await C.put(T, Buffer.from('이번 학기 노트 v0'), 4000);   // 버전 하나
  await C.put(T, tv, 6000);
  const before = (await C.json('/files?since=0')).files.find(f => f.path === T);
  assert.equal(before.expired, false); assert.ok(before.expiresAt > Date.now()); assert.match(before.term, /^\d{4}년 [12]학기$/);
  const u0 = await C.json('/files/usage');
  assert.deepEqual(u0.terms, { ends: ['06-30', '12-31'], graceDays: 30 });
  let ex = await C.json('/files/expire-now', { method: 'POST', body: JSON.stringify({ at: Date.now() }) });
  assert.equal(ex.expired, 0, '아직 기한 전이면 정리 안 함');
  ex = await C.json('/files/expire-now', { method: 'POST', body: JSON.stringify({ at: before.expiresAt + 1000 }) });
  assert.equal(ex.expired, 1);
  const row = (await C.json('/files?since=0')).files.find(f => f.path === T);
  assert.equal(row.expired, true); assert.equal(row.deleted, false, '삭제(휴지통)가 아니라 정리 — 기기는 자기 파일을 지우지 않음');
  assert.ok(row.rev > before.rev, '다른 기기에 정리 사실이 전달됨');
  assert.equal((await C.get(T)).status, 404, '내용은 서버에서 지워짐');
  assert.equal((await C.json('/files/versions?path=' + encodeURIComponent(T))).versions.length, 0, '이전 버전도 정리');
  assert.equal((await C.json('/files/usage')).used, 0, '사용량에서 빠짐');
  assert.equal((await C.json('/files/trash')).trash.length, 0, '휴지통에도 안 보임');
  r = await C.put(T, tv, 7000); assert.equal(r.json.result, 'expired', '같은 내용을 다시 올려도(예전 앱) 저장하지 않음');
  assert.equal((await C.json('/files/usage')).used, 0);
  r = await C.put(T, tv2, 8000); assert.equal(r.json.result, 'stored', '고친 파일은 새 학기 파일로 저장');
  assert.equal(r.json.file.expired, false); assert.ok(r.json.file.expiresAt > before.expiresAt - 1000);
  assert.equal((await C.get(T)).buf.toString(), '고친 노트');
  PASS('학기 정리 — 종강+유예가 지나면 서버 내용·이전 버전 삭제, 행은 expired로 남아 기기에 전달, 같은 내용 재업로드는 거절, 고친 파일은 새 학기로');
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; });
