// 새 학기 도우미 점검(semester.js)
const assert = require('node:assert/strict');
const S = require('../semester');
assert.equal(S.termOf('2026-11-03'), '2026-2'); assert.equal(S.termOf('2027-02-20'), '2026-2'); assert.equal(S.termOf('2027-03-02'), '2027-1'); assert.equal(S.termOf('2027-08-31'), '2027-1');
assert.equal(S.termLabel('2027-1'), '2027년 1학기'); assert.equal(S.termStart('2027-2'), '2027-09-01');
const tt = [{ name: '자료구조', times: [] }, { name: '컴퓨터네트워크', times: [] }];
const att = { semesterStart: '2026-09-01', overrides: { 자료구조: { 3: '결석', 4: '지각' } } };
// 처음 쓰는 사람: 안내 없이 학기 기록만
assert.deepEqual(S.check({ timetableFull: tt }, '2026-11-03'), { prompt: false, setTerm: '2026-2' });
// 같은 학기·겨울방학(1~2월)엔 안내 없음
assert.equal(S.check({ currentTerm: '2026-2', timetableFull: tt }, '2027-02-27').prompt, false);
// 3월이 되면 안내
const s = { currentTerm: '2026-2', timetableFull: tt, attendance: att, semesterArchive: {} };
assert.deepEqual(S.check(s, '2027-03-02'), { prompt: true, from: '2026-2', to: '2027-1', fromLabel: '2026년 2학기', toLabel: '2027년 1학기' });
// '나중에'를 누르면 그날까지 안내 안 함
assert.equal(S.check({ ...s, semesterSnooze: '2027-03-05' }, '2027-03-04').prompt, false);
assert.equal(S.check({ ...s, semesterSnooze: '2027-03-05' }, '2027-03-06').prompt, true);
// 이미 비어 있으면(새 시간표를 직접 넣기 전 상태 등) 학기 기록만
assert.deepEqual(S.check({ currentTerm: '2026-2', timetableFull: [], attendance: { semesterStart: '', overrides: {} } }, '2027-03-02'), { prompt: false, setTerm: '2027-1' });
// 새 학기 준비: 보관함으로 옮기고 비우기
const p = S.start(s, '2027-03-02', 123);
assert.equal(p.currentTerm, '2027-1'); assert.deepEqual(p.timetableFull, []); assert.deepEqual(p.attendance, { semesterStart: '', overrides: {} });
assert.deepEqual(p.semesterArchive['2026-2'], { term: '2026-2', label: '2026년 2학기', archivedAt: 123, timetableFull: tt, attendance: att });
// 요약
assert.deepEqual(S.summary({ semesterArchive: p.semesterArchive }).map((x) => [x.label, x.subjects.join(','), x.absent, x.late]), [['2026년 2학기', '자료구조,컴퓨터네트워크', 1, 1]]);
// 실행 취소
const u = S.undo({ ...s, ...p }, '2026-2');
assert.equal(u.currentTerm, '2026-2'); assert.deepEqual(u.timetableFull, tt); assert.deepEqual(u.attendance, att); assert.deepEqual(u.semesterArchive, {});
assert.equal(S.undo({ semesterArchive: {} }, 'x'), null);
console.log('PASS: 새 학기 도우미 — 학기 계산(3~8월 1학기·9~2월 2학기), 3월·9월에 안내, 나중에, 지난 학기 시간표·출석 보관·되돌리기');
