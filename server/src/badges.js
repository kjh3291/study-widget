// 칭호·배지: 서버가 동기화된 기록(집중·할 일·채팅)으로 계산해서 준다(앱에서 조작 불가).
//   자동 배지: 아래 DEFS. 처음 조건을 채운 순간을 earned_at으로 남기고, 나중에 기록이 줄어도 빼앗지 않는다.
//   특별 배지: 운영진이 이름을 붙여 직접 준다(예: 'COSMIC 1기', '발표왕'). badge = 'custom:<번호>'
//   칭호: 내가 가진 배지 하나를 골라 이름 옆에 표시(users.title).
// 계산(badges-calc.js)은 순수 함수라 scripts/test-badges.js에서 DB 없이 시험한다.
import { pool } from './db.js';
import { authenticate, requireAdmin } from './auth.js';
import { sendTo } from './community.js';

import { DEFS, metrics, progress, defOf } from './badges-calc.js';
export { DEFS };

// ---------- 서버 ----------
const badgeRow = (r) => {
  const d = defOf(r.badge);
  return { id: r.badge, label: d ? d.label : r.label, desc: d ? d.desc : (r.note || '운영진이 준 특별 배지'), icon: d ? d.icon : 'star', special: !d, earnedAt: r.earned_at, grantedBy: r.granter || undefined };
};
async function userData(uid) {
  const [f, t, m] = await Promise.all([
    pool.query(`SELECT data FROM items WHERE user_id = $1 AND kind = 'setting' AND id = 'focus' AND NOT deleted`, [uid]),
    pool.query(`SELECT data FROM items WHERE user_id = $1 AND kind = 'todo' AND NOT deleted`, [uid]),
    pool.query(`SELECT count(*)::int AS n FROM messages WHERE user_id = $1 AND NOT deleted`, [uid]),
  ]);
  return { sessions: f.rows[0]?.data?.v?.sessions || [], todos: t.rows.map(r => r.data?.v).filter(Boolean), messages: m.rows[0].n };
}
// 자동 배지 새로 얻은 것을 기록하고, 가진 배지 전부 + 진행을 돌려준다
export async function refreshBadges(uid) {
  const prog = progress(metrics(await userData(uid)));
  const fresh = [];
  for (const p of prog.filter(x => x.earned)) {
    const r = await pool.query(`INSERT INTO user_badges (user_id, badge) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING badge`, [uid, p.id]);
    if (r.rowCount) fresh.push(p.id);
  }
  const { rows } = await pool.query(`SELECT b.*, g.display_name AS granter FROM user_badges b LEFT JOIN users g ON g.id = b.granted_by WHERE b.user_id = $1 ORDER BY b.earned_at`, [uid]);
  const { rows: [u] } = await pool.query('SELECT title FROM users WHERE id = $1', [uid]);
  const owned = new Set(rows.map(r => r.badge));
  return { badges: rows.map(badgeRow), fresh, title: u?.title && owned.has(u.title) ? u.title : null,
    progress: prog.map(p => ({ ...p, ...(({ label, desc, icon }) => ({ label, desc, icon }))(defOf(p.id)), earned: owned.has(p.id) })) };
}
// 멤버 목록·프로필에 붙일 칭호 이름(고른 배지가 여전히 내 것일 때만)
export async function titlesFor(ids) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(`SELECT u.id, b.badge, b.label FROM users u JOIN user_badges b ON b.user_id = u.id AND b.badge = u.title WHERE u.id = ANY($1)`, [ids]);
  const cnt = await pool.query(`SELECT user_id, count(*)::int AS n FROM user_badges WHERE user_id = ANY($1) GROUP BY user_id`, [ids]);
  const counts = new Map(cnt.rows.map(r => [r.user_id, r.n]));
  return new Map(ids.map(id => { const r = rows.find(x => x.id === id); return [id, { title: r ? (defOf(r.badge)?.label || r.label) : null, badgeCount: counts.get(id) || 0 }]; }));
}

export function registerBadges(app) {
  app.get('/me/badges', { preHandler: authenticate }, async req => refreshBadges(req.user.id));
  // 칭호 고르기(null = 칭호 없음). 가진 배지만
  app.put('/me/title', { preHandler: authenticate }, async (req, reply) => {
    const badge = req.body?.badge ?? null;
    if (badge !== null) {
      const own = await pool.query('SELECT 1 FROM user_badges WHERE user_id = $1 AND badge = $2', [req.user.id, String(badge)]);
      if (!own.rowCount) return reply.code(400).send({ error: 'not_owned' });
    }
    await pool.query('UPDATE users SET title = $2 WHERE id = $1', [req.user.id, badge]);
    return { title: badge };
  });
  // 다른 회원의 배지 보기(승인된 회원끼리)
  app.get('/users/:id/badges', { preHandler: authenticate }, async (req, reply) => {
    const id = Number(req.params.id);
    const { rows: [u] } = await pool.query(`SELECT id FROM users WHERE id = $1 AND status = 'approved'`, [id]);
    if (!u) return reply.code(404).send({ error: 'not_found' });
    const r = await refreshBadges(id);
    return { badges: r.badges, title: r.title };
  });
  // 운영진: 특별 배지 주기·회수
  app.post('/admin/users/:id/badges', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id), label = String(req.body?.label || '').trim().slice(0, 20), note = String(req.body?.note || '').trim().slice(0, 100);
    if (label.length < 2) return reply.code(400).send({ error: 'bad_label' });
    const { rows: [u] } = await pool.query(`SELECT id FROM users WHERE id = $1 AND status IN ('approved', 'suspended')`, [id]);
    if (!u) return reply.code(404).send({ error: 'not_found' });
    const { rows: [n] } = await pool.query(`SELECT nextval('custom_badge_seq') AS n`);
    const badge = 'custom:' + n.n;
    await pool.query('INSERT INTO user_badges (user_id, badge, label, note, granted_by) VALUES ($1, $2, $3, $4, $5)', [id, badge, label, note, req.user.id]);
    sendTo([id], { type: 'account', what: 'badge', badge, label });
    req.log.info({ admin: req.user.username, action: 'badge:grant', target: id, label }, 'admin action');
    return { badge, label };
  });
  app.delete('/admin/users/:id/badges/:badge', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id), badge = String(req.params.badge);
    if (!badge.startsWith('custom:')) return reply.code(400).send({ error: 'auto_badge' });   // 자동 배지는 회수하지 않음
    const r = await pool.query('DELETE FROM user_badges WHERE user_id = $1 AND badge = $2', [id, badge]);
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
    await pool.query('UPDATE users SET title = NULL WHERE id = $1 AND title = $2', [id, badge]);
    req.log.info({ admin: req.user.username, action: 'badge:revoke', target: id, badge }, 'admin action');
    return { ok: true };
  });
}
