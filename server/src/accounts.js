// 계정: 내 정보·비밀번호 변경·탈퇴·GitHub 연결·GitHub로 비밀번호 찾기,
// 운영진: 회원 목록·승인/거절·정지·삭제(30일 보관)·복구·임시 비밀번호, 최고 관리자: 운영진 지정.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { hashPassword, verifyPassword, authenticate, requireAdmin, RANK } from './auth.js';
import { clientIp, limits, tooMany } from './guard.js';

export const CONSENT_VERSION = '2026-10-v1';
const KEEP_DAYS = 30;

export const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, status: u.status, createdAt: u.created_at,
  email: u.email || '', githubLogin: u.github_login || '', mustChangePassword: !!u.must_change_pw, deletedAt: u.deleted_at || null });

const strongEnough = pw => typeof pw === 'string' && pw.length >= 8 && pw.length <= 128;
const revokeAll = (uid, exceptDevice = 0) => pool.query('UPDATE devices SET revoked = true WHERE user_id = $1 AND id <> $2', [uid, exceptDevice]);

// GitHub 접근 토큰으로 GitHub 계정과 확인된 대표 메일을 알아낸다(토큰은 저장하지 않음).
const GITHUB_API = process.env.GITHUB_API || 'https://api.github.com';
async function githubIdentity(token) {
  const h = { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'Studeck' };
  const res = await fetch(GITHUB_API + '/user', { headers: h, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const u = await res.json();
  let email = u.email || '';
  const er = await fetch(GITHUB_API + '/user/emails', { headers: h, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (er?.ok) { const list = await er.json(); email = (list.find(e => e.primary && e.verified) || list.find(e => e.verified))?.email || email; }
  return { id: Number(u.id), login: u.login, email };
}

export function registerAccounts(app) {
  // ---------- 내 계정 ----------
  app.get('/me', { preHandler: authenticate }, async req => {
    const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    return { user: publicUser(u) };
  });

  app.post('/me/password', { preHandler: authenticate }, async (req, reply) => {
    const { current, next } = req.body || {};
    const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!(await verifyPassword(String(current || ''), u.pw_hash))) return reply.code(401).send({ error: 'bad_credentials' });
    if (!strongEnough(next)) return reply.code(400).send({ error: 'weak_password' });
    await pool.query('UPDATE users SET pw_hash = $1, must_change_pw = false WHERE id = $2', [await hashPassword(next), u.id]);
    await revokeAll(u.id, req.deviceId); // 다른 기기는 다시 로그인
    return { ok: true };
  });

  // 탈퇴: 바로 로그인 차단, 데이터는 30일 뒤 완전 삭제(그 안에는 운영진이 복구 가능)
  app.post('/me/withdraw', { preHandler: authenticate }, async (req, reply) => {
    const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (u.role === 'owner') return reply.code(400).send({ error: 'owner_cannot_withdraw' });
    if (!(await verifyPassword(String(req.body?.password || ''), u.pw_hash))) return reply.code(401).send({ error: 'bad_credentials' });
    await pool.query(`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = $1`, [u.id]);
    await revokeAll(u.id);
    req.log.info({ user: u.username }, 'withdraw');
    return { ok: true, purgeAfterDays: KEEP_DAYS };
  });

  app.post('/me/github', { preHandler: authenticate }, async (req, reply) => {
    const gh = await githubIdentity(String(req.body?.accessToken || ''));
    if (!gh) return reply.code(400).send({ error: 'github_failed' });
    const taken = await pool.query('SELECT 1 FROM users WHERE github_id = $1 AND id <> $2', [gh.id, req.user.id]);
    if (taken.rowCount) return reply.code(409).send({ error: 'github_taken' });
    const { rows: [u] } = await pool.query('UPDATE users SET github_id = $1, github_login = $2, email = $3 WHERE id = $4 RETURNING *', [gh.id, gh.login, gh.email, req.user.id]);
    return { user: publicUser(u) };
  });
  app.delete('/me/github', { preHandler: authenticate }, async req => {
    const { rows: [u] } = await pool.query('UPDATE users SET github_id = NULL, github_login = NULL WHERE id = $1 RETURNING *', [req.user.id]);
    return { user: publicUser(u) };
  });

  // 비밀번호 찾기: 학번 + 연결해 둔 GitHub 계정으로 로그인한 토큰이 같으면 새 비밀번호로 바꾼다.
  app.post('/auth/github-reset', async (req, reply) => {
    const ip = clientIp(req), wait = limits.signupIp.blocked('reset:' + ip);
    if (wait) return tooMany(reply, wait);
    limits.signupIp.hit('reset:' + ip);
    const { username, accessToken, newPassword } = req.body || {};
    if (!strongEnough(newPassword)) return reply.code(400).send({ error: 'weak_password' });
    const { rows: [u] } = await pool.query('SELECT * FROM users WHERE username = $1', [String(username || '').trim().toLowerCase()]);
    const gh = await githubIdentity(String(accessToken || ''));
    if (!u || !gh || !u.github_id || Number(u.github_id) !== gh.id) return reply.code(403).send({ error: 'github_mismatch' });
    await pool.query('UPDATE users SET pw_hash = $1, must_change_pw = false WHERE id = $2', [await hashPassword(newPassword), u.id]);
    await revokeAll(u.id);
    limits.loginFail.reset(u.username);
    req.log.info({ user: u.username, github: gh.login }, 'password reset via github');
    return { ok: true };
  });

  // ---------- 운영진 ----------
  app.get('/admin/users', { preHandler: requireAdmin }, async () => {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at');
    return { users: rows.map(publicUser), keepDays: KEEP_DAYS };
  });

  // 대상 회원을 다룰 수 있는지: 자기 자신·최고 관리자는 안 되고, 운영진은 회원만, 최고 관리자는 운영진까지.
  async function target(req, reply) {
    const { rows: [t] } = await pool.query('SELECT * FROM users WHERE id = $1', [Number(req.params.id)]);
    if (!t) { reply.code(404).send({ error: 'not_found' }); return null; }
    if (t.id === req.user.id) { reply.code(400).send({ error: 'self' }); return null; }
    if ((RANK[t.role] || 0) >= RANK[req.user.role]) { reply.code(403).send({ error: 'outranked' }); return null; }
    return t;
  }
  const done = (req, action, t, extra = {}) => { req.log.info({ admin: req.user.username, action, target: t.username }, 'admin action'); return { user: publicUser(t), ...extra }; };
  const setStatus = async (t, status) => (await pool.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING *', [status, t.id])).rows[0];

  app.post('/admin/users/:id/approve', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await target(req, reply); if (!t) return;
    if (!['pending', 'suspended'].includes(t.status)) return reply.code(409).send({ error: 'bad_state' });
    return done(req, 'approve', await setStatus(t, 'approved'));
  });
  app.post('/admin/users/:id/reject', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await target(req, reply); if (!t) return;
    if (t.status !== 'pending') return reply.code(404).send({ error: 'not_found' });
    await pool.query('DELETE FROM users WHERE id = $1', [t.id]);
    return done(req, 'reject', t);
  });
  app.post('/admin/users/:id/suspend', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await target(req, reply); if (!t) return;
    if (t.status !== 'approved') return reply.code(409).send({ error: 'bad_state' });
    const u = await setStatus(t, 'suspended'); await revokeAll(t.id);
    return done(req, 'suspend', u);
  });
  app.post('/admin/users/:id/delete', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await target(req, reply); if (!t) return;
    if (t.status === 'deleted') return reply.code(409).send({ error: 'bad_state' });
    const { rows: [u] } = await pool.query(`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = $1 RETURNING *`, [t.id]);
    await revokeAll(t.id);
    return done(req, 'delete', u, { purgeAfterDays: KEEP_DAYS });
  });
  app.post('/admin/users/:id/restore', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await target(req, reply); if (!t) return;
    if (t.status !== 'deleted') return reply.code(409).send({ error: 'bad_state' });
    const { rows: [u] } = await pool.query(`UPDATE users SET status = 'approved', deleted_at = NULL WHERE id = $1 RETURNING *`, [t.id]);
    return done(req, 'restore', u);
  });
  // 임시 비밀번호: 운영진이 직접 전달, 회원은 첫 로그인 때 바꿔야 한다(GitHub 미연결 회원용 비상 수단).
  app.post('/admin/users/:id/temp-password', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await target(req, reply); if (!t) return;
    if (t.status !== 'approved') return reply.code(409).send({ error: 'bad_state' });
    const temp = crypto.randomBytes(9).toString('base64url').slice(0, 10);
    const { rows: [u] } = await pool.query('UPDATE users SET pw_hash = $1, must_change_pw = true WHERE id = $2 RETURNING *', [await hashPassword(temp), t.id]);
    await revokeAll(t.id);
    limits.loginFail.reset(t.username);
    return done(req, 'temp-password', u, { tempPassword: temp });
  });
  // 운영진 지정·해제: 최고 관리자만
  app.post('/admin/users/:id/role', { preHandler: requireAdmin }, async (req, reply) => {
    if (req.user.role !== 'owner') return reply.code(403).send({ error: 'owner_only' });
    const role = req.body?.role;
    if (!['admin', 'member'].includes(role)) return reply.code(400).send({ error: 'bad_role' });
    const t = await target(req, reply); if (!t) return;
    if (t.status !== 'approved') return reply.code(409).send({ error: 'bad_state' });
    const { rows: [u] } = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING *', [role, t.id]);
    return done(req, 'role:' + role, u);
  });
}

// 매일: 삭제 후 30일 지난 계정을 완전히 지운다(할 일·파일 기록은 연쇄 삭제, 파일 내용은 purgeFiles가 정리).
export async function purgeAccounts(log) {
  const { rows } = await pool.query(`DELETE FROM users WHERE status = 'deleted' AND deleted_at < now() - interval '${KEEP_DAYS} days' RETURNING username`);
  for (const r of rows) log?.info({ user: r.username }, 'account purged');
}
