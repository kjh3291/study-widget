// 칭호·배지 계산(순수 함수 — DB 없이 scripts/test-badges.js에서 시험). 서버 쪽은 badges.js
const KST = 9 * 3600e3;
const secOf = s => Number(s.seconds) || (Number(s.minutes) || 0) * 60;

export const DEFS = [
  { id: 'first-focus', label: '첫 집중', desc: '집중 타이머로 처음 공부를 기록했어요.', icon: 'timer', goal: 1, metric: 'sessions' },
  { id: 'focus-10h', label: '10시간 공부', desc: '집중 기록이 모두 10시간을 넘었어요.', icon: 'clock', goal: 10 * 3600, metric: 'seconds' },
  { id: 'focus-50h', label: '50시간 공부', desc: '집중 기록이 모두 50시간을 넘었어요.', icon: 'flag', goal: 50 * 3600, metric: 'seconds' },
  { id: 'focus-100h', label: '100시간 공부', desc: '집중 기록이 모두 100시간을 넘었어요.', icon: 'trophy', goal: 100 * 3600, metric: 'seconds' },
  { id: 'streak-7', label: '7일 연속', desc: '7일 연속으로 하루 30분 이상 공부했어요.', icon: 'calendar-days', goal: 7, metric: 'streak' },
  { id: 'streak-30', label: '30일 연속', desc: '30일 연속으로 하루 30분 이상 공부했어요.', icon: 'calendar-range', goal: 30, metric: 'streak' },
  { id: 'early-bird', label: '새벽 공부', desc: '아침 7시 전에 집중을 5번 시작했어요.', icon: 'coffee', goal: 5, metric: 'early' },
  { id: 'todo-50', label: '할 일 50개', desc: '할 일을 50개 끝냈어요.', icon: 'circle-check', goal: 50, metric: 'todos' },
  { id: 'todo-300', label: '할 일 300개', desc: '할 일을 300개 끝냈어요.', icon: 'clipboard-check', goal: 300, metric: 'todos' },
  { id: 'chatter-100', label: '동아리 수다쟁이', desc: '동아리 채팅에 메시지를 100개 보냈어요.', icon: 'messages-square', goal: 100, metric: 'messages' },
];
const DAILY_MIN = 30 * 60;   // 연속 공부로 치는 하루 최소 시간

const addDay = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// 가장 긴 연속 공부 일수(하루 30분 이상, 공부 날짜 기준)
export function longestStreak(sessions) {
  const perDay = new Map();
  for (const s of sessions || []) if (s && s.date) perDay.set(s.date, (perDay.get(s.date) || 0) + secOf(s));
  const days = [...perDay].filter(([, sec]) => sec >= DAILY_MIN).map(([d]) => d).sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && addDay(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}
// 기록 → 지표
export function metrics({ sessions = [], todos = [], messages = 0 }) {
  const valid = sessions.filter(s => s && secOf(s) > 0);
  return {
    sessions: valid.length,
    seconds: valid.reduce((a, s) => a + secOf(s), 0),
    streak: longestStreak(valid),
    early: valid.filter(s => { if (!s.start) return false; const h = new Date(new Date(s.start).getTime() + KST).getUTCHours(); return h >= 4 && h < 7; }).length,
    todos: todos.filter(t => t && t.done && !t.skipped).length,
    messages: Number(messages) || 0,
  };
}
// 지표 → 배지별 진행 [{ id, value, goal, earned }]
export function progress(m) {
  return DEFS.map(d => ({ id: d.id, value: Math.min(m[d.metric] || 0, d.goal), goal: d.goal, earned: (m[d.metric] || 0) >= d.goal }));
}
export const defOf = id => DEFS.find(d => d.id === id) || null;

