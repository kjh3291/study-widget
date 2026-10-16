// 보조자료·과제 파일을 서버 개인 공간과 맞춘다(실험실 앱).
// 마지막으로 맞춘 상태(base)와 비교해 바뀐 쪽만 전송한다. 양쪽이 모두 바뀌면 둘 다 서버에 올려
// 나중 수정이 현재 파일이 되고 다른 쪽은 서버의 "이전 버전"으로 남는다(선택 창 없음).
// 서버에서 지워진 파일은 이 기기의 휴지통(Windows 휴지통/macOS 휴지통)으로 옮긴다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicJSON } = require('./sync-storage');

const SYNCED = new Set(['보조자료', '과제']);            // 과목/<분류>/... 중 서버에 올리는 분류
const SKIP_DIRS = new Set(['.gradle', 'build', 'node_modules', '.idea', '.git', '.studeck', '__pycache__']);
const SKIP_FILES = /^(\.DS_Store|Thumbs\.db|desktop\.ini|~\$.*|.*\.tmp|.*\.crdownload)$/i;
const VIDEO = /\.(mp4|mov|avi|mkv|webm|wmv|m4v)$/i;

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 서버에 올릴 로컬 파일 목록: { '과목/보조자료/a.pdf': { abs, size, mtimeMs } } + 건너뛴 파일
function scanLocal(root, fileMax) {
  const files = {}, skipped = [];
  if (!fs.existsSync(root)) return { files, skipped };
  for (const course of fs.readdirSync(root, { withFileTypes: true })) {
    if (!course.isDirectory() || course.name.startsWith('.') || course.name === '삭제한 파일') continue;
    for (const cat of SYNCED) {
      const base = path.join(root, course.name, cat);
      if (!fs.existsSync(base)) continue;
      const walk = (dir, rel) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, e.name), key = (rel + '/' + e.name).normalize('NFC');
          if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs, key); continue; }
          if (!e.isFile() || SKIP_FILES.test(e.name)) continue;
          const st = fs.statSync(abs);
          if (VIDEO.test(e.name)) { skipped.push({ path: key, reason: '동영상' }); continue; }
          if (st.size > fileMax) { skipped.push({ path: key, reason: '50MB 초과' }); continue; }
          files[key] = { abs, size: st.size, mtimeMs: Math.trunc(st.mtimeMs) };
        }
      };
      walk(base, (course.name + '/' + cat).normalize('NFC'));
    }
  }
  return { files, skipped };
}

