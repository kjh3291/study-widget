const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { resolveTarget } = require('../material-folders');
const { sharedFields } = require('../sync-fields');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-'));
const root = path.join(tmp, 'study'), desk = path.join(tmp, 'Studeck'), elsewhere = path.join(tmp, 'elsewhere');
const mk = (dir, readme) => { fs.mkdirSync(path.join(root, dir), { recursive: true }); if (readme) fs.writeFileSync(path.join(root, dir, 'README.md'), readme + '\n\n본문'); };
mk('data-structures', '# 데이터구조 — 공부 정리');
mk('computer-networks', '# 컴퓨터네트워크');
mk('.hidden', '# 데이터구조');
const safe = (s) => s.trim();

// nothing set → Desktop/Studeck default layout (unchanged for GitHub sync users)
let t = resolveTarget({}, '데이터 구조', 'material', desk, safe);
assert.deepEqual([t.custom, t.how, t.dir], [false, 'default', path.join(desk, '데이터 구조', '수업자료')]);
assert.equal(resolveTarget({}, 'X', 'assign', desk, safe).dir, path.join(desk, 'X', '과제'));

// one location for everything: README title match (spacing ignored), otherwise a course-named folder
const all = { materialsRoot: root, materialsSubdirs: { material: 'materials', assign: 'assignments' } };
t = resolveTarget(all, '데이터 구조', 'material', desk, safe);
assert.deepEqual([t.custom, t.how, t.dir], [true, 'readme', path.join(root, 'data-structures', 'materials')]);
assert.equal(resolveTarget(all, '컴퓨터네트워크', 'assign', desk, safe).dir, path.join(root, 'computer-networks', 'assignments'));
t = resolveTarget(all, '선형대수학', 'material', desk, safe);
assert.deepEqual([t.how, t.courseDir], ['root', path.join(root, '선형대수학')]);

// per-course location: absolute path anywhere, or a name inside the root; wins over README
const per = { ...all, materialsFolders: { '선형대수학': 'linear-algebra', '데이터구조': elsewhere } };
assert.equal(resolveTarget(per, '선형대수학', 'material', desk, safe).dir, path.join(root, 'linear-algebra', 'materials'));
t = resolveTarget(per, '데이터 구조', 'assign', desk, safe);
assert.deepEqual([t.how, t.dir], ['course', path.join(elsewhere, 'assignments')]);
// per-course only, no global root
t = resolveTarget({ materialsFolders: { '창업탐색': elsewhere } }, '창업탐색', 'material', desk, safe);
assert.deepEqual([t.custom, t.dir], [true, path.join(elsewhere, '수업자료')]);
assert.equal(resolveTarget({ materialsFolders: { '창업탐색': elsewhere } }, '다른과목', 'material', desk, safe).custom, false);

for (const key of ['materialsRoot', 'materialsFolders', 'materialsSubdirs']) assert.equal(sharedFields.includes(key), false, key + ' is device-only');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS: materials go to the default, one chosen folder, or a per-course folder; settings stay on this device');
