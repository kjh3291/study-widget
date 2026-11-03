// Shared allowlist: never copy authentication, absolute paths, or window placement.
const sharedFields = [
  'todos', 'events', 'focus', 'attendance', 'readIds', 'starredLms', 'lmsDone',
  'subjects', 'identifier', 'timetableFull', 'timetableSource', 'newMaterials', 'notifyState',
  'theme', 'clockFormat', 'focusGoalMin', 'focusDayStart', 'notifyPrefs', 'rolloverOverdue',
  'lmsAuto', 'autoDownload', 'matCourses', 'opacity', 'alwaysOnTop',
  'currentTerm', 'semesterArchive',   // 새 학기 도우미(semester.js): 지금 학기, 지난 학기 시간표·출석 보관함
];
function sharedSnapshot(data) {
  const result = {};
  for (const key of sharedFields) {
    if (data[key] !== undefined) result[key] = data[key];
  }
  return result;
}
if (typeof module !== 'undefined') module.exports = { sharedFields, sharedSnapshot };

if (typeof window !== 'undefined') window.SyncFields = { sharedFields, sharedSnapshot };
