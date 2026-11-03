// 칭호·배지 계산 점검(server/src/badges-calc.js)
const assert = require('node:assert/strict');
(async () => {
  const B = await import('../server/src/badges-calc.js');
  const day = (d, minutes, start) => ({ date: d, minutes, start });
  // 연속: 30분 이상인 날만, 끊기면 다시
  assert.equal(B.longestStreak([day('2026-11-01', 40), day('2026-11-02', 30), day('2026-11-03', 10), day('2026-11-04', 60)]), 2, '10분인 날은 끊김');
  assert.equal(B.longestStreak([day('2026-12-30', 30), day('2026-12-31', 30), day('2027-01-01', 30)]), 3, '해가 바뀌어도 이어짐');
  assert.equal(B.longestStreak([day('2026-11-01', 20), { date: '2026-11-01', seconds: 600 }]), 1, '같은 날 여러 번은 합쳐서');
  assert.equal(B.longestStreak([]), 0);
  // 지표
  const sessions = [day('2026-11-01', 600, '2026-10-31T20:30:00Z'), day('2026-11-02', 30, '2026-11-02T10:00:00Z'), day('2026-11-03', 0)];   // 첫 번째: 한국 5:30 시작
  const m = B.metrics({ sessions, todos: [{ done: true }, { done: true, skipped: true }, { done: false }], messages: 3 });
  assert.deepEqual(m, { sessions: 2, seconds: 630 * 60, streak: 2, early: 1, todos: 1, messages: 3 });
  // 진행·획득
  const p = Object.fromEntries(B.progress(m).map(x => [x.id, x]));
  assert.equal(p['first-focus'].earned, true); assert.equal(p['focus-10h'].earned, true, '630분 > 10시간');
  assert.equal(p['focus-50h'].earned, false); assert.equal(p['focus-50h'].value, 630 * 60);
  assert.equal(p['streak-7'].value, 2); assert.equal(p['todo-50'].value, 1); assert.equal(p['chatter-100'].value, 3);
  const all = B.progress(B.metrics({ sessions: Array.from({ length: 30 }, (_, i) => day(B.longestStreak ? new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10) : '', 240, `2026-10-${String(1 + i).padStart(2, '0')}T21:00:00Z`)), todos: Array(300).fill({ done: true }), messages: 120 }));
  assert.equal(all.every(x => x.earned), true, '조건을 다 채우면 10개 모두');
  assert.equal(all.find(x => x.id === 'focus-100h').value, 100 * 3600, '진행은 목표에서 멈춤');
  assert.equal(B.DEFS.length, 10); assert.equal(B.defOf('streak-7').label, '7일 연속'); assert.equal(B.defOf('없음'), null);
  console.log('PASS: 칭호·배지 계산 — 누적 시간·연속(하루 30분, 해 넘김)·새벽(한국 4~7시)·할 일(넘김 제외)·채팅, 목표에서 멈추는 진행');
})().catch(e => { console.error(e); process.exitCode = 1; });
