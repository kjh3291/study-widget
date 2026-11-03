// 첫 실행 안내(오늘 화면의 '시작하기' 체크리스트) 계산 — 화면과 분리, node 테스트: scripts/test-onboarding.js
// 할 일을 실제로 하면 저절로 체크된다(LMS 강좌가 생김·시간표가 생김 등). 다 하거나 '닫기'를 누르면 사라진다.
(function (root) {
  // s: { lms, timetableFull, todos, onboarding: { dismissed, clubVisited, focusDone }, serverMode, focusSessions }
  function steps(s) {
    const ob = s.onboarding || {};
    const list = [
      { id: 'lms', title: 'LMS 연결하기', desc: '학교 로그인 창에서 직접 로그인하면 과제·공지·수업자료를 가져와요.', done: !!(s.lms && s.lms.courses && s.lms.courses.length) },
      { id: 'timetable', title: '시간표 넣기', desc: '강의계획서 PDF를 가져오거나 시간을 직접 입력해요.', done: !!(s.timetableFull && s.timetableFull.length) },
      { id: 'todo', title: '할 일 하나 적어 보기', desc: '아래 입력칸에 적고 Enter. 과목을 붙이면 과목별로 모여요.', done: !!(s.todos && s.todos.length) },
      { id: 'focus', title: '집중 타이머 한 번 써 보기', desc: '학습 › 집중에서 과목을 고르고 시작해요. 공부 시간이 쌓여요.', done: !!(ob.focusDone || (s.focusSessions && s.focusSessions.length)) },
    ];
    if (s.serverMode) list.push({ id: 'club', title: '동아리 둘러보기', desc: '채팅방·공지·같이 공부를 볼 수 있어요.', done: !!ob.clubVisited });
    return list;
  }
  function visible(s) {
    const ob = s.onboarding || {};
    if (ob.dismissed) return false;
    return steps(s).some((x) => !x.done);
  }
  const api = { steps, visible };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Onboarding = api;
})(typeof window !== 'undefined' ? window : globalThis);
