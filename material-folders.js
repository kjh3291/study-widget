const fs = require('node:fs');
const path = require('node:path');

// 수업자료 저장 위치 (이 기기 config에만 있다 — sync-fields 밖)
//   materialsRoot     전체 위치. 그 안에 과목 폴더를 둔다
//   materialsFolders  { LMS 과목명: 경로 } 과목별 위치. 절대경로면 그대로, 상대경로면 전체 위치 기준
//   materialsSubdirs  { material, assign } 과목 폴더 안의 하위 폴더 이름
// 아무것도 정하지 않으면 바탕화면/Studeck/<과목>/수업자료·과제 (GitHub 동기화가 쓰는 기본 구조)
const DEFAULT_SUBDIRS = { material: '수업자료', aux: '보조자료', assign: '과제' };
const squashName = (s) => String(s || '').normalize('NFC').replace(/\s+/g, '');

// 전체 위치 안에서 README.md 첫 줄 제목이 과목명과 같은 폴더 (이미 정리해 둔 폴더를 그대로 쓰기 위해)
function findByReadme(root, course) {
  const want = squashName(course);
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')); } catch (e) { return ''; }
  for (const d of dirs) {
    try {
      const first = fs.readFileSync(path.join(root, d.name, 'README.md'), 'utf8').split(/\r?\n/)[0].replace(/^#+\s*/, '');
      if (squashName(first.split(/[—–-]/)[0]) === want) return d.name;
    } catch (e) { /* README 없음 */ }
  }
  return '';
}

function explicitFolder(folders, course) {
  const want = squashName(course);
  for (const [name, folder] of Object.entries(folders || {})) if (squashName(name) === want && folder) return folder;
  return '';
}

// → { custom, how, courseDir, dir }   how: 'default' | 'course' | 'readme' | 'root'
function resolveTarget(cfg, course, kind, defaultRoot, safeName) {
  const c = cfg || {};
  const explicit = explicitFolder(c.materialsFolders, course);
  const root = c.materialsRoot || '';
  let courseDir = '', how = '';
  if (explicit && path.isAbsolute(explicit)) { courseDir = explicit; how = 'course'; }
  else if (explicit && root) { courseDir = path.join(root, explicit); how = 'course'; }
  else if (root) {
    const found = findByReadme(root, course);
    courseDir = path.join(root, found || safeName(course));
    how = found ? 'readme' : 'root';
  }
  if (!courseDir) {
    courseDir = path.join(defaultRoot, safeName(course));
    return { custom: false, how: 'default', courseDir, dir: path.join(courseDir, DEFAULT_SUBDIRS[kind] || DEFAULT_SUBDIRS.material) };
  }
  const sub = { ...DEFAULT_SUBDIRS, ...(c.materialsSubdirs || {}) };
  const name = kind === 'assign' ? sub.assign : sub.material; // 사용자 위치에서는 보조자료도 수업자료 폴더에
  return { custom: true, how, courseDir, dir: path.join(courseDir, name) };
}

module.exports = { resolveTarget, findByReadme, squashName, DEFAULT_SUBDIRS };
