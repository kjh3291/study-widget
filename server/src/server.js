// Studeck 서버 API. 계정(가입→운영진 승인), 기기 토큰, 항목 단위 데이터 동기화.
import Fastify from 'fastify';
import { pool, migrate } from './db.js';
import { hashPassword, verifyPassword, issueToken, authenticate, requireAdmin } from './auth.js';

const CHANNEL = process.env.STUDECK_CHANNEL || 'lab';
const KINDS = new Set(['todo', 'event', 'course', 'setting', 'focus']);
const MAX_CHANGES = 2000;
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const AUTO_APPROVE = CHANNEL === 'lab' && process.env.AUTO_APPROVE === 'true';

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 5 * 1024 * 1024 });

const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, status: u.status });

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { ok: true, channel: CHANNEL, version: process.env.npm_package_version || '0.1.0' };
});

// 가입: ADMIN_USERNAME과 같은 아이디는 운영진으로 바로 승인, 나머지는 승인 대기.
// AUTO_APPROVE=true(실험실 전용)면 모두 바로 승인한다.
app.post('/auth/signup', async (req, reply) => {
  const { username, password, displayName } = req.body || {};
  const name = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(name)) return reply.code(400).send({ error: 'bad_username', hint: '영문 소문자·숫자·_ 3~24자' });
  if (typeof password !== 'string' || password.length < 8) return reply.code(400).send({ error: 'weak_password', hint: '8자 이상' });
  const admin = !!ADMIN_USERNAME && name === ADMIN_USERNAME;
  const { rows } = await pool.query(
    `INSERT INTO users (username, pw_hash, display_name, role, status) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (username) DO NOTHING RETURNING *`,
    [name, await hashPassword(password), String(displayName || name).slice(0, 40),
      admin ? 'admin' : 'member', admin || AUTO_APPROVE ? 'approved' : 'pending']);
  if (!rows[0]) return reply.code(409).send({ error: 'username_taken' });
  return reply.code(201).send({ user: publicUser(rows[0]) });
});

app.post('/auth/login', async (req, reply) => {
  const { username, password, deviceName } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [String(username || '').trim().toLowerCase()]);
  const u = rows[0];
  if (!u || typeof password !== 'string' || !(await verifyPassword(password, u.pw_hash))) {
    return reply.code(401).send({ error: 'bad_credentials' });
  }
  if (u.status !== 'approved') return reply.code(403).send({ error: 'not_approved', status: u.status });
  return { token: await issueToken(u.id, deviceName), user: publicUser(u) };
});

app.post('/auth/logout', { preHandler: authenticate }, async (req) => {
  await pool.query('UPDATE devices SET revoked = true WHERE id = $1', [req.deviceId]);
  return { ok: true };
});

app.get('/me', { preHandler: authenticate }, async (req) => ({ user: req.user }));

// 운영진: 가입자 목록·승인·정지
app.get('/admin/users', { preHandler: requireAdmin }, async () => {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at');
  return { users: rows.map(publicUser) };
});

for (const [action, status] of [['approve', 'approved'], ['suspend', 'suspended']]) {
  app.post(`/admin/users/:id/${action}`, { preHandler: requireAdmin }, async (req, reply) => {
    const { rows } = await pool.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING *', [status, Number(req.params.id)]);
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    if (status === 'suspended') await pool.query('UPDATE devices SET revoked = true WHERE user_id = $1', [rows[0].id]);
    return { user: publicUser(rows[0]) };
  });
}

// 변경분 받기: since 이후 rev의 항목(삭제 포함)
async function pull(userId, since) {
  const { rows } = await pool.query(
    `SELECT kind, id, data, updated_at, deleted, rev FROM items
     WHERE user_id = $1 AND rev > $2 ORDER BY rev LIMIT $3`, [userId, since, MAX_CHANGES + 1]);
  const more = rows.length > MAX_CHANGES;
  const page = rows.slice(0, MAX_CHANGES);
  return {
    changes: page.map(r => ({ kind: r.kind, id: r.id, data: r.data, updatedAt: Number(r.updated_at), deleted: r.deleted })),
    cursor: page.length ? Number(page[page.length - 1].rev) : since,
    more,
  };
}

const cursorOf = (q) => Math.max(0, Number.parseInt(q, 10) || 0);

app.get('/sync', { preHandler: authenticate }, async (req) => pull(req.user.id, cursorOf(req.query.since)));

// 변경분 올리기 + 받기. 같은 항목은 updatedAt이 더 큰 쪽이 이긴다(항목 단위).
app.post('/sync', { preHandler: authenticate }, async (req, reply) => {
  const { since, changes } = req.body || {};
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES) return reply.code(400).send({ error: 'bad_changes' });
  for (const c of changes) {
    if (!c || !KINDS.has(c.kind) || typeof c.id !== 'string' || !c.id || c.id.length > 200
      || !Number.isFinite(c.updatedAt)) return reply.code(400).send({ error: 'bad_change', change: c && { kind: c.kind, id: c.id } });
  }
  let applied = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of changes) {
      const res = await client.query(
        `INSERT INTO items (user_id, kind, id, data, updated_at, deleted, rev)
         VALUES ($1, $2, $3, $4, $5, $6, nextval('item_rev'))
         ON CONFLICT (user_id, kind, id) DO UPDATE
           SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, deleted = EXCLUDED.deleted, rev = EXCLUDED.rev
           WHERE items.updated_at < EXCLUDED.updated_at`,
        [req.user.id, c.kind, c.id, c.deleted ? null : JSON.stringify(c.data ?? null), Math.trunc(c.updatedAt), !!c.deleted]);
      applied += res.rowCount;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { applied, ...(await pull(req.user.id, cursorOf(since))) };
});

await migrate();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT) || 3000 });
