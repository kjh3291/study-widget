// 개인 파일 저장소: 업로드할 때마다 버전이 쌓이고(나중 것이 현재), 삭제는 휴지통(30일).
// "어느 쪽을 남길지" 선택은 없다. 더 오래된 수정이 늦게 도착하면 이전 버전으로만 보관한다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool } from './db.js';
import { authenticate } from './auth.js';

const FILES_DIR = process.env.FILES_DIR || '/data/files';
const MB = 1024 * 1024;
const FILE_MAX = (Number(process.env.FILE_MAX_MB) || 50) * MB;
const QUOTA = (Number(process.env.QUOTA_MB) || 2048) * MB;
const KEEP_VERSIONS = 10, KEEP_DAYS = 30;

const blobPath = (uid, sha) => path.join(FILES_DIR, String(uid), sha.slice(0, 2), sha);

// 'A/B/c.pdf' 형태의 상대 경로만 허용(.., 빈 칸, 절대 경로, 제어 문자 금지).
export function cleanPath(p) {
  const s = String(p || '').normalize('NFC').replace(/\\/g, '/');
  if (!s || s.length > 400 || s.startsWith('/') || /[\u0000-\u001f]/.test(s)) return null;
  const parts = s.split('/');
  if (parts.length < 2 || parts.some(x => !x || x === '.' || x === '..')) return null;
  return parts.join('/');
}

async function usage(uid, db = pool) {
  const { rows: [{ used }] } = await db.query(
    `SELECT coalesce(sum(size), 0)::bigint AS used FROM (
       SELECT sha256, size FROM files WHERE user_id = $1
       UNION SELECT sha256, size FROM file_versions WHERE user_id = $1) t`, [uid]);
  return Number(used);
}

const fileRow = r => ({ path: r.path, sha256: r.sha256, size: Number(r.size), updatedAt: Number(r.updated_at), deleted: r.deleted, rev: Number(r.rev) });

