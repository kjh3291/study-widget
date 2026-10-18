// 돌아보기(기록 개편) 계산: 주간 회고 · 미룬 일 정리함 · 과목 리포트 · 통합 잔디
// 화면과 분리된 순수 계산이라 node 테스트(scripts/test-review.js)에서도 그대로 쓴다.
// 입력 data = {
//   todos: [{ id, text, subject, due, done, doneAt, skipped, deferCount, origDue }],
//   lms: [{ id, title, course, due, submitted }],          // LMS 과제(과목 이름은 정리된 이름)
//   lmsDone: { [id]: { doneAt, course, title } },          // 제출 처리한 시각
//   sessions: [{ date, seconds|minutes, subject, task, start, end }],   // 집중 기록(date는 공부일)
//   courses: ['알고리즘', …],                               // 시간표 과목
//   attendance: { [course]: ['출석'|'지각'|'결석'|'공결'|'병결'|…] },   // 이미 지난 수업만
//   events: [{ title, start, end }],
// }
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
  const mondayOf = s => { const d = parse(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return fmt(d); };
  const secOf = s => Number(s.seconds) || (Number(s.minutes) || 0) * 60;
  const dayOfTs = ts => fmt(new Date(ts));
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

  // 완료한 것(할 일 + 제출한 LMS 과제)
  function completions(data) {
    const out = (data.todos || []).filter(t => t.done && t.doneAt && !t.skipped)
      .map(t => ({ kind: 'todo', id: t.id, text: t.text, subject: t.subject || null, day: dayOfTs(t.doneAt) }));
    for (const [id, r] of Object.entries(data.lmsDone || {})) if (r && r.doneAt) out.push({ kind: 'lms', id, text: r.title || '과제', subject: r.course || null, day: dayOfTs(r.doneAt) });
    return out;
  }
  const studyByDay = data => {
    const m = new Map();
    for (const s of data.sessions || []) m.set(s.date, (m.get(s.date) || 0) + secOf(s));
    return m;
  };

  // ① 주간 회고: today가 속한 주(월~일)와 바로 전 주를 비교
  function week(data, today, offset = 0) {
    const from = addDays(mondayOf(today), offset * 7), to = addDays(from, 6);
    const pf = addDays(from, -7), pt = addDays(from, -1);
    const inR = (d, a, b) => d && d >= a && d <= b;
    const done = completions(data), study = studyByDay(data);
    const thisDone = done.filter(c => inR(c.day, from, to)), prevDone = done.filter(c => inR(c.day, pf, pt));
    // 계획: 이번 주가 마감인 할 일·과제(완료 여부 상관없이) + 이번 주에 끝낸 것 중 마감이 없던 것
    const plannedIds = new Set();
    for (const t of data.todos || []) if (!t.skipped && inR(t.origDue || t.due, from, to)) plannedIds.add('todo:' + t.id);
    for (const a of data.lms || []) if (inR(a.due, from, to)) plannedIds.add('lms:' + a.id);
    for (const c of thisDone) plannedIds.add(c.kind + ':' + c.id);
    const sumStudy = (a, b) => [...study].filter(([d]) => inR(d, a, b)).reduce((x, [, s]) => x + s, 0);
    const studySec = sumStudy(from, to), prevStudySec = sumStudy(pf, pt);
    // 가장 많이 한 과목: 완료 1개 = 30분으로 쳐서 공부 시간과 합산
    const score = {};
    for (const c of thisDone) if (c.subject) (score[c.subject] = score[c.subject] || { done: 0, sec: 0 }).done++;
    for (const s of data.sessions || []) if (s.subject && inR(s.date, from, to)) (score[s.subject] = score[s.subject] || { done: 0, sec: 0 }).sec += secOf(s);
    const top = Object.entries(score).map(([name, v]) => ({ name, ...v, w: v.done * 1800 + v.sec })).sort((a, b) => b.w - a.w)[0] || null;
    // 다음 7일 마감(오늘 다음 날부터): 남은 할 일·과제·일정
    const nf = addDays(today, 1), nt = addDays(today, 7);
    const next = [
      ...(data.todos || []).filter(t => !t.done && !t.skipped && inR(t.due, nf, nt)).map(t => ({ kind: 'todo', text: t.text, subject: t.subject || null, due: t.due })),
      ...(data.lms || []).filter(a => !a.submitted && inR(a.due, nf, nt)).map(a => ({ kind: 'lms', text: a.title, subject: a.course || null, due: a.due })),
      ...(data.events || []).filter(e => inR(e.start, nf, nt)).map(e => ({ kind: 'event', text: e.title, subject: null, due: e.start })),
    ].sort((a, b) => a.due.localeCompare(b.due)).map(x => ({ ...x, dday: daysBetween(today, x.due) }));
    return {
      from, to, done: thisDone.length, planned: plannedIds.size, doneDelta: thisDone.length - prevDone.length,
      studySec, studyDelta: studySec - prevStudySec,
      top: top && { name: top.name, done: top.done, sec: top.sec }, next: next.slice(0, 5), nextCount: next.length,
    };
  }

  // ③ 미룬 일 정리함: 2번 이상 미뤘거나, 마감이 지나 자동으로 밀린 할 일
  function cleanup(data, today) {
    return (data.todos || []).filter(t => !t.done && !t.skipped && ((t.deferCount || 0) >= 2 || t.origDue))
      .map(t => ({ id: t.id, text: t.text, subject: t.subject || null, due: t.due, deferCount: t.deferCount || 0,
        lateDays: t.origDue ? Math.max(0, daysBetween(t.origDue, today)) : 0,
        reason: t.origDue ? 'late' : 'deferred' }))
      .sort((a, b) => (b.lateDays + b.deferCount * 3) - (a.lateDays + a.deferCount * 3));
  }

  // ② 과목 리포트: 과목마다 할 일·LMS 과제·출석·공부 시간. 확인이 필요한 이유를 함께
  function courses(data, today) {
    const names = [...new Set([...(data.courses || []), ...(data.lms || []).map(a => a.course).filter(Boolean)])];
    return names.map(name => {
      const todos = (data.todos || []).filter(t => t.subject === name && !t.skipped);
      const lms = (data.lms || []).filter(a => a.course === name);
      const missed = lms.filter(a => !a.submitted && a.due && a.due < today);
      const att = (data.attendance || {})[name] || [];
      const count = s => att.filter(x => x === s).length;
      const studySec = (data.sessions || []).filter(s => s.subject === name).reduce((x, s) => x + secOf(s), 0);
      const late = todos.filter(t => !t.done && t.origDue).length;
      const reasons = [];
      if (missed.length) reasons.push(`미제출 과제 ${missed.length}개`);
      if (count('결석') >= 2) reasons.push(`결석 ${count('결석')}회`);
      if (late >= 3) reasons.push(`밀린 할 일 ${late}개`);
      return {
        name, todos: { done: todos.filter(t => t.done).length, total: todos.length },
        lms: { submitted: lms.filter(a => a.submitted).length, total: lms.length, missed: missed.length },
        attendance: { weeks: att.length, present: count('출석'), late: count('지각'), absent: count('결석'), excused: count('공결'), sick: count('병결') },
        studySec, reasons, attention: reasons.length > 0,
      };
    }).sort((a, b) => (b.attention - a.attention) || (b.studySec - a.studySec) || a.name.localeCompare(b.name));
  }

  // ④ 통합 잔디: 한 달의 날마다 완료 수·공부 시간, 진하기 0~4(완료 1개 = 30분으로 셈)
  function heatmap(data, year, month /* 0-11 */) {
    const done = completions(data), study = studyByDay(data);
    const last = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let d = 1; d <= last; d++) {
      const date = fmt(new Date(year, month, d));
      const items = done.filter(c => c.day === date);
      const studySec = study.get(date) || 0;
      const score = items.length * 30 + studySec / 60;   // 분
      const level = score <= 0 ? 0 : score < 60 ? 1 : score < 150 ? 2 : score < 300 ? 3 : 4;
      days.push({ date, done: items.length, studySec, level, items: items.map(c => c.text) });
    }
    return { year, month, firstWeekday: (new Date(year, month, 1).getDay() + 6) % 7, days };
  }

  // 탭 숫자 배지: 0이면 숨김(null), 1~9 그대로, 10 이상 '9+'. 정수 0 이상만 받는다
  const badgeLabel = n => (!Number.isInteger(n) || n < 0 ? undefined : n === 0 ? null : n > 9 ? '9+' : String(n));

  const api = { week, cleanup, courses, heatmap, completions, badgeLabel, util: { fmt, parse, addDays, mondayOf } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ReviewCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
