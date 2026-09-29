// Shared allowlist: never copy authentication, absolute paths, or window placement.
const sharedFields = [
  'todos', 'events', 'focus', 'attendance', 'readIds', 'starredLms', 'lmsDone',
  'subjects', 'identifier', 'timetableFull', 'newMaterials', 'notifyState',
  'theme', 'clockFormat', 'focusGoalMin', 'notifyPrefs', 'rolloverOverdue',
  'lmsAuto', 'autoDownload', 'matCourses', 'opacity', 'alwaysOnTop',
];
function sharedSnapshot(data) {
  const result = {};
  for (const key of sharedFields) {
    if (data[key] !== undefined) result[key] = data[key];
  }
  return result;
}
if (typeof module !== 'undefined') module.exports = { sharedFields, sharedSnapshot };
