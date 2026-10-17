// 두 기기 파일 동기화 시나리오(실험실 서버). 임시 폴더 2개를 기기 A·B의 Studeck 폴더로 쓴다.
// 사용: node scripts/test-file-sync.js [서버주소=http://100.96.247.43:8444]
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createFileSync } = require('../file-sync');
const { serverCall } = require('../server-sync');

const URL = process.argv[2] || 'http://100.96.247.43:8444';
if (/:8443\b|ts\.net/.test(URL)) { console.error('운영 서버에는 실행하지 않습니다.'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-file-sync-'));
const user = '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0'), password = crypto.randomBytes(12).toString('base64url');
const PASS = m => console.log('PASS: ' + m);

async function device(name) {
  const login = await serverCall(URL, 'POST', '/auth/login', { username: user, password, deviceName: name });
  const conn = { url: URL, username: user, token: login.json.token };
  const root = path.join(tmp, name), trashDir = path.join(tmp, name + '-휴지통');
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(trashDir, { recursive: true });
  const fsync = createFileSync({ root: () => root, stateFile: path.join(tmp, name + '-state.json'),
    trash: async abs => fs.renameSync(abs, path.join(trashDir, path.basename(abs) + '-' + Date.now())) });
  const abs = p => path.join(root, ...p.split('/'));
  return {
    write(p, text, mtime) { fs.mkdirSync(path.dirname(abs(p)), { recursive: true }); fs.writeFileSync(abs(p), text); if (mtime) fs.utimesSync(abs(p), new Date(mtime), new Date(mtime)); },
    read: p => fs.existsSync(abs(p)) ? fs.readFileSync(abs(p), 'utf8') : null,
    rm: p => fs.rmSync(abs(p)),
    trashCount: () => fs.readdirSync(trashDir).length,
    sync: async () => { const r = await fsync.run(conn); assert.ok(r.ok, r.error); return r; },
    token: conn.token,
  };
}

(async () => {
  await serverCall(URL, 'POST', '/auth/signup', { username: user, password, displayName: '파일동기화', consent: '2026-10-v1' });
  const A = await device('A'), B = await device('B');
  const NOTE = '자료구조/보조자료/정리노트.pdf', HW = '자료구조/과제/HW1.docx', DEEP = '선형대수학/보조자료/1단원/풀이.txt';
  A.write(NOTE, '노트 v1'); A.write(HW, '과제 v1'); A.write(DEEP, '풀이');
  A.write('자료구조/수업자료/강의.pdf', 'LMS에서 받은 자료'); A.write('자료구조/보조자료/.DS_Store', 'x'); A.write('자료구조/보조자료/녹화.mp4', 'video');
  A.write('APP/보조자료/proj/build/out.bin', 'build cache');
  let r = await A.sync();
  assert.equal(r.uploaded, 3); assert.ok(r.skipped.some(s => s.reason === '동영상'));
  r = await B.sync();
  assert.equal(r.downloaded, 3);
  assert.equal(B.read(NOTE), '노트 v1'); assert.equal(B.read(DEEP), '풀이');
  assert.equal(B.read('자료구조/수업자료/강의.pdf'), null); assert.equal(B.read('APP/보조자료/proj/build/out.bin'), null);
  PASS('보조자료·과제(하위 폴더 포함)만 전달, 수업자료·빌드 캐시·.DS_Store·동영상은 제외');

  B.write(NOTE, '노트 v2 (B 수정)', Date.now());
  assert.equal((await B.sync()).uploaded, 1);
  await A.sync(); assert.equal(A.read(NOTE), '노트 v2 (B 수정)');
  PASS('B에서 고친 파일이 A에 반영');

  // 오프라인에서 양쪽이 같은 파일을 다르게 수정 → 나중 수정이 현재, 다른 쪽은 서버 이전 버전
  const t = Date.now();
  A.write(HW, '과제 A판', t - 60000); B.write(HW, '과제 B판(나중)', t);
  await A.sync();                     // A판이 먼저 올라감
  r = await B.sync(); assert.equal(B.read(HW), '과제 B판(나중)');
  r = await A.sync(); assert.equal(A.read(HW), '과제 B판(나중)');
  // 반대: B가 더 오래된 수정을 늦게 올림
  A.write(HW, '과제 A 최신', t + 120000); B.write(HW, '과제 B 옛날', t + 60000);
  await A.sync(); r = await B.sync();
  assert.equal(r.kept, 1); assert.equal(B.read(HW), '과제 A 최신');
  const versions = await fetch(URL + '/files/versions?path=' + encodeURIComponent(HW), { headers: { authorization: 'Bearer ' + A.token } }).then(x => x.json());
  const kept = await Promise.all(versions.versions.map(v => fetch(URL + '/files/content?sha=' + v.sha256, { headers: { authorization: 'Bearer ' + A.token } }).then(x => x.text())));
  assert.ok(kept.includes('과제 A판') && kept.includes('과제 B 옛날'), '진 쪽 수정이 서버 이전 버전에 남아야 함');
  PASS('양쪽 동시 수정 → 선택 창 없이 나중 수정이 현재, 다른 쪽은 서버 이전 버전으로 보관');

  A.rm(DEEP); await A.sync();
  const before = B.trashCount(); await B.sync();
  assert.equal(B.read(DEEP), null); assert.equal(B.trashCount(), before + 1);
  PASS('A에서 지운 파일 → 서버 휴지통, B에서는 기기 휴지통으로 이동');

  B.write(NOTE, '노트 v3 (B가 계속 수정)', Date.now() + 200000); A.rm(NOTE);
  await A.sync(); await B.sync(); await A.sync();
  assert.equal(A.read(NOTE), '노트 v3 (B가 계속 수정)'); assert.equal(B.read(NOTE), '노트 v3 (B가 계속 수정)');
  PASS('한쪽 삭제 vs 다른 쪽 수정 → 수정이 남음(데이터 유실 없음)');

  await fetch(URL + '/files/restore', { method: 'POST', headers: { authorization: 'Bearer ' + A.token, 'content-type': 'application/json' }, body: JSON.stringify({ path: DEEP }) });
  await B.sync(); assert.equal(B.read(DEEP), '풀이');
  PASS('서버 휴지통에서 복구 → 기기에 다시 생김');

  r = await A.sync(); assert.equal(r.uploaded + r.downloaded + r.removedRemote + r.trashedLocal, 1); // DEEP 복구분만
  r = await A.sync(); assert.equal(r.uploaded + r.downloaded + r.removedRemote + r.trashedLocal, 0);
  PASS('변경 없으면 아무것도 전송하지 않음');
  console.log('ALL PASS (' + user + ')');
})().catch(e => { console.error('FAIL:', e.stack || e.message); process.exitCode = 1; })
  .finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