function createFileSync({ root, stateFile, trash, fetchImpl = fetch, now = Date.now, fileMax = 50 * 1024 * 1024 }) {
  const empty = owner => ({ owner, cursor: 0, remote: {}, base: {} });
  const load = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return empty(''); } };

  async function api(conn, method, url, body, raw) {
    const res = await fetchImpl(conn.url.replace(/\/+$/, '') + url, {
      method, body,
      headers: { authorization: 'Bearer ' + conn.token, ...(body ? { 'content-type': 'application/octet-stream' } : {}) },
      signal: AbortSignal.timeout(120000),
    });
    if (res.status === 401) throw new Error('서버 로그인이 만료됐습니다. 다시 로그인해 주세요.');
    if (res.status === 413) { const j = await res.json().catch(() => ({})); throw Object.assign(new Error(j.error === 'quota' ? '서버 저장 공간(2GB)이 가득 찼습니다.' : '파일이 너무 큽니다(50MB 초과).'), { code: j.error || 'too_large' }); }
    if (!res.ok) throw new Error('파일 서버 오류(' + res.status + ')');
    return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
  }
  const q = p => '?path=' + encodeURIComponent(p);

  async function run(conn) {
    const stats = { uploaded: 0, downloaded: 0, removedRemote: 0, trashedLocal: 0, kept: 0, skipped: [], quotaFull: false };
    const dir = root();
    let st = load();
    const owner = conn.url + '|' + conn.username;
    if (st.owner !== owner) st = empty(owner);
    const save = () => atomicJSON(stateFile, st);
    try {
      // 1. 서버 변경분 받기
      for (;;) {
        const page = await api(conn, 'GET', '/files?since=' + st.cursor);
        for (const f of page.files) st.remote[f.path] = { sha: f.sha256, size: f.size, updatedAt: f.updatedAt, deleted: f.deleted };
        st.cursor = page.cursor;
        if (!page.more) break;
      }
      save();
      // 2. 이 기기 파일 훑기(크기·시각이 같으면 지난번 해시 재사용)
      const { files: local, skipped } = scanLocal(dir, fileMax);
      stats.skipped = skipped;
      for (const [p, f] of Object.entries(local)) {
        const b = st.base[p];
        f.sha = b && b.size === f.size && b.mtimeMs === f.mtimeMs ? b.sha : sha256File(f.abs);
      }
      const absOf = p => path.join(dir, ...p.split('/'));
      const remoteSha = p => (st.remote[p] && !st.remote[p].deleted ? st.remote[p].sha : null);
      const record = (p, sha) => {
        if (!sha) { delete st.base[p]; return; }
        const s = fs.statSync(absOf(p));
        st.base[p] = { sha, size: s.size, mtimeMs: Math.trunc(s.mtimeMs) };
      };
      const upload = async (p, f) => {
        const r = await api(conn, 'PUT', '/files/content' + q(p) + '&updatedAt=' + f.mtimeMs, fs.readFileSync(f.abs));
        st.remote[p] = { sha: r.file.sha256, size: r.file.size, updatedAt: r.file.updatedAt, deleted: r.file.deleted };
        if (r.result === 'stored') stats.uploaded++;
        return r;
      };
      const download = async p => {
        const buf = await api(conn, 'GET', '/files/content' + q(p), undefined, true);
        const abs = absOf(p), tmp = abs + '.studeck-download';
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(tmp, buf); fs.renameSync(tmp, abs);
        const t = new Date(st.remote[p].updatedAt); fs.utimesSync(abs, t, t);
        stats.downloaded++;
        record(p, st.remote[p].sha);
      };
      // 3. 파일별 판단
      const all = new Set([...Object.keys(local), ...Object.keys(st.remote), ...Object.keys(st.base)]);
      for (const p of all) {
        try {
          const L = local[p], baseSha = st.base[p]?.sha || null, rSha = remoteSha(p), lSha = L?.sha || null;
          const localChanged = lSha !== baseSha, remoteChanged = rSha !== baseSha;
          if (lSha && lSha === rSha) { record(p, lSha); continue; }        // 이미 같음
          if (!localChanged && !remoteChanged) continue;
          if (localChanged && !remoteChanged) {
            if (L) { const r = await upload(p, L); if (r.file.sha256 === lSha && !r.file.deleted) record(p, lSha); }
            else if (rSha) {                                                // 이 기기에서 지움 → 서버 휴지통
              await api(conn, 'DELETE', '/files' + q(p) + '&updatedAt=' + now());
              st.remote[p] = { ...st.remote[p], deleted: true }; stats.removedRemote++; record(p, null);
            } else record(p, null);
            continue;
          }
          if (!localChanged && remoteChanged) {
            if (rSha) await download(p);
            else if (L) { await trash(L.abs); stats.trashedLocal++; record(p, null); }   // 서버에서 지워짐
            else record(p, null);
            continue;
          }
          // 양쪽 모두 바뀜: 이 기기 것도 올려 서버가 시각으로 정한다(진 쪽은 이전 버전으로 남음)
          if (L) {
            const r = await upload(p, L);
            if (r.file.deleted || r.file.sha256 !== lSha) {
              stats.kept++;
              if (r.file.deleted) { await trash(L.abs); stats.trashedLocal++; record(p, null); } else await download(p);
            } else record(p, lSha);
          } else if (rSha) await download(p);                                // 이 기기 삭제 vs 서버 수정 → 수정 유지
          else record(p, null);
        } catch (e) {
          if (e.code === 'quota') { stats.quotaFull = true; stats.skipped.push({ path: p, reason: '저장 공간 부족' }); continue; }
          if (e.code === 'too_large') { stats.skipped.push({ path: p, reason: '50MB 초과' }); continue; }
          throw e;
        }
      }
      save();
      return { ok: true, ...stats };
    } catch (error) {
      save();
      return { ok: false, error: error.name === 'TimeoutError' ? '파일 서버 응답이 없습니다.' : error.message, ...stats };
    }
  }

  return { run, reset: () => atomicJSON(stateFile, empty('')), remoteFiles: () => load().remote };
}

module.exports = { createFileSync, scanLocal };
