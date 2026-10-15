// 비밀번호 해시(scrypt)와 기기 토큰. 토큰 원문은 발급 때 한 번만 돌려주고 DB엔 해시만 둔다.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function issueToken(userId, deviceName) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO devices (user_id, token_hash, name) VALUES ($1, $2, $3)',
    [userId, sha256(token), String(deviceName || '').slice(0, 80)]);
  return token;
}

// Authorization: Bearer <token> → { user, deviceId }. 승인되지 않은 계정은 막는다.
export async function authenticate(req, reply) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return reply.code(401).send({ error: 'unauthorized' });
  const { rows } = await pool.query(
    `SELECT d.id AS device_id, u.* FROM devices d JOIN users u ON u.id = d.user_id
     WHERE d.token_hash = $1 AND NOT d.revoked`, [sha256(m[1])]);
  const row = rows[0];
  if (!row) return reply.code(401).send({ error: 'unauthorized' });
  if (row.status !== 'approved') return reply.code(403).send({ error: 'not_approved', status: row.status });
  await pool.query('UPDATE devices SET last_seen = now() WHERE id = $1', [row.device_id]);
  req.user = { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
  req.deviceId = row.device_id;
}

export async function requireAdmin(req, reply) {
  await authenticate(req, reply);
  if (reply.sent) return;
  if (req.user.role !== 'admin') return reply.code(403).send({ error: 'admin_only' });
}
