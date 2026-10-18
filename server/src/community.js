// 동아리 커뮤니티: 공지(운영진 작성·고정), 채팅방(전체 + 운영진이 만드는 주제방), 메시지(사진 첨부), 프로필.
// 실시간: /ws 웹소켓. 연결 후 첫 메시지로 {type:'auth', token}을 보내야 한다(토큰을 주소에 넣지 않음).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import websocket from '@fastify/websocket';
import { pool } from './db.js';
import { authenticate, requireAdmin, sha256 } from './auth.js';
import { registerRooms, ensureAllRoom } from './rooms.js';

const MEDIA_DIR = path.join(process.env.FILES_DIR || '/data/files', 'media');
const IMAGE_MAX = 10 * 1024 * 1024;

// ---------- 실시간 연결 ----------
const sockets = new Map(); // socket → { userId }
// 특정 회원들에게만(방 멤버 등)
export function sendTo(userIds, event) {
  const ids = new Set(userIds.map(Number)), data = JSON.stringify(event);
  for (const [ws, info] of sockets) if (info.userId && ids.has(info.userId) && ws.readyState === 1) ws.send(data);
}
export function broadcast(event) {
  const data = JSON.stringify(event);
  for (const [ws, info] of sockets) if (info.userId && ws.readyState === 1) ws.send(data);
}
const onlineIds = () => new Set([...sockets.values()].map(s => s.userId).filter(Boolean));

// 사진만 허용(앞부분 바이트로 형식 확인)
function imageMime(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}


const memberName = r => r.nickname || r.display_name;
const noticeRow = r => ({ id: r.id, title: r.title, body: r.body, pinned: r.pinned, author: r.author_id ? memberName(r) : '(탈퇴한 회원)', createdAt: r.created_at, updatedAt: r.updated_at });

// 프로필 공개 항목: 오늘 공부 시간·시간표는 본인이 켰을 때만
async function publicStudy(uid) {
  const { rows } = await pool.query(`SELECT data FROM items WHERE user_id = $1 AND kind = 'setting' AND id = 'focus' AND NOT deleted`, [uid]);
  const sessions = rows[0]?.data?.v?.sessions || [];
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // 한국 시간 기준
  return { todayMinutes: sessions.filter(s => s.date === today).reduce((a, s) => a + (Number(s.minutes) || 0), 0) };
}
async function publicTimetable(uid) {
  const { rows } = await pool.query(`SELECT data FROM items WHERE user_id = $1 AND kind = 'course' AND NOT deleted`, [uid]);
  return rows.map(r => r.data?.v).filter(Boolean).map(c => ({ name: c.name, times: (c.times || []).map(t => ({ day: t.day, start: t.start, end: t.end })) }));
}

// 매일: 메시지·프로필 어디에서도 쓰지 않는 사진(올린 지 하루 지난 것)을 지운다.
export async function purgeMedia(log) {
  const { rows } = await pool.query(`DELETE FROM media m WHERE m.created_at < now() - interval '1 day'
    AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.image->>'sha' = m.sha256 AND NOT x.deleted)
    AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.avatar_sha = m.sha256) RETURNING sha256`);
  for (const { sha256: sha } of rows) { fs.rmSync(path.join(MEDIA_DIR, sha.slice(0, 2), sha), { force: true }); log?.info({ sha }, 'purged media'); }
}

