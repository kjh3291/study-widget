// 학기 단위 서버 파일 정리 규칙(순수 계산): 파일을 서버에 올린(저장한) 날 이후 처음 돌아오는 종강일 + 유예 기간이 지나면
// 서버에서 정리한다. 기기에 받아 둔 파일은 지우지 않는다(그동안 각자 기기에 보관할 시간을 주는 것).
//   TERM_ENDS        종강일 'MM-DD' 목록(기본 '06-30,12-31' — 1학기·2학기)
//   TERM_GRACE_DAYS  종강 뒤 서버에 더 두는 날 수(기본 30)
// 날짜는 한국 시간(KST, UTC+9) 기준. 정리 시각 = (종강일 + 유예일) 다음 날 0시 KST.
const KST = 9 * 3600 * 1000, DAY = 86400000;

export function termPolicy(env = process.env) {
  const ends = String(env.TERM_ENDS || '06-30,12-31').split(',').map(s => s.trim())
    .map(s => /^(\d{1,2})-(\d{1,2})$/.exec(s)).filter(Boolean)
    .map(m => [Number(m[1]), Number(m[2])]).filter(([mo, d]) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const grace = Number.parseInt(env.TERM_GRACE_DAYS, 10);
  return { ends: ends.length ? ends : [[6, 30], [12, 31]], graceDays: Number.isFinite(grace) && grace >= 0 ? grace : 30 };
}

// KST 달력 날짜 → 그날 0시 KST의 ms
const kstMidnight = (y, mo, d) => Date.UTC(y, mo - 1, d) - KST;
const kstDate = ms => { const t = new Date(ms + KST); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

// 저장한 시각(ms) → { termEnd: 그 학기 종강일 0시 KST(ms), expiresAt: 서버에서 정리되는 시각(ms) }
export function termOf(storedAtMs, policy = termPolicy()) {
  const { y, mo, d } = kstDate(storedAtMs);
  for (const year of [y, y + 1]) {
    for (const [emo, ed] of policy.ends) {
      if (year === y && (emo < mo || (emo === mo && ed < d))) continue;   // 이미 지난 종강일
      const termEnd = kstMidnight(year, emo, ed);
      return { termEnd, expiresAt: termEnd + (policy.graceDays + 1) * DAY };
    }
  }
  throw new Error('종강일 계산 실패');
}

// 표시용 이름: 종강일이 상반기면 'YYYY년 1학기', 하반기면 '2학기'
export function termLabel(termEndMs) {
  const { y, mo } = kstDate(termEndMs);
  return `${y}년 ${mo <= 7 ? 1 : 2}학기`;
}
