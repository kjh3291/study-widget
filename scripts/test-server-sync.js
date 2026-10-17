// 실험실 서버 대상 두 기기 동기화 시나리오. 실제 sync-service + server-sync를 두 벌 만들어
// 기기 A·B처럼 주고받는다. 사용: node scripts/test-server-sync.js [서버주소=http://100.96.247.43:8444]
// 실험실 서버(AUTO_APPROVE)에서만 실행한다. 매 실행마다 새 시험 계정을 만든다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSyncService } = require('../sync-service');
const { trackChanges, initializeOutbox } = require('../sync-model');
const { createServerStore, serverCall } = require('../server-sync');

const URL = process.argv[2] || 'http://100.96.247.43:8444';
if (/:8443\b/.test(URL)) { console.error('운영 서버에는 실행하지 않습니다.'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-server-sync-'));
const username = '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0'); // 실험실 자동 승인용 가짜 학번
const password = crypto.randomBytes(12).toString('base64url');

async function device(name) {
  const login = await serverCall(URL, 'POST', '/auth/login', { username, password, deviceName: name });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  let config = initializeOutbox({ sync: { enabled: true, mode: 'server', url: URL, username, token: login.json.token } }, {});
  let offline = false; // 네트워크 끊김 흉내
  const store = createServerStore({ file: path.join(tmp, name + '-mirror.json'),
    fetchImpl: (...a) => offline ? Promise.reject(new TypeError('fetch failed')) : fetch(...a) });
  const service = createSyncService({
    load: () => JSON.parse(JSON.stringify(config)), save: c => { config = JSON.parse(JSON.stringify(c)); },
    read: store.read, write: store.write, transport: store.transport,
    conflicts: async () => null, resolveFiles: async () => {}, dirty: async () => false, autoResolve: 'local',
  });
  return {
    edit(patch) { config = trackChanges(config, patch); },
    get: () => config,
    sync: resolution => service.run(resolution),
    token: login.json.token,
    setOffline: v => { offline = v; },
  };
}

const todo = (id, text, extra = {}) => ({ id, text, done: false, ...extra });
const PASS = m => console.log('PASS: ' + m);

(async () => {
  const signup = await serverCall(URL, 'POST', '/auth/signup', { username, password, displayName: '테스트', consent: '2026-10-v1' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal(signup.json.user.status, 'approved', '실험실 서버는 99 학번을 자동 승인해야 합니다');

  const A = await device('A'), B = await device('B');

  // 1. 첫 업로드(기존 데이터 이전) → 다른 기기가 그대로 받는다
  A.edit({ todos: [todo('t1', '자료구조 과제'), todo('t2', '선대 복습')], events: [{ id: 'e1', title: '중간고사', start: '2026-10-20' }],
    timetableFull: [{ name: '자료구조', times: [{ day: 1, start: '09:00' }] }], theme: 'dark' });
  let r = await A.sync(); assert.ok(r.ok, r.error);
  r = await B.sync(); assert.ok(r.ok, r.error);
  assert.deepEqual(B.get().todos.map(t => t.id), ['t1', 't2']);
  assert.equal(B.get().events[0].title, '중간고사');
  assert.equal(B.get().timetableFull[0].name, '자료구조');
  assert.equal(B.get().theme, 'dark');
  PASS('A의 할 일·일정·시간표·설정이 B로 전달');

  // 2. 서로 다른 항목을 동시에(오프라인) 수정 → 둘 다 유지
  A.edit({ todos: [todo('t1', '자료구조 과제', { done: true }), todo('t2', '선대 복습')] });
  B.edit({ todos: [todo('t1', '자료구조 과제'), todo('t2', '선대 복습'), todo('t3', 'B에서 추가')] });
  assert.ok((await A.sync()).ok); assert.ok((await B.sync()).ok); assert.ok((await A.sync()).ok);
  for (const d of [A, B]) {
    const byId = Object.fromEntries(d.get().todos.map(t => [t.id, t]));
    assert.equal(byId.t1.done, true); assert.ok(byId.t3, 'B 추가분 유지');
  }
  PASS('A 완료 처리 + B 새 할 일 → 양쪽 모두 반영(덮어쓰기 없음)');

  // 3. 시간표: 양쪽에서 다른 과목 추가 → 둘 다 남음
  A.edit({ timetableFull: [...A.get().timetableFull, { name: '선형대수학', times: [] }] });
  B.edit({ timetableFull: [...B.get().timetableFull, { name: '오토마타이론', times: [] }] });
  assert.ok((await A.sync()).ok); assert.ok((await B.sync()).ok); assert.ok((await A.sync()).ok);
  for (const d of [A, B]) assert.deepEqual(d.get().timetableFull.map(c => c.name).sort(), ['선형대수학', '오토마타이론', '자료구조']);
  PASS('시간표 과목을 양쪽에서 추가 → 3과목 모두 유지');

  // 4. 삭제 전파
  A.edit({ todos: A.get().todos.filter(t => t.id !== 't2'), events: [] });
  assert.ok((await A.sync()).ok); assert.ok((await B.sync()).ok);
  assert.ok(!B.get().todos.some(t => t.id === 't2')); assert.deepEqual(B.get().events, []);
  PASS('할 일·일정 삭제가 다른 기기에도 반영(마지막 일정 삭제 포함)');

  // 5. 같은 항목을 양쪽에서 다르게 수정 → 선택 창 없이 나중에 동기화한 기기의 수정으로 맞춤
  A.edit({ todos: A.get().todos.map(t => t.id === 't1' ? { ...t, text: 'A 제목' } : t) });
  B.edit({ todos: B.get().todos.map(t => t.id === 't1' ? { ...t, text: 'B 제목' } : t) });
  assert.ok((await A.sync()).ok);
  r = await B.sync();
  assert.ok(r.ok, r.error); assert.equal(r.kept, 1, '덮어쓴 항목 수 알림');
  assert.ok((await A.sync()).ok);
  for (const d of [A, B]) assert.equal(d.get().todos.find(t => t.id === 't1').text, 'B 제목');
  PASS('같은 할 일 동시 수정 → 선택 창 없이 최신 수정으로 양쪽 일치(이전 값은 서버 기록)');

  // 6. 오프라인(서버 연결 실패) 중 수정은 보관됐다가 재연결 후 전송
  B.setOffline(true);
  B.edit({ todos: [...B.get().todos, todo('t9', '오프라인 추가')] });
  r = await B.sync();
  assert.equal(r.ok, false);
  assert.ok(Object.keys(B.get().pendingShared).includes('todos'), '미전송 표시 유지');
  B.setOffline(false);
  r = await B.sync(); assert.ok(r.ok, r.error);
  assert.ok((await A.sync()).ok);
  assert.ok(A.get().todos.some(t => t.id === 't9'));
  PASS('연결 실패 시 변경 보관 → 재연결 후 다른 기기에 전달');

  // 7. 다른 계정은 내 데이터를 못 본다
  const other = '99' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
  await serverCall(URL, 'POST', '/auth/signup', { username: other, password, displayName: '다른 사람', consent: '2026-10-v1' });
  const ol = await serverCall(URL, 'POST', '/auth/login', { username: other, password, deviceName: 'X' });
  const res = await fetch(URL + '/sync?since=0', { headers: { authorization: 'Bearer ' + ol.json.token } }).then(x => x.json());
  assert.equal(res.changes.length, 0);
  PASS('다른 계정에서는 내 항목이 보이지 않음');

  console.log('ALL PASS (' + username + ')');
})().catch(e => { console.error('FAIL:', e.message); process.exitCode = 1; })
  .finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