export function registerCommunity(app) {
  app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  app.register(async scoped => {
    scoped.get('/ws', { websocket: true }, (socket) => {
      sockets.set(socket, { userId: null });
      const timer = setTimeout(() => { if (!sockets.get(socket)?.userId) socket.close(4001, 'auth required'); }, 10000);
      socket.on('message', async raw => {
        let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg.type === 'auth' && !sockets.get(socket)?.userId) {
          const { rows } = await pool.query(`SELECT u.id FROM devices d JOIN users u ON u.id = d.user_id
            WHERE d.token_hash = $1 AND NOT d.revoked AND u.status = 'approved'`, [sha256(String(msg.token || ''))]);
          if (!rows[0]) return socket.close(4003, 'unauthorized');
          clearTimeout(timer);
          await ensureAllRoom(rows[0].id);
          const wasOnline = onlineIds().has(rows[0].id);
          sockets.set(socket, { userId: rows[0].id });
          socket.send(JSON.stringify({ type: 'ready', online: [...onlineIds()] }));
          if (!wasOnline) broadcast({ type: 'presence', userId: rows[0].id, online: true });
        } else if (msg.type === 'ping') socket.send('{"type":"pong"}');
      });
      socket.on('close', () => {
        clearTimeout(timer);
        const uid = sockets.get(socket)?.userId;
        sockets.delete(socket);
        if (uid && !onlineIds().has(uid)) broadcast({ type: 'presence', userId: uid, online: false });
      });
    });
  });

  // ---------- 사진(공용 미디어) ----------
  app.post('/media', { preHandler: authenticate, bodyLimit: IMAGE_MAX }, async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ error: 'bad_request' });
    const mime = imageMime(body);
    if (!mime) return reply.code(415).send({ error: 'not_image' });
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    const dest = path.join(MEDIA_DIR, sha.slice(0, 2), sha);
    if (!fs.existsSync(dest)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest + '.tmp', body); fs.renameSync(dest + '.tmp', dest); }
    await pool.query('INSERT INTO media (sha256, mime, size, uploaded_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [sha, mime, body.length, req.user.id]);
    return { sha, mime, size: body.length };
  });
  app.get('/media/:sha', { preHandler: authenticate }, async (req, reply) => {
    const sha = String(req.params.sha);
    const { rows: [m] } = /^[0-9a-f]{64}$/.test(sha) ? await pool.query('SELECT mime FROM media WHERE sha256 = $1', [sha]) : { rows: [] };
    const file = m && path.join(MEDIA_DIR, sha.slice(0, 2), sha);
    if (!m || !fs.existsSync(file)) return reply.code(404).send({ error: 'not_found' });
    reply.header('content-type', m.mime).header('cache-control', 'private, max-age=31536000, immutable');
    return reply.send(fs.createReadStream(file));
  });
  const knownImage = async (sha) => /^[0-9a-f]{64}$/.test(sha || '') && (await pool.query('SELECT mime, size FROM media WHERE sha256 = $1', [sha])).rows[0];

  // ---------- 프로필 ----------
  app.get('/profiles', { preHandler: authenticate }, async () => {
    const { rows } = await pool.query(`SELECT u.id, u.username, u.display_name, u.role, p.* FROM users u LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'approved' ORDER BY u.display_name`);
    const online = onlineIds();
    return { members: await Promise.all(rows.map(async r => ({ id: r.id, name: r.display_name, nickname: r.nickname || '', role: r.role, bio: r.bio || '',
      avatar: r.avatar_sha || null, online: online.has(r.id),
      study: r.show_study ? await publicStudy(r.id) : null, timetable: r.show_timetable ? await publicTimetable(r.id) : null }))) };
  });
  app.get('/me/profile', { preHandler: authenticate }, async req => {
    const { rows: [p] } = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
    return { profile: { nickname: p?.nickname || '', bio: p?.bio || '', avatar: p?.avatar_sha || null, showStudy: !!p?.show_study, showTimetable: !!p?.show_timetable } };
  });
  app.put('/me/profile', { preHandler: authenticate }, async (req, reply) => {
    const b = req.body || {};
    const nickname = String(b.nickname ?? '').trim().slice(0, 20), bio = String(b.bio ?? '').trim().slice(0, 200);
    if (b.avatar && !(await knownImage(b.avatar))) return reply.code(400).send({ error: 'bad_avatar' });
    await pool.query(`INSERT INTO profiles (user_id, nickname, bio, avatar_sha, show_study, show_timetable, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname, bio = EXCLUDED.bio, avatar_sha = EXCLUDED.avatar_sha,
        show_study = EXCLUDED.show_study, show_timetable = EXCLUDED.show_timetable, updated_at = now()`,
      [req.user.id, nickname || null, bio, b.avatar || null, !!b.showStudy, !!b.showTimetable]);
    broadcast({ type: 'profile', userId: req.user.id });
    return { ok: true };
  });

  // ---------- 공지 ----------
  const NOTICE_SELECT = `SELECT n.*, u.display_name, p.nickname FROM notices n LEFT JOIN users u ON u.id = n.author_id LEFT JOIN profiles p ON p.user_id = n.author_id`;
  app.get('/notices', { preHandler: authenticate }, async () => {
    const { rows } = await pool.query(`${NOTICE_SELECT} WHERE NOT n.deleted ORDER BY n.pinned DESC, n.created_at DESC LIMIT 100`);
    return { notices: rows.map(noticeRow) };
  });
  const noticeInput = b => ({ title: String(b?.title || '').trim().slice(0, 100), body: String(b?.body || '').trim().slice(0, 5000), pinned: !!b?.pinned });
  app.post('/notices', { preHandler: requireAdmin }, async (req, reply) => {
    const n = noticeInput(req.body);
    if (!n.title || !n.body) return reply.code(400).send({ error: 'empty' });
    const { rows: [{ id }] } = await pool.query('INSERT INTO notices (author_id, title, body, pinned) VALUES ($1, $2, $3, $4) RETURNING id', [req.user.id, n.title, n.body, n.pinned]);
    const { rows: [row] } = await pool.query(`${NOTICE_SELECT} WHERE n.id = $1`, [id]);
    broadcast({ type: 'notice', action: 'new', notice: noticeRow(row) });
    return { notice: noticeRow(row) };
  });
  app.patch('/notices/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const n = noticeInput(req.body);
    if (!n.title || !n.body) return reply.code(400).send({ error: 'empty' });
    const r = await pool.query('UPDATE notices SET title = $1, body = $2, pinned = $3, updated_at = now() WHERE id = $4 AND NOT deleted', [n.title, n.body, n.pinned, Number(req.params.id)]);
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
    const { rows: [row] } = await pool.query(`${NOTICE_SELECT} WHERE n.id = $1`, [Number(req.params.id)]);
    broadcast({ type: 'notice', action: 'update', notice: noticeRow(row) });
    return { notice: noticeRow(row) };
  });
  app.delete('/notices/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await pool.query('UPDATE notices SET deleted = true WHERE id = $1 AND NOT deleted', [Number(req.params.id)]);
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
    broadcast({ type: 'notice', action: 'delete', id: Number(req.params.id) });
    return { ok: true };
  });

  registerRooms(app, { broadcast, sendTo, onlineIds });
}
