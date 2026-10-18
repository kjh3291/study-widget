// 채팅방(카톡형): 내가 참여한 방 목록(전체방 고정 + 최근 메시지순), 방별 안 읽은 수·읽음, 메시지.
// 정책(2026-10-18 결정):
//  - 전체방(kind=all): 승인된 회원은 자동 참여, 나갈 수 없음
//  - 친목방(social): 누구나 바로 생성. 스터디(study)·이벤트(event): 생성 후 운영진 승인(pending → active)
//  - 공개(public): 누구나 찾아서 참여 / 비공개(private): 방장(또는 운영진)이 초대한 사람만
//  - 메시지·읽음·실시간 알림은 그 방 멤버에게만
import { pool } from './db.js';
import { authenticate, requireAdmin } from './auth.js';

const KINDS = new Set(['social', 'study', 'event']);
const NEEDS_APPROVAL = new Set(['study', 'event']);
const MSG_MAX = 4000;
const isAdmin = u => ['admin', 'owner'].includes(u.role);

export async function ensureAllRoom(uid) {
  await pool.query(`INSERT INTO room_members (room_id, user_id) SELECT id, $1 FROM rooms WHERE kind = 'all' ON CONFLICT DO NOTHING`, [uid]);
}

const memberName = r => r.nickname || r.display_name;
export const messageRow = r => ({ id: Number(r.id), roomId: r.room_id, userId: r.user_id, author: r.user_id ? memberName(r) : '(탈퇴한 회원)',
  avatar: r.avatar_sha || null, body: r.deleted ? '' : r.body, image: r.deleted ? null : r.image, createdAt: r.created_at, editedAt: r.edited_at, deleted: r.deleted });
const MSG_SELECT = `SELECT m.*, u.display_name, p.nickname, p.avatar_sha FROM messages m
  LEFT JOIN users u ON u.id = m.user_id LEFT JOIN profiles p ON p.user_id = m.user_id`;

// 방 한 개(나 기준): 인원·마지막 메시지·안 읽은 수·내 역할
const ROOM_SELECT = `SELECT r.*, rm.role AS my_role, rm.last_read_id,
    (SELECT count(*) FROM room_members x JOIN users xu ON xu.id = x.user_id AND xu.status = 'approved' WHERE x.room_id = r.id)::int AS member_count,
    (SELECT count(*) FROM messages m WHERE m.room_id = r.id AND m.id > rm.last_read_id AND m.user_id IS DISTINCT FROM rm.user_id AND NOT m.deleted)::int AS unread,
    lm.id AS lm_id, lm.body AS lm_body, lm.image AS lm_image, lm.created_at AS lm_at, lm.deleted AS lm_deleted, lu.display_name AS lm_name, lp.nickname AS lm_nick
  FROM rooms r JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $1
  LEFT JOIN LATERAL (SELECT * FROM messages m WHERE m.room_id = r.id ORDER BY m.id DESC LIMIT 1) lm ON true
  LEFT JOIN users lu ON lu.id = lm.user_id LEFT JOIN profiles lp ON lp.user_id = lm.user_id`;
const roomRow = r => ({
  id: r.id, name: r.name, topic: r.topic, kind: r.kind, visibility: r.visibility, status: r.status, pinned: r.kind === 'all',
  myRole: r.my_role, memberCount: r.member_count, unread: r.unread, lastReadId: Number(r.last_read_id || 0),
  lastMessage: r.lm_id ? { id: Number(r.lm_id), author: r.lm_nick || r.lm_name || '(탈퇴한 회원)', body: r.lm_deleted ? '' : r.lm_body, hasImage: !!r.lm_image && !r.lm_deleted, deleted: r.lm_deleted, createdAt: r.lm_at } : null,
  createdAt: r.created_at,
});
const sortRooms = rooms => rooms.sort((a, b) => (b.pinned - a.pinned) ||
  (new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt)));

async function myRoom(uid, roomId) {
  const { rows: [r] } = await pool.query(`${ROOM_SELECT} WHERE r.id = $2`, [uid, roomId]);
  return r ? roomRow(r) : null;
}
const memberIds = async roomId => (await pool.query('SELECT user_id FROM room_members WHERE room_id = $1', [roomId])).rows.map(r => r.user_id);
const adminIds = async () => (await pool.query(`SELECT id FROM users WHERE role IN ('admin', 'owner') AND status = 'approved'`)).rows.map(r => r.id);

