// '내 자료' 폴더 보기 계산 점검(file-tree.js): 앱은 이 기기 수업자료, 웹은 LMS 링크, 보조자료는 서버 + 학기 정리 표시
const assert = require('node:assert/strict');
const F = require('../file-tree');
const now = Date.parse('2027-01-10T12:00:00+09:00'), DAY = 86400000;
const remote = {
  '자료구조/보조자료/정리.pdf': { sha: 'a', size: 100, updatedAt: 1, expiresAt: now + 20 * DAY, term: '2026년 2학기' },
  '자료구조/보조자료/1단원/풀이.txt': { sha: 'b', size: 50, updatedAt: 2, expiresAt: now + 200 * DAY },
  '자료구조/보조자료/지운것.pdf': { sha: 'c', size: 9, deleted: true },
  '알고리즘/보조자료/옛노트.pdf': { sha: 'd', size: 70, expired: true, expiresAt: now - DAY },
  '알고리즘/과제/예전앱.docx': { sha: 'e', size: 5 },   // 예전 앱이 올린 과제: 보기에서 뺌(앱은 이 기기 과제를 보여 줌)
};
const lms = {
  materials: [{ url: 'u1', courseName: '자료구조', title: '1주차 강의' }, { url: 'u2', courseName: '알고리즘', title: '정렬' }, { courseName: 'x', title: '링크 없음' }],
  assignFiles: [{ url: 'h1', courseName: '자료구조', title: 'HW1.pdf' }],
};
const materialsDone = { u1: { course: '자료구조', path: 'C:\\Users\\me\\Desktop\\Studeck\\자료구조\\수업자료\\1주차.pdf', at: 5 },
  u3: { course: '자료구조', path: 'C:\\Users\\me\\Desktop\\Studeck\\자료구조\\수업자료\\1주차.pdf', same: true },   // 같은 파일 같이 씀
  u4: { course: '알고리즘', path: 'D:\\study\\algo\\materials\\지운.pdf', missing: true } };
const assignDone = { h1: { course: '자료구조', path: 'C:\\Users\\me\\Desktop\\Studeck\\자료구조\\과제\\HW1.pdf' } };

// 앱: 보조자료(서버) + 수업자료·과제(이 기기)
const app = [...F.serverEntries(remote), ...F.lmsEntries('app', { lms, materialsDone, assignDone })];
let tree = F.buildTree(app);
assert.deepEqual(tree.folders.map(f => f.name), ['알고리즘', '자료구조']);
const ds = F.findFolder(tree, '자료구조');
assert.deepEqual(ds.folders.map(f => f.name), ['보조자료', '수업자료', '과제'], '과목 안 순서');
assert.equal(F.findFolder(tree, '자료구조/보조자료/1단원').files[0].name, '풀이.txt');
assert.equal(F.findFolder(tree, '자료구조/수업자료').files.length, 1, '같은 파일은 한 번만');
assert.equal(F.findFolder(tree, '자료구조/수업자료').files[0].source, 'local');
assert.equal(F.findFolder(tree, '자료구조/과제').files[0].localPath.endsWith('HW1.pdf'), true);
assert.equal(F.findFolder(tree, '알고리즘/수업자료'), null, '지운(missing) 자료는 안 보임');
assert.equal(F.findFolder(tree, '자료구조/보조자료').count, 2, '휴지통 파일 제외, 하위 폴더 포함 개수');
assert.equal(F.findFolder(tree, '자료구조/보조자료').size, 150);
assert.equal(app.some(e => e.path.includes('예전앱')), false);
assert.equal(F.findFolder(tree, '없는/경로'), null);

// 웹: 수업자료·과제는 LMS 링크
const web = [...F.serverEntries(remote), ...F.lmsEntries('web', { lms, materialsDone, assignDone })];
tree = F.buildTree(web);
const w = F.findFolder(tree, '자료구조/수업자료').files[0];
assert.deepEqual([w.source, w.url, w.name, w.localPath], ['lms', 'u1', '1주차 강의', undefined]);
assert.equal(F.findFolder(tree, '자료구조/과제').files[0].source, 'lms');
assert.equal(web.filter(e => e.source === 'lms').length, 3, '링크 없는 항목 제외');

