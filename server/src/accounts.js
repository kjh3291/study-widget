// 계정: 내 정보·비밀번호 변경·탈퇴·GitHub 연결·GitHub로 비밀번호 찾기,
// 운영진: 회원 목록·승인/거절·정지·삭제(30일 보관)·복구·임시 비밀번호, 최고 관리자: 운영진 지정.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { hashPassword, verifyPassword, authenticate, requireAdmin, RANK } from './auth.js';
import { clientIp, limits, tooMany } from './guard.js';
import { sendTo } from './community.js';

export const CONSENT_VERSION = '2026-10-v1';
const KEEP_DAYS = 30;

export const POSITIONS = ['member', 'officer', 'president'];   // 부원·임원·회장
export const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, position: u.position || 'member', status: u.status, createdAt: u.created_at,
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

  // 승인: 가입 신청이면 직책을 함께 정한다(기본 부원, 회장은 최고 관리자만)
  app.post('/admin/users/:id/approve', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await target(req, reply); if (!t) return;
    if (!['pending', 'suspended'].includes(t.status)) return reply.code(409).send({ error: 'bad_state' });
    const position = req.body?.position ?? (t.status === 'pending' ? 'member' : t.position);
    if (!POSITIONS.includes(position)) return reply.code(400).send({ error: 'bad_position' });
    if (position === 'president' && req.user.role !== 'owner') return reply.code(403).send({ error: 'president_owner_only' });
    const { rows: [u] } = await pool.query(`UPDATE users SET status = 'approved', position = $2 WHERE id = $1 RETURNING *`, [t.id, position]);
    return done(req, 'approve:' + position, u);
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
  // 직책 변경: 관리자는 자기보다 낮은 권한의 회원을 부원↔임원으로, 회장 지정·해제는 최고 관리자만(최고 관리자는 자기 직책도 바꿈)
  app.post('/admin/users/:id/position', { preHandler: requireAdmin }, async (req, reply) => {
    const position = req.body?.position;
    if (!POSITIONS.includes(position)) return reply.code(400).send({ error: 'bad_position' });
    const { rows: [t] } = await pool.query('SELECT * FROM users WHERE id = $1', [Number(req.params.id)]);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    const owner = req.user.role === 'owner';
    if (!owner && (t.id === req.user.id || (RANK[t.role] || 0) >= RANK[req.user.role])) return reply.code(403).send({ error: 'outranked' });
    if ((position === 'president' || t.position === 'president') && !owner) return reply.code(403).send({ error: 'president_owner_only' });
    if (t.status !== 'approved' && t.status !== 'suspended') return reply.code(409).send({ error: 'bad_state' });
    const { rows: [u] } = await pool.query('UPDATE users SET position = $1 WHERE id = $2 RETURNING *', [position, t.id]);
    // 직책이 바뀌면 그 사람의 대기 중 임원 신청은 정리
    await pool.query(`UPDATE position_requests SET status = 'cancelled', decided_by = $2, decided_at = now() WHERE user_id = $1 AND status = 'pending'`, [t.id, req.user.id]);
    sendTo([t.id], { type: 'account', what: 'position', position });
    return done(req, 'position:' + position, u);
  });

  // ---------- 임원 신청(부원만, 회장은 신청 불가) ----------
  const requestRow = r => r && ({ id: r.id, position: r.position, message: r.message, status: r.status, createdAt: r.created_at, decidedAt: r.decided_at,
    user: r.username ? { id: r.user_id, username: r.username, name: r.display_name, position: r.user_position } : undefined });
  const adminIds = async () => (await pool.query(`SELECT id FROM users WHERE role IN ('admin', 'owner') AND status = 'approved'`)).rows.map(r => r.id);
  app.get('/me/position-request', { preHandler: authenticate }, async req => {
    const { rows: [r] } = await pool.query('SELECT * FROM position_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [req.user.id]);
    return { request: requestRow(r) || null };
  });
  app.post('/me/position-request', { preHandler: authenticate }, async (req, reply) => {
    const { rows: [u] } = await pool.query('SELECT position FROM users WHERE id = $1', [req.user.id]);
    if ((u.position || 'member') !== 'member') return reply.code(409).send({ error: 'already_officer' });
    const message = String(req.body?.message || '').trim().slice(0, 300);
    const { rows: [r] } = await pool.query(`INSERT INTO position_requests (user_id, position, message) VALUES ($1, 'officer', $2) ON CONFLICT DO NOTHING RETURNING *`, [req.user.id, message]);
    if (!r) return reply.code(409).send({ error: 'request_pending' });
    sendTo(await adminIds(), { type: 'admin', what: 'position-request' });
    return { request: requestRow(r) };
  });
  app.delete('/me/position-request', { preHandler: authenticate }, async (req, reply) => {
    const r = await pool.query(`UPDATE position_requests SET status = 'cancelled', decided_at = now() WHERE user_id = $1 AND status = 'pending'`, [req.user.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
    sendTo(await adminIds(), { type: 'admin', what: 'position-request' });
    return { ok: true };
  });
  app.get('/admin/position-requests', { preHandler: requireAdmin }, async () => {
    const { rows } = await pool.query(`SELECT p.*, u.username, u.display_name, u.position AS user_position FROM position_requests p JOIN users u ON u.id = p.user_id
      WHERE p.status = 'pending' AND u.status = 'approved' ORDER BY p.created_at`);
    return { requests: rows.map(requestRow) };
  });
  for (const [action, status] of [['approve', 'approved'], ['reject', 'rejected']]) {
    app.post(`/admin/position-requests/:id/${action}`, { preHandler: requireAdmin }, async (req, reply) => {
      const { rows: [r] } = await pool.query(`UPDATE position_requests SET status = $1, decided_by = $2, decided_at = now() WHERE id = $3 AND status = 'pending' RETURNING *`,
        [status, req.user.id, Number(req.params.id)]);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      if (status === 'approved') await pool.query(`UPDATE users SET position = 'officer' WHERE id = $1 AND position = 'member'`, [r.user_id]);
      sendTo([r.user_id], { type: 'account', what: 'position-request', status });
      req.log.info({ admin: req.user.username, action: 'position-request:' + action, request: r.id }, 'admin action');
      return { ok: true };
    });
  }

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
