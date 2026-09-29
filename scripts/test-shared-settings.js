const assert = require('node:assert/strict');
const { sharedFields, sharedSnapshot } = require('../sync-fields');
const fs = require('node:fs'), vm = require('node:vm');
const config = {
  todos: [{ id: 'todo-1', text: 'shared task' }], theme: 'light', focusGoalMin: 90,
  notifyPrefs: { morningHour: 9, deadlineAlerts: false }, matCourses: { c1: false },
  opacity: 85, alwaysOnTop: false, clockFormat: 'hm',
  sync: { token: 'SECRET' }, bounds: { x: 4000 }, materialsDone: { a: { path: 'C:\\private' } },
  assignDone: {}, lms: { sessionValid: true }, autoStart: true, mini: true,
};
const snapshot = sharedSnapshot(config);
assert.equal(snapshot.theme, 'light');
assert.equal(snapshot.todos[0].id, 'todo-1');
for (const key of ['sync', 'bounds', 'materialsDone', 'assignDone', 'lms', 'autoStart', 'mini']) assert.equal(key in snapshot, false);
const source = fs.readFileSync(require.resolve('../renderer.js'), 'utf8');
const elements = new Map();
let saved;
const context = {
  sharedFields, sharedSnapshot, state: { identifier: '', timetableFull: [], theme: 'dark', clockFormat: 'hms', focusGoalMin: 120, notifyPrefs: { morningHour: 8 }, opacity: 100, alwaysOnTop: true },
  window: { api: { saveConfig: patch => { saved = patch; }, setOpacity() {}, setAlwaysOnTop() {} } },
  $: id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); },
  currentTab: 'schedule', applyTheme() {}, applyClockFormat() {}, renderTimetable() {}, showTimetableState() {}, loadTimetable() {}, renderSummary() {}, rerenderTodoAreas() {}, updateLmsBadge() {}, renderCalendar() {}, renderStats() {}, renderAttendance() {}, renderLms() {},
};
vm.createContext(context);
vm.runInContext('let _localSyncedAt = 0;\n' + source.slice(source.indexOf('function applySharedState('), source.indexOf('function initSync()')), context);
context.applySharedState({ ...snapshot, _syncedAt: 42, sync: { token: 'REMOTE_SECRET' } });
assert.equal(context.state.theme, 'light');
assert.equal(elements.get('inp-focus-goal').value, 1.5);
assert.equal(elements.get('inp-morning').value, '09:00');
assert.equal(elements.get('inp-top').checked, false);
assert.equal(saved.syncedAt, 42);
assert.equal(saved.sync, undefined);
console.log('PASS: shared tasks/settings apply to UI; credentials, paths and device settings excluded');
