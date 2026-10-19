// 문의(오류 신고·개선 제안·기타): 회원이 보내고, 운영진(관리자)이 상태를 바꾸고 답장한다.
// 앱 버전·운영체제는 앱이 같이 보낸다. 사진 1장 첨부(공용 media). 1시간에 5건까지.
import { pool } from './db.js';
import { authenticate, requireAdmin } from './auth.js';
import { sendTo } from './community.js';

const CATEGORIES = new Set(['bug', 'idea', 'etc']);
const STATUSES = new Set(['new', 'checking', 'done']);
const BODY_MAX = 2000, REPLY_MAX = 2000;

const row = r => ({
  id: r.id, category: r.category, body: r.body, image: r.image_sha || null, appVersion: r.app_version, platform: r.platform,
  status: r.status, reply: r.reply, repliedAt: r.replied_at, createdAt: r.created_at, updatedAt: r.updated_at,
  user: r.username ? { id: r.user_id, username: r.username, name: r.display_name } : undefined,
  repliedBy: r.replier_name || undefined,
});
const adminIds = async () => (await pool.query(`SELECT id FROM users WHERE role IN ('admin', 'owner') AND status = 'approved'`)).rows.map(r => r.id);

const hits = new Map();
const tooMany = uid => { const now = Date.now(), l = (hits.get(uid) || []).filter(t => now - t < 3600e3); l.push(now); hits.set(uid, l); return l.length > 5; };

export function registerInquiries(app) {
  app.post('/inquiries', { preHandler: authenticate }, async (req, reply) => {
    const b = req.body || {};
    const category = CATEGORIES.has(b.category) ? b.category : 'etc';
    const body = String(b.body || '').trim().slice(0, BODY_MAX);
    if (body.length < 5) return reply.code(400).send({ error: 'too_short' });
    let image = null;
    if (b.image) {
      const ok = /^[0-9a-f]{64}$/.test(b.image) && (await pool.query('SELECT 1 FROM media WHERE sha256 = $1', [b.image])).rowCount;
      if (!ok) return reply.code(400).send({ error: 'bad_image' });
      image = b.image;
    }
    if (tooMany(req.user.id)) return reply.code(429).send({ error: 'too_many' });
    const { rows: [r] } = await pool.query(`INSERT INTO inquiries (user_id, category, body, image_sha, app_version, platform) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, category, body, image, String(b.appVersion || '').slice(0, 40), String(b.platform || '').slice(0, 120)]);
    sendTo(await adminIds(), { type: 'admin', what: 'inquiry' });
    return { inquiry: row(r) };
  });

  app.get('/me/inquiries', { preHandler: authenticate }, async req => {
    const { rows } = await pool.query('SELECT * FROM inquiries WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [req.user.id]);
    return { inquiries: rows.map(row) };
  });

  // 운영진: ?status=open(새·확인 중, 기본) | done | all
  app.get('/admin/inquiries', { preHandler: requireAdmin }, async req => {
    const s = String(req.query.status || 'open');
    const where = s === 'all' ? '' : s === 'done' ? `WHERE q.status = 'done'` : `WHERE q.status <> 'done'`;
    const { rows } = await pool.query(`SELECT q.*, u.username, u.display_name, ru.display_name AS replier_name FROM inquiries q
      JOIN users u ON u.id = q.user_id LEFT JOIN users ru ON ru.id = q.replied_by ${where} ORDER BY q.status = 'new' DESC, q.created_at DESC LIMIT 100`);
    const { rows: [c] } = await pool.query(`SELECT count(*) FILTER (WHERE status = 'new')::int AS new, count(*) FILTER (WHERE status = 'checking')::int AS checking FROM inquiries`);
    return { inquiries: rows.map(row), counts: c };
  });
  app.patch('/admin/inquiries/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id), b = req.body || {};
    const { rows: [cur] } = await pool.query('SELECT * FROM inquiries WHERE id = $1', [id]);
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    const status = STATUSES.has(b.status) ? b.status : cur.status;
    const newReply = b.reply === undefined ? cur.reply : String(b.reply).trim().slice(0, REPLY_MAX);
    const replied = newReply !== cur.reply;
    const { rows: [r] } = await pool.query(`UPDATE inquiries SET status = $2, reply = $3, updated_at = now()
      ${replied ? ', replied_by = $4, replied_at = now()' : ''} WHERE id = $1 RETURNING *`, replied ? [id, status, newReply, req.user.id] : [id, status, newReply]);
    if (replied && newReply) sendTo([cur.user_id], { type: 'account', what: 'inquiry-reply', id });
    else if (status !== cur.status) sendTo([cur.user_id], { type: 'account', what: 'inquiry-status', id, status });
    req.log.info({ admin: req.user.username, action: 'inquiry', id, status, replied }, 'admin action');
    return { inquiry: row(r) };
  });
}
