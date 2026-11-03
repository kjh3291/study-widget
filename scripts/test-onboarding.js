// 첫 실행 안내 점검(onboarding.js)
const assert = require('node:assert/strict');
const O = require('../onboarding');
const fresh = { serverMode: true, todos: [], onboarding: {} };
assert.deepEqual(O.steps(fresh).map((s) => [s.id, s.done]), [['lms', false], ['timetable', false], ['todo', false], ['focus', false], ['club', false]]);
assert.equal(O.visible(fresh), true, '새로 가입하면 보임');
assert.equal(O.steps({ ...fresh, serverMode: false }).some((s) => s.id === 'club'), false, '서버 없는 앱엔 동아리 단계 없음');
const half = { ...fresh, lms: { courses: [{ id: 1 }] }, timetableFull: [{ name: 'a' }], todos: [{ id: 't' }] };
assert.deepEqual(O.steps(half).filter((s) => s.done).map((s) => s.id), ['lms', 'timetable', 'todo'], '실제로 하면 저절로 체크');
const all = { ...half, focusSessions: [{}], onboarding: { clubVisited: true } };
assert.equal(O.visible(all), false, '다 하면 사라짐');
assert.equal(O.visible({ ...fresh, onboarding: { dismissed: true } }), false, '닫으면 사라짐');
console.log('PASS: 첫 실행 안내 — LMS·시간표·할 일·집중·동아리, 실제로 하면 체크, 다 하거나 닫으면 사라짐');