export function registerRooms(app, { sendTo }) {
  // 내가 참여한 방(승인 대기인 내 방 포함)
  app.get('/rooms', { preHandler: authenticate }, async req => {
    await ensureAllRoom(req.user.id);
    const { rows } = await pool.query(`${ROOM_SELECT} WHERE r.status IN ('active', 'pending')`, [req.user.id]);
    return { rooms: sortRooms(rows.map(roomRow)) };
  });

  // 참여할 수 있는 공개방(아직 안 들어간 것)
  app.get('/rooms/discover', { preHandler: authenticate }, async req => {
    const { rows } = await pool.query(`SELECT r.*, (SELECT count(*) FROM room_members x JOIN users xu ON xu.id = x.user_id AND xu.status = 'approved' WHERE x.room_id = r.id)::int AS member_count,
        (SELECT max(created_at) FROM messages m WHERE m.room_id = r.id) AS last_at
      FROM rooms r WHERE r.status = 'active' AND r.visibility = 'public' AND r.kind <> 'all'
        AND NOT EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = $1)
      ORDER BY last_at DESC NULLS LAST, r.id DESC`, [req.user.id]);
    return { rooms: rows.map(r => ({ id: r.id, name: r.name, topic: r.topic, kind: r.kind, memberCount: r.member_count, lastActiveAt: r.last_at || r.created_at })) };
  });

  // 방 만들기: 친목은 바로, 스터디·이벤트는 운영진 승인 대기
  app.post('/rooms', { preHandler: authenticate }, async (req, reply) => {
    const name = String(req.body?.name || '').trim().slice(0, 30), topic = String(req.body?.topic || '').trim().slice(0, 100);
    const kind = String(req.body?.kind || 'social'), visibility = req.body?.visibility === 'private' ? 'private' : 'public';
    if (!name) return reply.code(400).send({ error: 'empty' });
    if (!KINDS.has(kind)) return reply.code(400).send({ error: 'bad_kind' });
    const status = NEEDS_APPROVAL.has(kind) ? 'pending' : 'active';
    const { rows: [r] } = await pool.query(`INSERT INTO rooms (name, topic, kind, visibility, status, owner_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
      [name, topic, kind, visibility, status, req.user.id]);
    await pool.query(`INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'owner')`, [r.id, req.user.id]);
    const room = await myRoom(req.user.id, r.id);
    if (status === 'pending') sendTo(await adminIds(), { type: 'room', action: 'pending', roomId: r.id });
    return { room };
  });

  app.post('/rooms/:id/join', { preHandler: authenticate }, async (req, reply) => {
    const id = Number(req.params.id);
    const { rows: [r] } = await pool.query(`SELECT * FROM rooms WHERE id = $1 AND status = 'active' AND visibility = 'public' AND kind <> 'all'`, [id]);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    await pool.query('INSERT INTO room_members (room_id, user_id, last_read_id) VALUES ($1, $2, (SELECT coalesce(max(id), 0) FROM messages WHERE room_id = $1)) ON CONFLICT DO NOTHING', [id, req.user.id]);
    sendTo(await memberIds(id), { type: 'room', action: 'members', roomId: id });
    return { room: await myRoom(req.user.id, id) };
  });

  // 나가기: 전체방은 불가. 방장이 나가면 가장 먼저 들어온 사람이 방장, 아무도 없으면 보관
  app.post('/rooms/:id/leave', { preHandler: authenticate }, async (req, reply) => {
    const id = Number(req.params.id);
    const { rows: [m] } = await pool.query(`SELECT rm.role, r.kind FROM room_members rm JOIN rooms r ON r.id = rm.room_id WHERE rm.room_id = $1 AND rm.user_id = $2`, [id, req.user.id]);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    if (m.kind === 'all') return reply.code(400).send({ error: 'cannot_leave_all' });
    await pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [id, req.user.id]);
    if (m.role === 'owner') {
      const { rows: [next] } = await pool.query('SELECT user_id FROM room_members WHERE room_id = $1 ORDER BY joined_at LIMIT 1', [id]);
      if (next) { await pool.query(`UPDATE room_members SET role = 'owner' WHERE room_id = $1 AND user_id = $2`, [id, next.user_id]); await pool.query('UPDATE rooms SET owner_id = $1 WHERE id = $2', [next.user_id, id]); }
      else await pool.query(`UPDATE rooms SET status = 'archived', archived = true WHERE id = $1`, [id]);
    }
    sendTo(await memberIds(id), { type: 'room', action: 'members', roomId: id });
    return { ok: true };
  });

  // 초대: 방장(또는 운영진)이 승인된 회원을 바로 참여시킨다(비공개방 참여 방법)
  app.post('/rooms/:id/invite', { preHandler: authenticate }, async (req, reply) => {
    const id = Number(req.params.id), ids = (req.body?.userIds || []).map(Number).filter(Boolean).slice(0, 50);
    const { rows: [r] } = await pool.query(`SELECT r.*, rm.role FROM rooms r LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $2 WHERE r.id = $1 AND r.status = 'active' AND r.kind <> 'all'`, [id, req.user.id]);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.role !== 'owner' && !isAdmin(req.user)) return reply.code(403).send({ error: 'owner_only' });
    const { rows } = await pool.query(`INSERT INTO room_members (room_id, user_id, last_read_id)
      SELECT $1, u.id, (SELECT coalesce(max(id), 0) FROM messages WHERE room_id = $1) FROM users u WHERE u.id = ANY($2) AND u.status = 'approved'
      ON CONFLICT DO NOTHING RETURNING user_id`, [id, ids]);
    const added = rows.map(x => x.user_id);
    sendTo(added, { type: 'room', action: 'invited', roomId: id });
    sendTo(await memberIds(id), { type: 'room', action: 'members', roomId: id });
    return { added: added.length };
  });

  app.get('/rooms/:id/members', { preHandler: authenticate }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!(await myRoom(req.user.id, id))) return reply.code(404).send({ error: 'not_found' });
    const { rows } = await pool.query(`SELECT u.id, u.display_name, p.nickname, p.avatar_sha, rm.role FROM room_members rm
      JOIN users u ON u.id = rm.user_id LEFT JOIN profiles p ON p.user_id = u.id WHERE rm.room_id = $1 ORDER BY rm.role DESC, u.display_name`, [id]);
    return { members: rows.map(r => ({ id: r.id, name: r.nickname || r.display_name, avatar: r.avatar_sha || null, role: r.role })) };
  });

  // 방 정보 수정·보관: 방장 또는 운영진
  app.delete('/rooms/:id', { preHandler: authenticate }, async (req, reply) => {
    const id = Number(req.params.id);
    const { rows: [r] } = await pool.query(`SELECT r.kind, rm.role FROM rooms r LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $2 WHERE r.id = $1 AND NOT r.archived`, [id, req.user.id]);
    if (!r || r.kind === 'all') return reply.code(404).send({ error: 'not_found' });
    if (r.role !== 'owner' && !isAdmin(req.user)) return reply.code(403).send({ error: 'owner_only' });
    const ids = await memberIds(id);
    await pool.query(`UPDATE rooms SET status = 'archived', archived = true WHERE id = $1`, [id]);
    sendTo(ids, { type: 'room', action: 'archive', roomId: id });
    return { ok: true };
  });

  // 읽음: 실제로 본 마지막 메시지까지(뒤로 가지 않음)
  app.post('/rooms/:id/read', { preHandler: authenticate }, async (req, reply) => {
    const id = Number(req.params.id), last = Number(req.body?.lastId) || 0;
    const r = await pool.query(`UPDATE room_members SET last_read_id = GREATEST(last_read_id, LEAST($3, (SELECT coalesce(max(id), 0) FROM messages WHERE room_id = $1)))
      WHERE room_id = $1 AND user_id = $2`, [id, req.user.id, last]);
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // 메시지: 그 방 멤버만(승인 대기 방은 방장끼리만 미리 대화 가능)
  async function memberOf(req, reply) {
    const { rows: [m] } = await pool.query(`SELECT r.status FROM room_members rm JOIN rooms r ON r.id = rm.room_id
      WHERE rm.room_id = $1 AND rm.user_id = $2 AND r.status IN ('active', 'pending')`, [Number(req.params.id), req.user.id]);
    if (!m) { reply.code(404).send({ error: 'not_found' }); return false; }
    return true;
  }
  app.get('/rooms/:id/messages', { preHandler: authenticate }, async (req, reply) => {
    if (!(await memberOf(req, reply))) return;
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER, limit = Math.min(100, Number(req.query.limit) || 50);
    const { rows } = await pool.query(`${MSG_SELECT} WHERE m.room_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT $3`, [Number(req.params.id), before, limit]);
    return { messages: rows.reverse().map(messageRow) };
  });
  const sendHits = new Map();
  const tooFast = uid => { const now = Date.now(), l = (sendHits.get(uid) || []).filter(t => now - t < 10000); l.push(now); sendHits.set(uid, l); return l.length > 20; };
  app.post('/rooms/:id/messages', { preHandler: authenticate }, async (req, reply) => {
    if (!(await memberOf(req, reply))) return;
    if (tooFast(req.user.id)) return reply.code(429).send({ error: 'too_many' });
    const roomId = Number(req.params.id), body = String(req.body?.body || '').trim().slice(0, MSG_MAX);
    let image = null;
    if (req.body?.image) {
      const sha = req.body.image.sha;
      const m = /^[0-9a-f]{64}$/.test(sha || '') && (await pool.query('SELECT mime, size FROM media WHERE sha256 = $1', [sha])).rows[0];
      if (!m) return reply.code(400).send({ error: 'bad_image' });
      image = { sha, mime: m.mime, size: Number(m.size), width: Number(req.body.image.width) || null, height: Number(req.body.image.height) || null };
    }
    if (!body && !image) return reply.code(400).send({ error: 'empty' });
    const { rows: [{ id }] } = await pool.query('INSERT INTO messages (room_id, user_id, body, image) VALUES ($1, $2, $3, $4) RETURNING id', [roomId, req.user.id, body, image]);
    await pool.query('UPDATE rooms SET last_message_at = now() WHERE id = $1', [roomId]);
    await pool.query('UPDATE room_members SET last_read_id = $3 WHERE room_id = $1 AND user_id = $2', [roomId, req.user.id, id]); // 내가 보낸 건 읽은 것
    const { rows: [row] } = await pool.query(`${MSG_SELECT} WHERE m.id = $1`, [id]);
    const message = messageRow(row);
    sendTo(await memberIds(roomId), { type: 'message', action: 'new', message });
    return { message };
  });
  // 메시지 삭제: 본인 또는 운영진
  app.delete('/messages/:id', { preHandler: authenticate }, async (req, reply) => {
    const admin = isAdmin(req.user);
    const { rows: [m] } = await pool.query(`UPDATE messages SET deleted = true WHERE id = $1 AND NOT deleted AND (user_id = $2 OR $3) RETURNING room_id`,
      [Number(req.params.id), req.user.id, admin]);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    sendTo(await memberIds(m.room_id), { type: 'message', action: 'delete', id: Number(req.params.id), roomId: m.room_id });
    if (admin) req.log.info({ admin: req.user.username, action: 'delete-message', id: Number(req.params.id) }, 'admin action');
    return { ok: true };
  });

  // ---------- 운영진: 스터디·이벤트 방 승인 ----------
  app.get('/admin/rooms', { preHandler: requireAdmin }, async () => {
    const { rows } = await pool.query(`SELECT r.*, u.display_name AS owner_name FROM rooms r LEFT JOIN users u ON u.id = r.owner_id WHERE r.status = 'pending' ORDER BY r.created_at`);
    return { rooms: rows.map(r => ({ id: r.id, name: r.name, topic: r.topic, kind: r.kind, visibility: r.visibility, owner: r.owner_name, createdAt: r.created_at })) };
  });
  for (const [action, status] of [['approve', 'active'], ['reject', 'rejected']]) {
    app.post(`/admin/rooms/:id/${action}`, { preHandler: requireAdmin }, async (req, reply) => {
      const { rows: [r] } = await pool.query(`UPDATE rooms SET status = $1, archived = $2 WHERE id = $3 AND status = 'pending' RETURNING id, owner_id`,
        [status, status === 'rejected', Number(req.params.id)]);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      sendTo(await memberIds(r.id), { type: 'room', action, roomId: r.id });
      req.log.info({ admin: req.user.username, action: 'room-' + action, room: r.id }, 'admin action');
      return { ok: true };
    });
  }
}
