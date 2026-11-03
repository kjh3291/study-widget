// 학기 단위 서버 파일 정리 규칙 점검(server/src/terms.js)
const assert = require('node:assert/strict');
(async () => {
  const T = await import('../server/src/terms.js');
  const P = T.termPolicy({});
  assert.deepEqual(P, { ends: [[6, 30], [12, 31]], graceDays: 30 });
  const kst = (s) => Date.parse(s + '+09:00');
  const iso = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  // 2학기 중에 올린 파일 → 12/31 종강, 30일 뒤(1/30)까지 두고 1/31 0시 정리
  let t = T.termOf(kst('2026-11-03T15:00:00'), P);
  assert.equal(iso(t.termEnd), '2026-12-31 00:00'); assert.equal(iso(t.expiresAt), '2027-01-31 00:00');
  assert.equal(T.termLabel(t.termEnd), '2026년 2학기');
  // 여름방학(7월)에 올린 파일은 다가오는 2학기 것으로 — 올리자마자 지워지지 않음
  t = T.termOf(kst('2026-07-15T10:00:00'), P);
  assert.equal(iso(t.termEnd), '2026-12-31 00:00');
  // 종강일 당일에 올린 파일은 그 학기
  t = T.termOf(kst('2026-06-30T23:00:00'), P);
  assert.equal(iso(t.termEnd), '2026-06-30 00:00'); assert.equal(iso(t.expiresAt), '2026-07-31 00:00');
  assert.equal(T.termLabel(t.termEnd), '2026년 1학기');
  // 겨울방학(1월)에 올린 파일 → 1학기 종강 6/30 기준
  t = T.termOf(kst('2027-01-10T09:00:00'), P);
  assert.equal(iso(t.termEnd), '2027-06-30 00:00');
  // UTC로는 12/31이지만 한국은 1/1 → 다음 학기
  t = T.termOf(Date.parse('2026-12-31T16:00:00Z'), P);
  assert.equal(iso(t.termEnd), '2027-06-30 00:00');
  // 설정: 종강일·유예 기간을 바꿀 수 있고, 잘못된 값은 기본값
  const Q = T.termPolicy({ TERM_ENDS: '12-20, 06-20', TERM_GRACE_DAYS: '14' });
  assert.deepEqual(Q, { ends: [[6, 20], [12, 20]], graceDays: 14 });
  assert.equal(iso(T.termOf(kst('2026-11-03T00:00:00'), Q).expiresAt), '2027-01-04 00:00');
  assert.deepEqual(T.termPolicy({ TERM_ENDS: 'x,13-40', TERM_GRACE_DAYS: '-3' }), P);
  console.log('PASS: 학기 정리 규칙 — 올린 날 이후 첫 종강일(6/30·12/31) + 30일 뒤 서버에서 정리, 방학 중 올린 파일은 다음 학기, 한국 시간 기준, 설정 가능');
})().catch(e => { console.error(e); process.exitCode = 1; });
