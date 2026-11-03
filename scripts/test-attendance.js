// 출석 상태 점검(attendance.js): 화면 4개 + 출석 인정, 예전 기록(공결·병결) 그대로
const assert = require('node:assert/strict');
const A = require('../attendance');
// 누르면: 자동 출석 → 지각 → 결석 → 미정 → 자동
assert.equal(A.next(undefined, '출석'), '지각');
assert.equal(A.next('지각', '출석'), '결석');
assert.equal(A.next('결석', '출석'), '미정');
assert.equal(A.next('미정', '출석'), undefined, '미정 다음은 자동으로');
// 수업 전(자동 값 없음)에서는 출석부터
assert.equal(A.next(undefined, ''), '출석');
assert.equal(A.next('출석', ''), '지각');
// 내가 '출석'으로 정했는데 자동도 출석이면 같은 값은 건너뜀
assert.equal(A.next('출석', '출석'), '지각');
// 예전 기록: 공결·병결은 지우지 않고 출석 인정으로 보임, 누르면 자동으로
assert.equal(A.info('공결').label, '출석 인정(공결)'); assert.equal(A.info('병결').group, 'excused');
assert.equal(A.next('공결', '출석'), undefined);
assert.equal(A.next('엉뚱한값', '출석'), undefined, '모르는 값은 자동으로');
// 집계: 결석만 결석, 출석 인정은 따로
assert.deepEqual(A.count(['출석', '지각', '결석', '결석', '공결', '병결', '미정']), { present: 1, late: 1, absent: 2, excused: 2, unknown: 1 });
assert.deepEqual(A.MAIN, ['출석', '지각', '결석', '미정']);
console.log('PASS: 출석 상태 — 화면 4개(출석·지각·결석·미정) 순환, 공결·병결은 출석 인정으로 보존, 집계');
