// Studeck 서버 API. 계정(가입→운영진 승인), 기기 토큰, 항목 단위 데이터 동기화.
import Fastify from 'fastify';
import { pool, migrate } from './db.js';
import { hashPassword, verifyPassword, issueToken, authenticate, requireAdmin } from './auth.js';
import { clientIp, limits, tooMany, securityHeaders } from './guard.js';
import { registerFiles, purgeFiles } from './files.js';
import { registerAccounts, purgeAccounts, CONSENT_VERSION, publicUser } from './accounts.js';
import { statusError } from './auth.js';

const CHANNEL = process.env.STUDECK_CHANNEL || 'lab';
const KINDS = new Set(['todo', 'event', 'course', 'setting', 'focus']);
const MAX_CHANGES = 2000;
const USERNAME_RE = /^\d{8,10}$/; // 아이디 = 학번(운영진 ADMIN_USERNAME만 예외)
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
// 실험실 전용: 자동 테스트용 가짜 학번(예: 99로 시작)만 바로 승인한다. 운영에서는 무시된다.
const AUTO_APPROVE_PREFIX = CHANNEL === 'lab' ? String(process.env.AUTO_APPROVE_PREFIX || '') : '';
const autoApproved = (name) => !!AUTO_APPROVE_PREFIX && name.startsWith(AUTO_APPROVE_PREFIX);

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 5 * 1024 * 1024 });
securityHeaders(app);
registerFiles(app);
registerAccounts(app);


app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { ok: true, channel: CHANNEL, version: process.env.npm_package_version || '0.1.0' };
});

// 가입 신청: 아이디는 학번, 이름 필수. ADMIN_USERNAME은 운영진으로 바로 승인, 나머지는 승인 대기.
// 실험실의 AUTO_APPROVE_PREFIX(자동 테스트용 가짜 학번)만 바로 승인한다.
app.post('/auth/signup', async (req, reply) => {
  const ip = clientIp(req);
  const wait = limits.signupIp.blocked(ip);
  if (wait) return tooMany(reply, wait);
  limits.signupIp.hit(ip);
  const { username, password, displayName } = req.body || {};
  const name = String(username || '').trim().toLowerCase();
  const admin = !!ADMIN_USERNAME && name === ADMIN_USERNAME;
  const realName = String(displayName || '').trim();
  if (!admin && !USERNAME_RE.test(name)) return reply.code(400).send({ error: 'bad_username', hint: '학번(숫자 8~10자리)' });
  if (realName.length < 2 || realName.length > 20) return reply.code(400).send({ error: 'bad_name', hint: '이름 2~20자' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return reply.code(400).send({ error: 'weak_password', hint: '8자 이상' });
  if (!admin && req.body?.consent !== CONSENT_VERSION) return reply.code(400).send({ error: 'consent_required', version: CONSENT_VERSION });
  const { rows } = await pool.query(
    `INSERT INTO users (username, pw_hash, display_name, role, status, consent_version, consent_at) VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (username) DO NOTHING RETURNING *`,
    [name, await hashPassword(password), realName,
      admin ? 'owner' : 'member', admin || autoApproved(name) ? 'approved' : 'pending', CONSENT_VERSION]);
  if (!rows[0]) return reply.code(409).send({ error: 'username_taken' });
  return reply.code(201).send({ user: publicUser(rows[0]) });
});

// 로그인: IP별 시도 제한 + 학번별 연속 실패 잠금(15분 동안 5번).
app.post('/auth/login', async (req, reply) => {
  const { username, password, deviceName } = req.body || {};
  const name = String(username || '').trim().toLowerCase();
  const ip = clientIp(req);
  const ipWait = limits.loginIp.blocked(ip);
  if (ipWait) return tooMany(reply, ipWait);
  const lockWait = limits.loginFail.blocked(name);
  if (lockWait) return tooMany(reply, lockWait, 'locked');
  limits.loginIp.hit(ip);
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [name]);
  const u = rows[0];
  if (!u || typeof password !== 'string' || !(await verifyPassword(password, u.pw_hash))) {
    limits.loginFail.hit(name);
    req.log.warn({ ip, username: name }, 'login failed');
    return reply.code(401).send({ error: 'bad_credentials' });
  }
  limits.loginFail.reset(name);
  if (u.status !== 'approved') return reply.code(403).send({ error: statusError(u.status), status: u.status });
  return { token: await issueToken(u.id, deviceName), user: publicUser(u) };
});

app.post('/auth/logout', { preHandler: authenticate }, async (req) => {
  await pool.query('UPDATE devices SET revoked = true WHERE id = $1', [req.deviceId]);
  return { ok: true };
});


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
      const key = [req.user.id, c.kind, c.id], data = c.deleted ? null : JSON.stringify(c.data ?? null), at = Math.trunc(c.updatedAt);
      // 모든 변경을 기록한다: 덮어써지는 이전 값(또는 더 오래된 늦은 도착분)을 items_history에 남긴다.
      await client.query(
        `INSERT INTO items_history (user_id, kind, id, data, updated_at, deleted)
         SELECT user_id, kind, id, data, updated_at, deleted FROM items
         WHERE user_id = $1 AND kind = $2 AND id = $3 AND updated_at < $4`, [...key, at]);
      const res = await client.query(
        `INSERT INTO items (user_id, kind, id, data, updated_at, deleted, rev)
         VALUES ($1, $2, $3, $4, $5, $6, nextval('item_rev'))
         ON CONFLICT (user_id, kind, id) DO UPDATE
           SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, deleted = EXCLUDED.deleted, rev = EXCLUDED.rev
           WHERE items.updated_at < EXCLUDED.updated_at`,
        [...key, data, at, !!c.deleted]);
      if (!res.rowCount) {
        await client.query(`INSERT INTO items_history (user_id, kind, id, data, updated_at, deleted) VALUES ($1, $2, $3, $4, $5, $6)`, [...key, data, at, !!c.deleted]);
      }
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
const pruneHistory = () => pool.query(`DELETE FROM items_history WHERE recorded_at < now() - interval '30 days'`).catch(e => app.log.error(e));
pruneHistory(); setInterval(pruneHistory, 24 * 60 * 60 * 1000).unref();
const purge = () => purgeAccounts(app.log).then(() => purgeFiles(app.log)).catch(e => app.log.error(e));
purge(); setInterval(purge, 24 * 60 * 60 * 1000).unref();
// 이미 가입된 계정도 ADMIN_USERNAME이면 운영진으로 올린다.
if (ADMIN_USERNAME) await pool.query(`UPDATE users SET role = 'owner', status = 'approved', deleted_at = NULL WHERE username = $1`, [ADMIN_USERNAME]);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT) || 3000 });
