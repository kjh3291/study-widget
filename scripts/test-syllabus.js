const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseSyllabus, syllabusSubject, mergeSyllabus } = require('../syllabus');
const { sharedSnapshot } = require('../sync-fields');
const text = '교과목명 테스트 과목 분 반 04\n수요일 (2,3,4교시)\n강의시간 강의실 N23-507 상담시간\n10:00-13:00\n담당교수 테스트\n■ 교과목 개요\n월요일 14:00-16:00';
const candidate = syllabusSubject(parseSyllabus(text).draft);
assert.deepEqual(candidate, { name: '테스트 과목', professor: '테스트', times: [{ day: 2, start: 120, end: 156, place: 'N23-507' }] });
for (const invalid of [
  text.replace('10:00-13:00', ''), text.replace('수요일', '수요일 또는 목요일'),
  text.replace('N23-507', '미정'), text.replace('10:00-13:00', '13:00-10:00'),
  text.replace('10:00-13:00', '10:00-13:00 / 14:00-15:00'),
  text.replace('10:00-13:00', '10:03-13:00'), '',
]) assert.throws(() => syllabusSubject(parseSyllabus(invalid).draft));
const edited = parseSyllabus('').draft;
Object.assign(edited, { name: '직접 입력', professor: '' });
edited.times = [{ day: '0', start: '09:00', end: '10:30', place: '온라인' }, { day: '2', start: '09:00', end: '10:30', place: '온라인' }];
assert.equal(syllabusSubject(edited).times.length, 2);
const existing = [{ name: '다른 과목', professor: '', times: [] }, candidate];
const baseline = JSON.stringify(existing);
const replacement = { ...candidate, professor: '수정' };
assert.equal(mergeSyllabus(existing, replacement, '').length, 3);
assert.equal(mergeSyllabus(existing, replacement, '1')[1].professor, '수정');
assert.equal(JSON.stringify(existing), baseline);
assert.throws(() => mergeSyllabus(existing, replacement, '8'));
assert.equal(sharedSnapshot({ timetableSource: 'syllabus' }).timetableSource, 'syllabus');
(async () => {
  // An in-flight Everytime request cannot overwrite a just-applied syllabus.
  const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
  let resolve, rendered = 0, fetched = 0;
  const context = { state: { identifier: 'id', timetableSource: 'everytime', timetableFull: existing },
    window: { api: { fetchTimetable: () => { fetched++; return new Promise(r => { resolve = r; }); } } },
    setStatus() {}, showTimetableState() {}, renderTimetable() { rendered++; } };
  vm.createContext(context);
  vm.runInContext(renderer.slice(renderer.indexOf('async function loadTimetable('), renderer.indexOf('// =====================================================================\n// 할 일')), context);
  const pending = context.loadTimetable('id');
  context.state.timetableSource = 'syllabus';
  resolve({ ok: true, subjects: [] }); await pending;
  assert.equal(rendered, 0);
  await context.loadTimetable('id'); assert.equal(fetched, 1); assert.equal(rendered, 1);
  if (process.argv[2]) {
    const { readSyllabus } = require('../syllabus-pdf');
    const preview = await readSyllabus(process.argv[2]);
    assert.equal(syllabusSubject(preview.draft).times.length, 1);
    console.log('PASS: real PDF extracted and validated');
  }
  console.log('PASS: syllabus extraction, ambiguous/missing fields, edits, merge, sync source and refresh race');
})().catch(e => { console.error(e); process.exitCode = 1; });
