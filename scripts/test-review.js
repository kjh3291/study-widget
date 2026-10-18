// 돌아보기 계산 점검(review.js): 주간 회고·미룬 일 정리함·과목 리포트·통합 잔디
const assert = require('node:assert/strict');
const R = require('../review');

const today = '2026-10-18';                      // 일요일 → 이번 주 10.12(월)~10.18(일)
const ts = (d, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();
const data = {
  todos: [
    { id: 'a', text: '알고리즘 과제', subject: '알고리즘', due: '2026-10-14', done: true, doneAt: ts('2026-10-14') },
    { id: 'b', text: '단어 복습', subject: null, due: '2026-10-18', done: true, doneAt: ts('2026-10-18') },
    { id: 'c', text: '지난주 한 일', subject: '알고리즘', due: '2026-10-08', done: true, doneAt: ts('2026-10-08') },
    { id: 'd', text: '자료구조 정리', subject: '자료구조', due: '2026-10-18', origDue: '2026-10-03', done: false },
    { id: 'e', text: '신용관리 보기', subject: null, due: '2026-10-19', deferCount: 3, done: false },
    { id: 'f', text: '한 번 미룸', subject: null, due: '2026-10-20', deferCount: 1, done: false },
    { id: 'g', text: '다음 주 발표', subject: '알고리즘', due: '2026-10-21', done: false },
    { id: 'h', text: '넘긴 일', subject: '알고리즘', due: '2026-10-15', skipped: true, done: false },
  ],
  lms: [
    { id: 'L1', title: '과제1', course: '자료구조', due: '2026-10-10', submitted: false },
    { id: 'L2', title: '과제2', course: '자료구조', due: '2026-10-22', submitted: false },
    { id: 'L3', title: '퀴즈', course: '알고리즘', due: '2026-10-16', submitted: true },
  ],
  lmsDone: { L3: { doneAt: ts('2026-10-16'), title: '퀴즈', course: '알고리즘' } },
  sessions: [
    { date: '2026-10-13', seconds: 3600, subject: '알고리즘' },
    { date: '2026-10-18', minutes: 30, subject: '자료구조' },      // 예전 기록(분)
    { date: '2026-10-07', seconds: 7200, subject: '알고리즘' },     // 지난주
  ],
  courses: ['알고리즘', '자료구조'],
  attendance: { 알고리즘: ['출석', '출석', '지각'], 자료구조: ['출석', '결석', '결석'] },
  events: [{ title: '오토마타 시험', start: '2026-10-21', end: '2026-10-21' }],
};

const w = R.week(data, today);
assert.equal(w.from, '2026-10-12'); assert.equal(w.to, '2026-10-18');
assert.equal(w.done, 3, '이번 주 완료: 할 일 2 + LMS 1');
assert.equal(w.doneDelta, 2, '지난주 1개 → +2');
assert.equal(w.studySec, 3600 + 1800); assert.equal(w.studyDelta, 5400 - 7200);
assert.ok(w.planned >= w.done);
assert.equal(w.top.name, '알고리즘', '완료 2(=1시간) + 공부 1시간');
assert.deepEqual(w.next.map(n => n.text), ['신용관리 보기', '한 번 미룸', '다음 주 발표', '오토마타 시험', '과제2']);
assert.equal(w.next[0].dday, 1);
console.log('PASS: 주간 회고 — 이번 주(월~일) 완료·계획·지난주 대비, 공부 시간(초·예전 분), 가장 많이 한 과목, 다음 7일 마감');

const c = R.cleanup(data, today);
assert.deepEqual(c.map(x => x.id), ['d', 'e'], '15일 밀림·3번 미룸만, 1번 미룸·넘긴 일 제외');
assert.equal(c[0].lateDays, 15); assert.equal(c[1].deferCount, 3);
console.log('PASS: 미룬 일 정리함 — 2번 이상 미룸 또는 자동 이월, 오래 밀린 순');

const cr = R.courses(data, today);
const ds = cr.find(x => x.name === '자료구조'), al = cr.find(x => x.name === '알고리즘');
assert.equal(cr[0].name, '자료구조', '확인 필요 과목이 위로');
assert.deepEqual(ds.reasons, ['미제출 과제 1개', '결석 2회']);
assert.deepEqual(ds.lms, { submitted: 0, total: 2, missed: 1 });
assert.deepEqual(al.todos, { done: 2, total: 3 }, '넘긴 일 제외');
assert.equal(al.attendance.late, 1); assert.equal(al.studySec, 10800); assert.equal(al.attention, false);
console.log('PASS: 과목 리포트 — 할 일·LMS 과제·출석·공부 시간, 미제출·결석 2회·밀린 할 일 3개면 확인 필요');

const h = R.heatmap(data, 2026, 9);
assert.equal(h.days.length, 31); assert.equal(h.firstWeekday, 3, '10월 1일은 목요일');
const d18 = h.days.find(d => d.date === today);
assert.equal(d18.done, 1); assert.equal(d18.studySec, 1800); assert.equal(d18.level, 2, '완료 1(30분)+공부 30분 = 60분');
assert.equal(h.days.find(d => d.date === '2026-10-01').level, 0);
console.log('PASS: 통합 잔디 — 날마다 완료+공부 시간, 진하기 0~4, 그날 한 일');

assert.deepEqual([0, 1, 9, 10, 99, 10000].map(R.badgeLabel), [null, '1', '9', '9+', '9+', '9+']);
assert.equal(R.badgeLabel(1.5), undefined); assert.equal(R.badgeLabel(NaN), undefined);
console.log('PASS: 탭 배지 숫자 — 0 숨김, 1~9, 10 이상 9+, 소수·NaN은 오류');
