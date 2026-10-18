// 실험실 서버 동기화 저장소. sync-service의 transport/read/write 자리에 GitHub 대신 들어간다.
// 공유 스냅샷을 항목 단위(할 일·일정·시간표 과목 1개 = 서버 1행)로 바꿔 주고받고,
// 서버 내용의 거울(mirror)을 userData에 보관해 오프라인에서도 마지막 서버 상태를 안다.
const fs = require('fs');
const path = require('path');
const { atomicJSON } = require('./sync-storage');
const { sharedFields } = require('./sync-fields');

// 배열 필드 → 서버 kind. 원소를 1행씩 저장한다(키가 겹치면 통째로 setting 1행으로 저장).
const ARRAYS = { todos: 'todo', events: 'event', timetableFull: 'course' };
const SEP = '\u0000';
const key = (kind, id) => kind + SEP + id;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const elementId = (field, x) => {
  if (!x || typeof x !== 'object') return null;
  if (typeof x.id === 'string' && x.id) return x.id;
  if (field === 'timetableFull' && typeof x.name === 'string' && x.name.trim()) return 'name:' + x.name.normalize('NFC');
  return null;
};

// 스냅샷 → { 'kind\0id': data } (data는 서버에 저장될 JSON)
function toItems(snapshot) {
  const items = {};
  for (const field of sharedFields) {
    const value = snapshot[field];
    if (value === undefined) continue;
    const kind = ARRAYS[field];
    if (kind && Array.isArray(value)) {
      const ids = value.map(x => elementId(field, x));
      if (ids.every(Boolean) && new Set(ids).size === ids.length) {
        value.forEach((x, i) => { items[key(kind, ids[i])] = { o: i, v: x }; });
        // 빈 목록도 "비어 있음"으로 전달되도록 존재 표시를 둔다(마지막 항목 삭제 전파).
        items[key('setting', '@' + field)] = { v: true };
        continue;
      }
    }
    items[key('setting', field)] = { v: value };
  }
  return items;
}

// { 'kind\0id': data } → 스냅샷
function fromItems(items) {
  const snapshot = {}, lists = {};
  for (const [k, data] of Object.entries(items)) {
    const [kind, id] = k.split(SEP);
    if (kind === 'setting') { if (sharedFields.includes(id)) snapshot[id] = data.v; continue; }
    (lists[kind] = lists[kind] || []).push(data);
  }
  for (const [field, kind] of Object.entries(ARRAYS)) {
    if (snapshot[field] !== undefined || (!lists[kind] && !items[key('setting', '@' + field)])) continue;
    snapshot[field] = (lists[kind] || []).sort((a, b) => (a.o ?? 0) - (b.o ?? 0)).map(d => d.v);
  }
  return snapshot;
}

function createServerStore({ file, fetchImpl = fetch, now = Date.now }) {
  const empty = owner => ({ owner, cursor: 0, items: {}, outbox: [] });
  let mirror = null;
  const load = () => {
    if (!mirror) { try { mirror = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { mirror = empty(''); } }
    return mirror;
  };
  const persist = () => atomicJSON(file, mirror);
  const live = () => Object.fromEntries(Object.entries(load().items).filter(([, it]) => !it.deleted).map(([k, it]) => [k, it.data]));

  async function request(conn, method, url, body) {
    const res = await fetchImpl(conn.url.replace(/\/+$/, '') + url, {
      method,
      headers: { authorization: 'Bearer ' + conn.token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('서버 로그인이 만료됐습니다. 다시 로그인해 주세요.');
    if (res.status === 403) throw new Error({ not_approved: '운영진 승인 대기 중입니다.', suspended: '정지된 계정입니다. 서버 권한이 없습니다.', deleted: '삭제된 계정입니다. 서버 권한이 없습니다.' }[json.error] || '서버 권한이 없습니다.');
    if (!res.ok) throw new Error('서버 오류(' + res.status + '): ' + (json.error || json.message || ''));
    return json;
  }

  function apply(changes) {
    const m = load();
    for (const c of changes) m.items[key(c.kind, c.id)] = { data: c.deleted ? null : c.data, updatedAt: c.updatedAt, deleted: !!c.deleted };
  }

  // 미전송 변경을 올리고(있으면) 서버 변경분을 끝까지 받아 거울을 갱신한다.
  async function transport(conn) {
    try {
      const owner = conn.url + '|' + conn.username;
      if (load().owner !== owner) { mirror = empty(owner); persist(); }
      let page;
      if (mirror.outbox.length) {
        page = await request(conn, 'POST', '/sync', { since: mirror.cursor, changes: mirror.outbox });
        mirror.outbox = [];
      } else {
        page = await request(conn, 'GET', '/sync?since=' + mirror.cursor);
      }
      for (;;) {
        apply(page.changes);
        mirror.cursor = page.cursor;
        if (!page.more) break;
        page = await request(conn, 'GET', '/sync?since=' + mirror.cursor);
      }
      persist();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.name === 'TimeoutError' ? '서버 응답이 없습니다(Tailscale 연결 확인).' : error.message };
    }
  }

  const read = () => fromItems(live());

  // 병합된 스냅샷을 거울과 비교해 바뀐 항목만 outbox에 넣는다(다음 transport에서 전송).
  function write(snapshot) {
    const m = load(), want = toItems(snapshot), have = live(), t = now();
    const out = new Map(m.outbox.map(c => [key(c.kind, c.id), c]));
    for (const [k, data] of Object.entries(want)) {
      if (equal(have[k], data)) continue;
      const [kind, id] = k.split(SEP);
      out.set(k, { kind, id, data, updatedAt: t });
      m.items[k] = { data, updatedAt: t, deleted: false };
    }
    for (const k of Object.keys(have)) {
      if (want[k] !== undefined) continue;
      const [kind, id] = k.split(SEP);
      out.set(k, { kind, id, updatedAt: t, deleted: true });
      m.items[k] = { data: null, updatedAt: t, deleted: true };
    }
    m.outbox = [...out.values()];
    persist();
  }

  // 이 기기가 이 서버·계정과 처음 맞추는지(거울이 없거나 다른 계정 것)
  const isFresh = conn => load().owner !== conn.url + '|' + conn.username || !load().cursor;
  return { transport, read, write, isFresh, reset: () => { mirror = empty(''); persist(); } };
}

// 로그인 전 단계(가입·로그인·로그아웃)는 토큰 없이 직접 호출한다.
async function serverCall(url, method, pathname, body, token, fetchImpl = fetch) {
  const res = await fetchImpl(url.replace(/\/+$/, '') + pathname, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

module.exports = { createServerStore, serverCall, toItems, fromItems };
