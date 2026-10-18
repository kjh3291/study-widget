// 운영 전환 리허설: 운영 앱(v1.4 서버 모드)을 실험실 서버에 연결해
// ① 첫 기기(윈도우): 예전 GitHub 동기화 설정·데이터·파일 → 로그인 → 서버로 전부 올라감, GitHub 토큰 삭제
// ② 두 번째 기기(맥): 다른 옛 데이터 → 로그인 → 서버 데이터로 시작, 다른 로컬 파일은 '서버 전환 전 보관'으로
// 사용: node scripts/test-prod-switch.js   (실험실 서버·SSH 필요)
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { serverCall } = require('../server-sync');
const electron = require('electron');

const URL = 'http://100.96.247.43:8444';
const user = '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0'), pw = crypto.randomBytes(12).toString('base64url');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-switch-'));
const PASS = m => console.log('PASS: ' + m);
const write = (root, rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

function profile(name, config, files) {
  const dir = path.join(tmp, name), studeck = path.join(dir, 'Desktop', 'Studeck');
  fs.mkdirSync(studeck, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ lmsAuto: false, autoDownload: false, assignFix1: true, materialsFix2: true, pendingShared: {}, ...config }));
  for (const [rel, text] of Object.entries(files)) write(studeck, rel, text);
  fs.mkdirSync(path.join(studeck, '.git'), { recursive: true }); // 예전 GitHub 동기화 흔적
  return { dir, studeck };
}
function run(p) {
  const result = path.join(p.dir, 'result.json');
  const r = spawnSync(electron, [path.join(__dirname, 'test-prod-switch-app.cjs')], { env: { ...process.env, PROFILE_DIR: p.dir, USER: user, PW: pw, RESULT_FILE: result,
    STUDECK_SERVER_URL: URL, STUDECK_CHANNEL: 'prod' }, timeout: 120000, encoding: 'utf8' });
  const out = JSON.parse(fs.readFileSync(result, 'utf8'));
  if (out.error) throw new Error(out.error + '\n' + r.stderr?.slice(-500));
  return out;
}

(async () => {
  try {
    await serverCall(URL, 'POST', '/auth/signup', { username: user, password: pw, displayName: '전환리허설', consent: '2026-10-v1' });
    const login = await serverCall(URL, 'POST', '/auth/login', { username: user, password: pw });
    const auth = { authorization: 'Bearer ' + login.json.token };
    const serverTodos = async () => (await fetch(URL + '/sync?since=0', { headers: auth }).then(r => r.json())).changes.filter(c => c.kind === 'todo' && !c.deleted).map(c => c.id).sort();
    const serverFiles = async () => Object.fromEntries((await fetch(URL + '/files?since=0', { headers: auth }).then(r => r.json())).files.filter(f => !f.deleted).map(f => [f.path, f.size]));

    // ① 윈도우: 예전 GitHub 동기화 상태
    const win = profile('windows', {
      sync: { enabled: true, repo: 'kjh3291/studeck-data', token: 'ghp_FAKE_OLD_TOKEN' },
      todos: [{ id: 'w1', text: '자료구조 과제', done: false }, { id: 'w2', text: '선대 복습', done: false }, { id: 'w3', text: '세미나', done: true }],
      events: [{ id: 'e1', title: '중간고사', start: '2026-10-20' }],
      timetableFull: [{ name: '자료구조', times: [{ day: 1, start: '09:00', end: '10:30' }] }],
    }, { '자료구조/보조자료/정리노트.pdf': '윈도우 노트', '자료구조/과제/HW1.docx': '윈도우 과제', '자료구조/수업자료/강의.pdf': 'LMS 자료' });
    const w = run(win);
    assert.ok(w.ui.gate && !w.ui.gitBox && !w.ui.importBtn && !w.ui.lab, '운영 앱: 시작 화면, GitHub 칸·가져오기·LAB 없음 ' + JSON.stringify(w.ui));
    assert.equal(w.sync.mode, 'server'); assert.equal(w.sync.hasRepo, false);
    assert.ok(!w.configText.includes('ghp_FAKE_OLD_TOKEN'), 'GitHub 토큰이 설정에서 지워져야 함');
    PASS('운영 앱(v1.4) 첫 실행: 예전 GitHub 설정 → 로그인 전 시작 화면, GitHub 토큰 삭제');
    assert.deepEqual(await serverTodos(), ['w1', 'w2', 'w3']);
    assert.deepEqual(await serverFiles(), { '자료구조/보조자료/정리노트.pdf': Buffer.byteLength('윈도우 노트'), '자료구조/과제/HW1.docx': Buffer.byteLength('윈도우 과제') });
    assert.equal(w.pending.length, 0);
    PASS('첫 기기(윈도우) 로그인 → 할 일·일정·시간표·보조자료·과제가 서버로(수업자료 제외)');

    // ② 맥: 서로 다른 옛 데이터·파일
    const mac = profile('mac', {
      sync: { enabled: true, repo: 'kjh3291/studeck-data', token: 'ghp_FAKE_MAC_TOKEN' },
      todos: [{ id: 'm1', text: '맥에만 있던 옛 할 일', done: false }],
      pendingShared: { todos: { exists: true, value: [] } },
    }, { '자료구조/보조자료/정리노트.pdf': '윈도우 노트', '자료구조/과제/HW1.docx': '맥의 옛 과제 내용', '오토마타/보조자료/맥전용.pdf': '맥에만 있는 파일' });
    const m = run(mac);
    assert.deepEqual(m.todos, ['w1', 'w2', 'w3'], '맥은 서버 데이터로 시작');
    assert.deepEqual(await serverTodos(), ['w1', 'w2', 'w3'], '서버는 맥 옛 데이터로 바뀌지 않음');
    PASS('두 번째 기기(맥) 로그인 → 서버 데이터로 시작(맥의 옛 할 일은 올라가지 않음)');
    const files = await serverFiles();
    assert.equal(files['자료구조/과제/HW1.docx'], Buffer.byteLength('윈도우 과제')); assert.equal(files['오토마타/보조자료/맥전용.pdf'], undefined);
    assert.equal(fs.readFileSync(path.join(mac.studeck, '자료구조', '과제', 'HW1.docx'), 'utf8'), '윈도우 과제');
    const kept = path.join(mac.studeck, '.studeck', '서버 전환 전 보관');
    assert.equal(fs.readFileSync(path.join(kept, '자료구조', '과제', 'HW1.docx'), 'utf8'), '맥의 옛 과제 내용');
    assert.equal(fs.readFileSync(path.join(kept, '오토마타', '보조자료', '맥전용.pdf'), 'utf8'), '맥에만 있는 파일');
    PASS('맥 파일: 서버 것으로 맞추고, 다르거나 맥에만 있던 파일은 기기 안 "서버 전환 전 보관"에 남김(서버엔 안 올림)');
    console.log('ALL PASS');
  } finally {
    try { execFileSync('ssh', ['kimti4', `cd ~/studeck/lab/server && docker compose exec -T db psql -U studeck -d studeck -At -c "DELETE FROM users WHERE username='${user}'"`]); } catch (e) { console.error('cleanup', e.message); }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; });
