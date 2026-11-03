// LMS 공지 목록(A안) 계산: 공지 제목에서 마감일 읽기 · D-day 칩 · 올린 날짜 표시
// 화면과 분리된 순수 계산이라 node 테스트(scripts/test-lms-notices.js)에서도 그대로 쓴다.
// 날짜 문자열은 모두 'YYYY-MM-DD'(기기 현지 날짜).
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  // 진짜 있는 날짜인지(2/30 같은 것 거르기)
  const make = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? fmt(t) : null; };

  // 마감을 뜻하는 말이 있어야 제목의 날짜를 '마감일'로 본다. (없으면 시험·휴강 날짜일 수 있어서 칩을 달지 않음)
  const CUE = /마감|까지|기한|제출|due|deadline|[~～∼]/i;
  // 날짜 모양: 연도 있는 것 → '11월 5일' → '11/5'·'11.5' 순서로 찾고, 먼저 찾은 자리는 다시 쓰지 않는다
  const PATTERNS = [
    { re: /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/g, y: 1, m: 2, d: 3 },
    { re: /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, m: 1, d: 2 },
    { re: /(?<![\d.A-Za-z])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d.%점])/g, m: 1, d: 2 },
  ];
  const TIME = /^\s*(?:\([^)]{1,3}\)|[월화수목금토일]요일)?\s*(?:(오전|오후|밤|낮)\s*)?(\d{1,2})(?::(\d{2})|\s*시(?:\s*(\d{1,2})\s*분)?)/;

  function findDates(title) {
    const used = [], out = [];
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(title))) {
        const s = m.index, e = s + m[0].length;
        if (used.some(([a, b]) => s < b && e > a)) continue;
        const month = +m[p.m], day = +m[p.d];
        if (month < 1 || month > 12 || day < 1 || day > 31) continue;
        used.push([s, e]);
        out.push({ start: s, end: e, year: p.y ? +m[p.y] : null, month, day });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }
  function timeAfter(title, at) {
    const m = TIME.exec(title.slice(at, at + 16));
    if (!m) return '';
    let h = +m[2]; const min = +(m[3] || m[4] || 0);
    if ((m[1] === '오후' || m[1] === '밤') && h < 12) h += 12;
    if (h > 24 || min > 59) return '';
    return `${pad(h === 24 ? 23 : h)}:${pad(h === 24 ? 59 : min)}`;
  }

  // 공지 제목 → { date: 'YYYY-MM-DD', time: 'HH:MM'|'' } | null
  // posted: 공지 올린 날짜(연도 추정 기준, 없으면 today)
  function parseDeadline(title, posted, today) {
    title = String(title || '');
    if (!CUE.test(title)) return null;
    const dates = findDates(title);
    if (!dates.length) return null;
    // 고르는 순서: '~' 바로 뒤 날짜(기간의 끝) → '까지' 바로 앞 날짜 → 마지막 날짜
    let pick = null;
    const tilde = Math.max(title.lastIndexOf('~'), title.lastIndexOf('～'), title.lastIndexOf('∼'));
    if (tilde >= 0) pick = dates.find(d => d.start > tilde) || null;
    if (!pick) { const k = title.indexOf('까지'); if (k >= 0) pick = dates.filter(d => d.end <= k).pop() || null; }
    if (!pick) pick = dates[dates.length - 1];
    const base = parse(posted) ? posted : today;
    const baseDate = parse(base);
    let date;
    if (pick.year) date = make(pick.year, pick.month, pick.day);
    else {
      date = make(baseDate.getFullYear(), pick.month, pick.day);
      // 연도 없는 날짜가 기준일보다 두 달 넘게 앞이면 다음 해(12월 공지의 '1/5까지')
      if (date && daysBetween(date, base) > 60) date = make(baseDate.getFullYear() + 1, pick.month, pick.day);
    }
    if (!date) return null;
    return { date, time: timeAfter(title, pick.end) };
  }

  // 마감 칩: { label, tone: 'urgent'|'soon'|'later'|'past', days, title } | null
  // 지난 지 3일이 넘은 마감은 칩을 달지 않는다(목록이 지저분해지지 않게)
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  function deadlineChip(dl, today) {
    if (!dl || !dl.date || !parse(today)) return null;
    const days = daysBetween(today, dl.date);
    if (days < -3) return null;
    const d = parse(dl.date);
    const title = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})${dl.time ? ' ' + dl.time : ''} 마감`;
    if (days < 0) return { label: '마감 지남', tone: 'past', days, title };
    if (days === 0) return { label: dl.time ? `오늘 ${dl.time}` : '오늘 마감', tone: 'urgent', days, title };
    return { label: `D-${days}`, tone: days <= 2 ? 'urgent' : days <= 6 ? 'soon' : 'later', days, title };
  }

  // 올린 날짜: 오늘 · 어제 · 올해는 'M/D' · 다른 해는 'YY.M.D'
  function postedLabel(posted, today) {
    const p = parse(posted), t = parse(today);
    if (!p || !t) return '';
    const diff = daysBetween(posted, today);
    if (diff === 0) return '오늘';
    if (diff === 1) return '어제';
    if (p.getFullYear() === t.getFullYear()) return `${p.getMonth() + 1}/${p.getDate()}`;
    return `${String(p.getFullYear()).slice(2)}.${p.getMonth() + 1}.${p.getDate()}`;
  }

  // 공지 여러 개 중 가장 가까운(오늘 이후) 마감 칩 — 과목 묶음 머리에 표시
  function nearestChip(notices, today) {
    let best = null;
    for (const n of notices || []) {
      const c = deadlineChip(parseDeadline(n.title, n.date, today), today);
      if (c && c.days >= 0 && (!best || c.days < best.days)) best = c;
    }
    return best;
  }

  const api = { parseDeadline, deadlineChip, postedLabel, nearestChip, util: { fmt, parse } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LmsNotices = api;
})(typeof window !== 'undefined' ? window : globalThis);
