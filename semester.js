// 새 학기 도우미(순수 계산, node 테스트: scripts/test-semester.js)
// 3~8월 = 그해 1학기, 9~2월 = 2학기(1·2월은 전년도 2학기). 학기가 바뀌면 지난 학기 시간표·출석을 보관함에 옮기고 새로 시작한다.
// 할 일·집중 기록·LMS 기록은 학기와 상관없이 그대로 둔다(돌아보기에서 계속 보임).
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  function termOf(dateStr) {
    const [y, m] = String(dateStr).split('-').map(Number);
    if (!y || !m) return null;
    return m >= 3 && m <= 8 ? `${y}-1` : m >= 9 ? `${y}-2` : `${y - 1}-2`;
  }
  const termLabel = (t) => { const [y, n] = String(t || '').split('-'); return y && n ? `${y}년 ${n}학기` : ''; };
  const newer = (a, b) => String(a) > String(b);   // 'YYYY-n' 문자열 비교로 충분
  // 이번 학기 시작일(3/1 또는 9/1)
  const termStart = (t) => { const [y, n] = t.split('-'); return `${y}-${n === '1' ? '03' : '09'}-01`; };

  // 안내를 띄울지: 기록된 학기(currentTerm)보다 오늘 학기가 새롭고, 지난 학기 시간표·출석이 남아 있을 때
  //   currentTerm이 아직 없으면(처음 쓰는 사람) 안내 없이 오늘 학기로 기록만 한다 → { prompt:false, setTerm }
  function check(s, today) {
    const now = termOf(today);
    if (!s.currentTerm) return { prompt: false, setTerm: now };
    if (!newer(now, s.currentTerm)) return { prompt: false };
    const hasOld = (s.timetableFull && s.timetableFull.length) || (s.attendance && (s.attendance.semesterStart || Object.keys(s.attendance.overrides || {}).length));
    if (!hasOld) return { prompt: false, setTerm: now };
    if (s.semesterSnooze && s.semesterSnooze >= today) return { prompt: false };
    return { prompt: true, from: s.currentTerm, to: now, fromLabel: termLabel(s.currentTerm), toLabel: termLabel(now) };
  }
  // 새 학기 준비: 지난 학기 시간표·출석을 보관함으로, 새 학기는 빈 시간표·출석으로. 반환값 = 바꿀 필드들(patch)
  function start(s, today, now = Date.now()) {
    const from = s.currentTerm, to = termOf(today);
    const archive = { ...(s.semesterArchive || {}) };
    if (from) archive[from] = { term: from, label: termLabel(from), archivedAt: now, timetableFull: s.timetableFull || [], attendance: s.attendance || { semesterStart: '', overrides: {} } };
    return { currentTerm: to, semesterArchive: archive, timetableFull: [], attendance: { semesterStart: '', overrides: {} }, semesterSnooze: '' };
  }
  // 되돌리기: 보관함의 학기를 다시 현재로(실행 취소용)
  function undo(s, term) {
    const a = s.semesterArchive && s.semesterArchive[term]; if (!a) return null;
    const archive = { ...s.semesterArchive }; delete archive[term];
    return { currentTerm: term, semesterArchive: archive, timetableFull: a.timetableFull, attendance: a.attendance };
  }
  // 보관함 요약(설정 › 지난 학기 기록)
  function summary(s) {
    return Object.values(s.semesterArchive || {}).sort((a, b) => (a.term < b.term ? 1 : -1)).map((a) => {
      const subjects = (a.timetableFull || []).map((x) => x.name).filter(Boolean);
      let absent = 0, late = 0;
      for (const w of Object.values((a.attendance && a.attendance.overrides) || {})) for (const v of Object.values(w)) { if (v === '결석') absent++; else if (v === '지각') late++; }
      return { term: a.term, label: a.label || termLabel(a.term), subjects, absent, late, archivedAt: a.archivedAt };
    });
  }
  const api = { termOf, termLabel, termStart, check, start, undo, summary, pad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Semester = api;
})(typeof window !== 'undefined' ? window : globalThis);
