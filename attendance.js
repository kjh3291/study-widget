// 출석 상태(화면 4개 + 출석 인정 세부) — 화면과 분리, node 테스트: scripts/test-attendance.js
// 2차 디자인은 출석·지각·결석·미정 4개. 예전 앱의 공결·병결 기록은 지우지 않고 '출석 인정'으로 보여 준다.
// 저장값은 예전과 같은 한국어 문자열('출석'|'지각'|'결석'|'공결'|'병결') + 새 '미정'. 예전 앱도 그대로 읽는다.
(function (root) {
  const MAIN = ['출석', '지각', '결석', '미정'];            // 칸을 누를 때 도는 순서(그다음은 자동으로 돌아감)
  const EXCUSED = ['공결', '병결'];                         // 출석 인정(우클릭·길게 눌러 고름)
  const ALL = [...MAIN, ...EXCUSED];
  const INFO = {
    출석: { cls: 'ok', short: '출', label: '출석', group: 'present' },
    지각: { cls: 'warn', short: '지', label: '지각', group: 'late' },
    결석: { cls: 'danger', short: '결', label: '결석', group: 'absent' },
    미정: { cls: 'unknown', short: '?', label: '미정', group: 'unknown' },
    공결: { cls: 'info', short: '공', label: '출석 인정(공결)', group: 'excused' },
    병결: { cls: 'info', short: '병', label: '출석 인정(병결)', group: 'excused' },
  };
  const info = (s) => INFO[s] || null;

  // 칸을 눌렀을 때 다음 상태. cur: 내가 정한 값(없으면 undefined), auto: 자동 값('출석' 또는 '' = 수업 전)
  //   반환 undefined = 내가 정한 값을 지워 자동으로 돌아감
  function next(cur, auto) {
    if (cur === undefined) {                                 // 자동 상태에서 시작
      const i = MAIN.indexOf(auto);
      return MAIN[(i + 1) % MAIN.length];                    // 자동 출석 → 지각, 수업 전 → 출석
    }
    if (EXCUSED.includes(cur)) return undefined;             // 출석 인정에서 누르면 자동으로
    const i = MAIN.indexOf(cur);
    if (i < 0 || i === MAIN.length - 1) return undefined;   // 미정(마지막) 또는 모르는 값 → 자동
    const n = MAIN[i + 1];
    return n === auto ? next(n, auto) : n;
  }
  // 집계: 결석 수 경고 등은 결석만, 출석 인정은 출석으로 친다
  function count(list) {
    const c = { present: 0, late: 0, absent: 0, excused: 0, unknown: 0 };
    for (const s of list || []) { const g = info(s)?.group; if (g) c[g]++; }
    return c;
  }
  const api = { MAIN, EXCUSED, ALL, info, next, count };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Attendance = api;
})(typeof window !== 'undefined' ? window : globalThis);
