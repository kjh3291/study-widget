// Conservative first-page header extraction. Never infer clock times from periods.
function parseSyllabus(text) {
  const header = text.normalize('NFC').split(/■\s*교과목\s*개요/)[0];
  const one = re => { const matches = [...header.matchAll(re)]; return matches.length === 1 ? matches[0][1].replace(/\s+/g, ' ').trim() : ''; };
  const name = one(/교과목명\s+(.+?)\s+분\s*반/g);
  const professor = one(/담당교수\s+([^\s]+)/g);
  const place = one(/강의실\s+([A-Za-z0-9]+-[A-Za-z0-9]+)/g);
  const weekday = one(/([월화수목금토일])요일/g);
  const ranges = [...header.matchAll(/(?<!\d)(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})(?!\d)/g)];
  const start = ranges.length === 1 ? ranges[0][1].padStart(5, '0') : '';
  const end = ranges.length === 1 ? ranges[0][2].padStart(5, '0') : '';
  const draft = { name, professor, times: [{ day: weekday ? String('월화수목금토일'.indexOf(weekday)) : '', start, end, place }] };
  return { draft, warning: !text.trim() ? '텍스트가 없는 PDF입니다. 스캔 문서는 자동 인식하지 못하므로 직접 입력해 주세요.' : '첫 페이지에서 읽은 결과입니다. 원본의 모든 수업 시간과 강의실을 확인해 주세요.' };
}
function syllabusSubject(draft) {
  const minutes = value => {
    if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
    const [h, m] = value.split(':').map(Number);
    return h < 24 && m < 60 && m % 5 === 0 ? h * 60 + m : NaN;
  };
  if (!draft.name.trim()) throw new Error('과목명을 입력해 주세요.');
  if (!draft.times.length) throw new Error('수업 시간을 추가해 주세요.');
  const times = draft.times.map(t => {
    const start = minutes(t.start), end = minutes(t.end);
    if (!/^[0-6]$/.test(String(t.day))) throw new Error('요일을 선택해 주세요.');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('시작·종료 시간을 5분 단위로 확인해 주세요. 종료는 시작보다 늦어야 합니다.');
    if (!t.place.trim()) throw new Error('강의실을 입력해 주세요. 온라인 수업은 온라인으로 적어 주세요.');
    return { day: Number(t.day), start: start / 5, end: end / 5, place: t.place.trim() };
  });
  return { name: draft.name.trim().normalize('NFC'), professor: draft.professor.trim(), times };
}
function mergeSyllabus(subjects, subject, replaceIndex) {
  const next = subjects.slice();
  if (replaceIndex === '') next.push(subject);
  else {
    const index = Number(replaceIndex);
    if (!Number.isInteger(index) || index < 0 || index >= next.length) throw new Error('교체할 과목을 다시 선택해 주세요.');
    next[index] = subject;
  }
  return next;
}
if (typeof module !== 'undefined') module.exports = { parseSyllabus, syllabusSubject, mergeSyllabus };