export function registerFiles(app) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: FILE_MAX }, (_req, body, done) => done(null, body));

  app.get('/files/usage', { preHandler: authenticate }, async req => ({ used: await usage(req.user.id), limit: QUOTA, fileMax: FILE_MAX }));

  // 변경분(삭제 포함): since 이후 rev
  app.get('/files', { preHandler: authenticate }, async req => {
    const since = Math.max(0, Number.parseInt(req.query.since, 10) || 0);
    const { rows } = await pool.query('SELECT * FROM files WHERE user_id = $1 AND rev > $2 ORDER BY rev LIMIT 5001', [req.user.id, since]);
    const page = rows.slice(0, 5000);
    return { files: page.map(fileRow), cursor: page.length ? Number(page[page.length - 1].rev) : since, more: rows.length > 5000 };
  });

  // 업로드: 본문 = 파일 바이트. ?path=&updatedAt=
  app.put('/files/content', { preHandler: authenticate, bodyLimit: FILE_MAX }, async (req, reply) => {
    const p = cleanPath(req.query.path), at = Math.trunc(Number(req.query.updatedAt));
    const body = req.body;
    if (!p || !Number.isFinite(at) || !Buffer.isBuffer(body)) return reply.code(400).send({ error: 'bad_request' });
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    if (req.headers['x-sha256'] && req.headers['x-sha256'] !== sha) return reply.code(400).send({ error: 'hash_mismatch' });
    const uid = req.user.id, dest = blobPath(uid, sha);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [uid]); // 사용자별 업로드 직렬화(용량 계산 정확히)
      const { rows: [cur] } = await client.query('SELECT * FROM files WHERE user_id = $1 AND path = $2', [uid, p]);
      if (cur && !cur.deleted && cur.sha256 === sha) { await client.query('COMMIT'); return { result: 'unchanged', file: fileRow(cur) }; }
      const known = await client.query('SELECT 1 FROM files WHERE user_id = $1 AND sha256 = $2 UNION SELECT 1 FROM file_versions WHERE user_id = $1 AND sha256 = $2 LIMIT 1', [uid, sha]);
      if (!known.rowCount && (await usage(uid, client)) + body.length > QUOTA) { await client.query('ROLLBACK'); return reply.code(413).send({ error: 'quota', limit: QUOTA }); }
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const tmp = dest + '.tmp-' + process.pid + '-' + Date.now();
        fs.writeFileSync(tmp, body); fs.renameSync(tmp, dest);
      }
      if (cur && Number(cur.updated_at) > at) {
        // 늦게 도착한 더 오래된 수정: 현재 파일은 그대로, 이전 버전으로만 보관
        await client.query('INSERT INTO file_versions (user_id, path, sha256, size, updated_at) VALUES ($1, $2, $3, $4, $5)', [uid, p, sha, body.length, at]);
        await client.query('COMMIT');
        return { result: 'kept_as_version', file: fileRow(cur) };
      }
      if (cur) await client.query('INSERT INTO file_versions (user_id, path, sha256, size, updated_at) VALUES ($1, $2, $3, $4, $5)', [uid, p, cur.sha256, cur.size, cur.updated_at]);
      const { rows: [row] } = await client.query(
        `INSERT INTO files (user_id, path, sha256, size, updated_at, deleted, deleted_at, rev) VALUES ($1, $2, $3, $4, $5, false, NULL, nextval('file_rev'))
         ON CONFLICT (user_id, path) DO UPDATE SET sha256 = EXCLUDED.sha256, size = EXCLUDED.size, updated_at = EXCLUDED.updated_at,
           deleted = false, deleted_at = NULL, rev = EXCLUDED.rev RETURNING *`, [uid, p, sha, body.length, at]);
      await client.query('COMMIT');
      return { result: 'stored', file: fileRow(row) };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  // 내용 받기: 현재 파일(path) 또는 내 버전(sha)
  app.get('/files/content', { preHandler: authenticate }, async (req, reply) => {
    const uid = req.user.id;
    let sha = /^[0-9a-f]{64}$/.test(req.query.sha || '') ? req.query.sha : null;
    if (sha) {
      const ok = await pool.query('SELECT 1 FROM files WHERE user_id = $1 AND sha256 = $2 UNION SELECT 1 FROM file_versions WHERE user_id = $1 AND sha256 = $2 LIMIT 1', [uid, sha]);
      if (!ok.rowCount) return reply.code(404).send({ error: 'not_found' });
    } else {
      const p = cleanPath(req.query.path);
      const { rows: [cur] } = p ? await pool.query('SELECT sha256 FROM files WHERE user_id = $1 AND path = $2 AND NOT deleted', [uid, p]) : { rows: [] };
      if (!cur) return reply.code(404).send({ error: 'not_found' });
      sha = cur.sha256;
    }
    const file = blobPath(uid, sha);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'missing_blob' });
    reply.header('content-type', 'application/octet-stream').header('x-sha256', sha);
    return reply.send(fs.createReadStream(file));
  });

  // 삭제 → 휴지통. 삭제보다 나중에 수정된 파일이면 수정이 이긴다.
  app.delete('/files', { preHandler: authenticate }, async (req, reply) => {
    const p = cleanPath(req.query.path), at = Math.trunc(Number(req.query.updatedAt));
    if (!p || !Number.isFinite(at)) return reply.code(400).send({ error: 'bad_request' });
    const { rows: [row] } = await pool.query(
      `UPDATE files SET deleted = true, deleted_at = now(), updated_at = $3, rev = nextval('file_rev')
       WHERE user_id = $1 AND path = $2 AND NOT deleted AND updated_at <= $3 RETURNING *`, [req.user.id, p, at]);
    if (row) return { result: 'trashed', file: fileRow(row) };
    const { rows: [cur] } = await pool.query('SELECT * FROM files WHERE user_id = $1 AND path = $2', [req.user.id, p]);
    return { result: cur ? (cur.deleted ? 'already_deleted' : 'newer_edit_kept') : 'not_found', file: cur ? fileRow(cur) : null };
  });

  app.get('/files/trash', { preHandler: authenticate }, async req => {
    const { rows } = await pool.query('SELECT path, size, deleted_at FROM files WHERE user_id = $1 AND deleted ORDER BY deleted_at DESC', [req.user.id]);
    return { trash: rows.map(r => ({ path: r.path, size: Number(r.size), deletedAt: r.deleted_at })) };
  });

  app.post('/files/restore', { preHandler: authenticate }, async (req, reply) => {
    const p = cleanPath(req.body?.path);
    const { rows: [row] } = p ? await pool.query(
      `UPDATE files SET deleted = false, deleted_at = NULL, updated_at = $3, rev = nextval('file_rev')
       WHERE user_id = $1 AND path = $2 AND deleted RETURNING *`, [req.user.id, p, Date.now()]) : { rows: [] };
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { file: fileRow(row) };
  });

  app.get('/files/versions', { preHandler: authenticate }, async (req, reply) => {
    const p = cleanPath(req.query.path);
    if (!p) return reply.code(400).send({ error: 'bad_request' });
    const { rows } = await pool.query('SELECT vid, sha256, size, updated_at, recorded_at FROM file_versions WHERE user_id = $1 AND path = $2 ORDER BY recorded_at DESC', [req.user.id, p]);
    return { versions: rows.map(r => ({ vid: r.vid, sha256: r.sha256, size: Number(r.size), updatedAt: Number(r.updated_at), recordedAt: r.recorded_at })) };
  });

  // 이전 버전으로 되돌리기: 지금 파일은 버전으로 남기고, 고른 버전이 새 현재 파일이 된다.
  app.post('/files/revert', { preHandler: authenticate }, async (req, reply) => {
    const p = cleanPath(req.body?.path), vid = Number(req.body?.vid), uid = req.user.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [v] } = await client.query('SELECT * FROM file_versions WHERE vid = $1 AND user_id = $2 AND path = $3', [vid, uid, p]);
      if (!v) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'not_found' }); }
      const { rows: [cur] } = await client.query('SELECT * FROM files WHERE user_id = $1 AND path = $2 FOR UPDATE', [uid, p]);
      if (cur) await client.query('INSERT INTO file_versions (user_id, path, sha256, size, updated_at) VALUES ($1, $2, $3, $4, $5)', [uid, p, cur.sha256, cur.size, cur.updated_at]);
      const { rows: [row] } = await client.query(
        `INSERT INTO files (user_id, path, sha256, size, updated_at, deleted, deleted_at, rev) VALUES ($1, $2, $3, $4, $5, false, NULL, nextval('file_rev'))
         ON CONFLICT (user_id, path) DO UPDATE SET sha256 = EXCLUDED.sha256, size = EXCLUDED.size, updated_at = EXCLUDED.updated_at, deleted = false, deleted_at = NULL, rev = EXCLUDED.rev
         RETURNING *`, [uid, p, v.sha256, v.size, Date.now()]);
      await client.query('COMMIT');
      return { file: fileRow(row) };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });
}