// 학기 정리 표시
const [soon, later, gone] = ['자료구조/보조자료/정리.pdf', '자료구조/보조자료/1단원/풀이.txt', '알고리즘/보조자료/옛노트.pdf'].map(p => app.find(e => e.path === p));
assert.equal(F.expiryChip(soon, now).label, 'D-20 정리'); assert.equal(F.expiryChip(soon, now).tone, 'soon');
assert.equal(F.expiryChip({ ...soon, expiresAt: now + 3 * DAY }, now).tone, 'urgent');
assert.equal(F.expiryChip(later, now), null, '30일보다 멀면 표시 안 함');
assert.equal(F.expiryChip(gone, now).label, '이 기기에만');
assert.equal(F.expiryChip(app.find(e => e.source === 'local'), now), null);
assert.equal(F.nextExpiry(F.findFolder(F.buildTree(app), '자료구조')), now + 20 * DAY);
assert.equal(F.nextExpiry(F.findFolder(F.buildTree(app), '알고리즘')), 0, '정리된 파일은 예정에서 제외');
// 학기 정리 알림: 30일·7일·하루 전 단계별로 한 번씩, 정리 후 한 번
const R = (days, extra = {}) => ({ '자료구조/보조자료/a.pdf': { size: 1, expiresAt: now + days * DAY, term: '2026년 2학기', ...extra }, '자료구조/보조자료/b.pdf': { size: 1, expiresAt: now + days * DAY, term: '2026년 2학기' } });
assert.deepEqual(F.termNotices(R(40), now), [], '30일보다 멀면 알림 없음');
let n = F.termNotices(R(20), now);
assert.equal(n.length, 1); assert.match(n[0].id, /-d30$/); assert.match(n[0].body, /2026년 2학기 보조자료 2개는 \d+\/\d+까지 서버에 보관/); assert.match(n[0].body, /이 기기 파일은 그대로/);
assert.match(F.termNotices(R(5), now)[0].id, /-d7$/);
assert.match(F.termNotices(R(1), now)[0].id, /-d1$/); assert.equal(F.termNotices(R(1), now)[0].title, '내일 서버에서 보조자료를 정리해요');
assert.notEqual(F.termNotices(R(20), now)[0].id, F.termNotices(R(5), now)[0].id, '단계마다 다른 알림');
n = F.termNotices({ 'x/보조자료/a': { expired: true, expiresAt: now - DAY }, 'x/과제/b': { expired: true, expiresAt: now - DAY } }, now);
assert.equal(n.length, 1); assert.match(n[0].id, /^term-done-/); assert.match(n[0].body, /1개를 서버에서 지웠어요/);
// GPT 디자인 데이터로 바꾸기
assert.equal(F.semesterOf(Date.parse('2026-11-03')), '2026년 2학기'); assert.equal(F.semesterOf(Date.parse('2027-02-10')), '2026년 2학기'); assert.equal(F.semesterOf(Date.parse('2026-04-01')), '2026년 1학기');
const dd = F.toDesignData(app, { now, usage: { used: 5, limit: 100 }, local: { ['loc:' + materialsDone.u1.path]: { size: 2048, mtime: Date.parse('2026-11-02T10:00:00') }, ['loc:' + assignDone.h1.path]: null } });
assert.deepEqual(dd.courses.map(c => c.name), ['알고리즘', '자료구조']); assert.equal(dd.usage, 5); assert.equal(dd.quota, 100);
const fNote = dd.files.find(f => f.id === 'srv:자료구조/보조자료/정리.pdf'), fDeep = dd.files.find(f => f.rel === '자료구조/보조자료/1단원/풀이.txt');
assert.deepEqual([fNote.category, fNote.type, fNote.server, fNote.local, fNote.cleanupDays, fNote.semester], ['보조자료', 'PDF', true, true, 20, '2026년 2학기']);
assert.equal(fDeep.name, '1단원/풀이.txt', '하위 폴더는 이름 앞에');
const fGone = dd.files.find(f => f.rel === '알고리즘/보조자료/옛노트.pdf');
assert.deepEqual([fGone.server, fGone.local, fGone.cleanupDays], [false, true, null], '정리됨 → 이 기기에만');
const fLec = dd.files.find(f => f.category === '수업자료'), fHw = dd.files.find(f => f.category === '과제(내 제출물)');
assert.deepEqual([fLec.local, fLec.bytes, fLec.modified, fLec.lms], [true, 2048, '2026-11-02', true]);
assert.equal(fHw.local, false, '이 기기에 없는 파일(지웠거나 옮김)');
const dw = F.toDesignData(web, { now });
assert.equal(dw.files.find(f => f.category === '수업자료').url, 'u1');
console.log('PASS: 내 자료 디자인 데이터 — 과목·분류·크기·학기·정리 남은 날·이 기기/서버 여부, 웹은 LMS 링크');
console.log('PASS: 학기 정리 알림 — 30일·7일·하루 전 단계별 한 번씩, 정리 후 한 번(과제 등 보조자료 밖은 제외)');
console.log('PASS: 내 자료 폴더 — 과목›보조자료·수업자료·과제, 앱은 이 기기 파일·웹은 LMS 링크, 중복·지운 자료 제외, 학기 정리 예정·정리됨 표시');
