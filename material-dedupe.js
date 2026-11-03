// 수업자료 중복 저장 막기: 받은 파일과 내용이 똑같은 파일이 과목 폴더 안 어딘가에 이미 있으면 그 파일을 쓴다.
// (같은 파일을 교수님이 다른 항목으로 또 올린 경우, 사용자가 과목 폴더 안에서 옮기거나 이름을 바꾼 경우)
// 화면과 상관없는 순수 파일 함수라 node 테스트(scripts/test-input-downloads.js)에서 그대로 쓴다.
const fs = require('node:fs'), path = require('node:path');

// 찾지 않는 폴더: 숨김 폴더(.studeck 등)와 교수님 수정 전 판을 모아 두는 '이전 자료'
const SKIP_DIR = (name) => name.startsWith('.') || name.normalize('NFC') === '이전 자료';

// dir 아래(하위 폴더 포함)에서 body와 바이트가 같은 파일 경로를 찾는다. 크기가 같은 파일만 해시를 비교한다.
function findSameFile(dir, body, sha1, opts = {}) {
  const maxFiles = opts.maxFiles || 3000, maxDepth = opts.maxDepth == null ? 4 : opts.maxDepth;
  if (!body || !fs.existsSync(dir)) return null;
  const size = body.length;
  const skipTop = new Set((opts.skipTop || []).map((n) => n.normalize('NFC')));   // 과목 폴더 바로 아래에서 건너뛸 폴더
  let sig = null, seen = 0;
  const walk = (d, depth) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return null; }
    entries.sort((a, b) => a.name.localeCompare(b.name));   // 여러 개면 늘 같은 파일을 고르도록
    for (const e of entries) {
      if (++seen > maxFiles) return null;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIR(e.name) && !(depth === 0 && skipTop.has(e.name.normalize('NFC')))) { const r = walk(p, depth + 1); if (r) return r; }
        continue;
      }
      if (!e.isFile()) continue;
      let st; try { st = fs.statSync(p); } catch (err) { continue; }
      if (st.size !== size) continue;
      if (!sig) sig = sha1(body);
      try { if (sha1(fs.readFileSync(p)) === sig) return p; } catch (err) {}
    }
    return null;
  };
  return walk(dir, 0);
}

// dir 안에서 filename이 비어 있지 않거나 avoid(소문자 절대경로 Set)에 있으면 ' (2)', ' (3)'…을 붙인 경로
function freePath(dir, filename, avoid) {
  const taken = (p) => fs.existsSync(p) || (avoid && avoid.has(path.resolve(p).toLowerCase()));
  const first = path.join(dir, filename);
  if (!taken(first)) return first;
  const ext = path.extname(filename), base = path.basename(filename, ext);
  for (let i = 2; ; i++) { const c = path.join(dir, `${base} (${i})${ext}`); if (!taken(c)) return c; }
}

module.exports = { findSameFile, freePath };
