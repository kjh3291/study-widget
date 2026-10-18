// 집중(열품타식 공부 타이머) 서버 부분
//  - 공부 날짜는 한국 시간 새벽 5시 기준(새벽 2시 공부는 전날로 셈). 주는 월요일 시작.
//  - 실시간: 앱이 웹소켓으로 {type:'focus', state:'running'|'paused'|'stopped', subject, elapsed}를 보내면
//    메모리에 들고 있다가 "공부 시간 공개"를 켠 사람만 다른 회원에게 알린다(과목 이름만, 할 일 이름은 안 보냄).
//  - 랭킹: 동기화된 집중 기록(items kind=setting id=focus)의 세션 합 + 지금 재는 중인 시간.
//    공개한 사람만 순위에 오르고, 나는 비공개여도 내 순위·시간을 따로 받는다. 스터디방 랭킹은 그 방 멤버만.
import { pool } from './db.js';
import { authenticate } from './auth.js';

export const DAY_START_HOUR = 5;
const KST = 9 * 3600 * 1000;
export const studyDay = (t = Date.now()) => new Date(t + KST - DAY_START_HOUR * 3600 * 1000).toISOString().slice(0, 10);
export function weekStart(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// userId → { state, subject, elapsed, at, day }
const live = new Map();
const liveSeconds = l => Math.floor((l.elapsed || 0) + (l.state === 'running' ? (Date.now() - l.at) / 1000 : 0));

const isPublic = async uid => !!(await pool.query('SELECT show_study FROM profiles WHERE user_id = $1', [uid])).rows[0]?.show_study;
const liveRow = (uid, l) => ({ userId: uid, state: l.state, subject: l.subject, seconds: liveSeconds(l) });

export function createFocus({ broadcast }) {
  async function setFocus(uid, msg) {
    const state = ['running', 'paused', 'stopped'].includes(msg.state) ? msg.state : null;
    if (!state) return;
    if (state === 'stopped') return clearFocus(uid);
    const elapsed = Math.max(0, Math.min(24 * 3600, Number(msg.elapsed) || 0));
    const l = { state, subject: String(msg.subject || '').trim().slice(0, 30) || null, elapsed, at: Date.now(), day: studyDay() };
    live.set(uid, l);
    if (await isPublic(uid)) broadcast({ type: 'focus', ...liveRow(uid, l) });
  }
  async function clearFocus(uid) {
    if (!live.delete(uid)) return;
    if (await isPublic(uid)) broadcast({ type: 'focus', userId: uid, state: 'stopped', subject: null, seconds: 0 });
  }
  return { setFocus, clearFocus };
}

// 기간 [from, to] 동안 회원별 공부 초
async function totals(from, to, onlyIds) {
  const { rows } = await pool.query(`SELECT u.id, u.display_name, p.nickname, p.avatar_sha, coalesce(p.show_study, false) AS public, i.data
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN items i ON i.user_id = u.id AND i.kind = 'setting' AND i.id = 'focus' AND NOT i.deleted
    WHERE u.status = 'approved'${onlyIds ? ' AND u.id = ANY($1)' : ''}`, onlyIds ? [onlyIds] : []);
  const today = studyDay();
  return rows.map(r => {
    const sessions = r.data?.v?.sessions || [];
    let seconds = sessions.filter(s => s.date >= from && s.date <= to)
      .reduce((a, s) => a + (Number(s.seconds) || (Number(s.minutes) || 0) * 60), 0);
    const l = live.get(r.id);
    if (l && l.day >= from && l.day <= to && today >= from && today <= to) seconds += liveSeconds(l);
    return { userId: r.id, name: r.nickname || r.display_name, avatar: r.avatar_sha || null, public: r.public, seconds: Math.floor(seconds),
      studying: l?.state === 'running' };
  });
}

export function registerFocus(app) {
  // 지금 공부 중(공개한 사람 + 나)
  app.get('/focus/live', { preHandler: authenticate }, async req => {
    const ids = [...live.keys()];
    if (!ids.length) return { day: studyDay(), live: [] };
    const all = await totals(studyDay(), studyDay(), ids);
    const out = all.filter(m => m.public || m.userId === req.user.id).map(m => ({ ...m, ...liveRow(m.userId, live.get(m.userId)), todaySeconds: m.seconds }));
    return { day: studyDay(), live: out.sort((a, b) => b.todaySeconds - a.todaySeconds) };
  });

  // 랭킹: ?period=today|week&room=<스터디방 id>
  app.get('/focus/ranking', { preHandler: authenticate }, async (req, reply) => {
    const day = studyDay(), period = req.query.period === 'week' ? 'week' : 'today';
    const from = period === 'week' ? weekStart(day) : day, to = period === 'week' ? addDays(from, 6) : day;
    let ids = null;
    if (req.query.room) {
      const roomId = Number(req.query.room);
      const { rows } = await pool.query(`SELECT rm.user_id FROM room_members rm JOIN rooms r ON r.id = rm.room_id
        WHERE rm.room_id = $1 AND r.status = 'active' AND EXISTS (SELECT 1 FROM room_members x WHERE x.room_id = $1 AND x.user_id = $2)`, [roomId, req.user.id]);
      if (!rows.length) return reply.code(404).send({ error: 'not_found' });
      ids = rows.map(r => r.user_id);
    }
    const all = (await totals(from, to, ids)).sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
    const board = all.filter(m => m.public);
    let rank = 0, prev = -1;
    const ranking = board.map((m, i) => { if (m.seconds !== prev) { rank = i + 1; prev = m.seconds; } return { rank, ...m, me: m.userId === req.user.id }; });
    const mine = all.find(m => m.userId === req.user.id);
    const me = mine && { seconds: mine.seconds, public: mine.public, rank: mine.public ? ranking.find(r => r.me).rank : board.filter(m => m.seconds > mine.seconds).length + 1 };
    return { period, from, to, dayStartHour: DAY_START_HOUR, ranking: ranking.map(({ public: _p, ...r }) => r), me, total: all.length };
  });
}
