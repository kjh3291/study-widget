// LMS 공지 목록(A안) 계산 점검(lms-notices.js): 제목에서 마감일 읽기 · D-day 칩 · 올린 날짜
const assert = require('node:assert/strict');
const N = require('../lms-notices');
const today = '2026-11-03';   // 화요일
const dl = (t, posted = '2026-11-01') => N.parseDeadline(t, posted, today);

// 마감을 뜻하는 말이 있을 때만 날짜를 마감일로 본다
assert.deepEqual(dl('[과제] 3차 과제 안내 (~11/5)'), { date: '2026-11-05', time: '' });
assert.deepEqual(dl('11월 7일(금)까지 보고서 제출'), { date: '2026-11-07', time: '' });
assert.deepEqual(dl('레포트 제출 마감: 2026.11.10 23:59'), { date: '2026-11-10', time: '23:59' });
assert.deepEqual(dl('중간 과제 기한 11.12 오후 6시'), { date: '2026-11-12', time: '18:00' });
assert.deepEqual(dl('팀 프로젝트 제출 2026-11-20(금) 23:59'), { date: '2026-11-20', time: '23:59' });
assert.deepEqual(dl('실습 11/3(월) ~ 11/7(금) 제출'), { date: '2026-11-07', time: '' }, '기간이면 끝 날짜');
assert.deepEqual(dl('10/20 공지한 과제, 11/6까지 연장'), { date: '2026-11-06', time: '' }, "'까지' 앞 날짜");
assert.equal(dl('중간고사 일정 안내 (10월 24일)'), null, '마감 말이 없으면 칩 없음');
assert.equal(dl('3.5점 만점 과제 제출 안내'), null, '점수는 날짜가 아님');
assert.equal(dl('과제 제출 안내'), null, '날짜가 없으면 없음');
assert.equal(dl('2/30까지 제출'), null, '없는 날짜');
assert.equal(dl('v1.2 자료 제출'), null, '버전 번호는 날짜가 아님');
// 연도 추정: 12월에 올린 '1/5까지'는 다음 해
assert.deepEqual(N.parseDeadline('기말 보고서 1/5까지', '2026-12-20', '2026-12-21'), { date: '2027-01-05', time: '' });
// 올린 날짜가 없으면 오늘 기준
assert.deepEqual(N.parseDeadline('~11/9 제출', '', today), { date: '2026-11-09', time: '' });

// D-day 칩: 오늘·D-1~2 급함, D-3~6 곧, 그 뒤 여유, 지난 지 3일까지만 '마감 지남'
const chip = d => N.deadlineChip({ date: d, time: '' }, today);
assert.deepEqual(chip('2026-11-03'), { label: '오늘 마감', tone: 'urgent', days: 0, title: '11/3(화) 마감' });
assert.equal(N.deadlineChip({ date: '2026-11-03', time: '23:59' }, today).label, '오늘 23:59');
assert.equal(chip('2026-11-05').label, 'D-2'); assert.equal(chip('2026-11-05').tone, 'urgent');
assert.equal(chip('2026-11-06').tone, 'soon'); assert.equal(chip('2026-11-09').tone, 'soon');
assert.equal(chip('2026-11-10').tone, 'later'); assert.equal(chip('2026-11-10').label, 'D-7');
assert.equal(chip('2026-10-31').label, '마감 지남'); assert.equal(chip('2026-10-31').tone, 'past');
assert.equal(chip('2026-10-30'), null, '지난 지 3일이 넘으면 칩 없음');
assert.equal(N.deadlineChip(null, today), null);
assert.equal(N.deadlineChip({ date: '2026-11-20', time: '23:59' }, today).title, '11/20(금) 23:59 마감');

// 올린 날짜
assert.equal(N.postedLabel('2026-11-03', today), '오늘');
assert.equal(N.postedLabel('2026-11-02', today), '어제');
assert.equal(N.postedLabel('2026-10-28', today), '10/28');
assert.equal(N.postedLabel('2025-12-01', today), '25.12.1');
assert.equal(N.postedLabel('', today), '');

// 과목 묶음 머리: 가장 가까운 앞으로의 마감
const near = N.nearestChip([{ title: '~11/20 제출', date: '2026-11-01' }, { title: '11/5까지 제출', date: '2026-11-01' }, { title: '10/31까지 제출', date: '2026-10-20' }, { title: '휴강 안내', date: '2026-11-02' }], today);
assert.equal(near.label, 'D-2');
assert.equal(N.nearestChip([{ title: '휴강 안내' }], today), null);
console.log('PASS: LMS 공지 — 제목에서 마감일 읽기(기간 끝·까지·시각·연도 추정), D-day 칩 단계, 올린 날짜 표시');