// 매일: 휴지통 30일 지난 것, 오래되거나 넘치는 버전 정리 → 어디서도 안 쓰는 내용 파일 삭제
export async function purgeFiles(log) {
  await pool.query(`DELETE FROM files WHERE deleted AND deleted_at < now() - interval '${KEEP_DAYS} days'`);
  await pool.query(`DELETE FROM file_versions WHERE recorded_at < now() - interval '${KEEP_DAYS} days'`);
  await pool.query(`DELETE FROM file_versions v USING (
      SELECT vid, row_number() OVER (PARTITION BY user_id, path ORDER BY recorded_at DESC) AS n FROM file_versions) x
    WHERE v.vid = x.vid AND x.n > ${KEEP_VERSIONS}`);
  if (!fs.existsSync(FILES_DIR)) return;
  for (const uid of fs.readdirSync(FILES_DIR)) {
    const { rows } = await pool.query('SELECT sha256 FROM files WHERE user_id = $1 UNION SELECT sha256 FROM file_versions WHERE user_id = $1', [Number(uid) || 0]);
    const used = new Set(rows.map(r => r.sha256));
    const base = path.join(FILES_DIR, uid);
    for (const pre of fs.readdirSync(base)) for (const sha of fs.readdirSync(path.join(base, pre))) {
      if (!used.has(sha)) { fs.rmSync(path.join(base, pre, sha), { force: true }); log?.info({ uid, sha }, 'purged blob'); }
    }
  }
}
