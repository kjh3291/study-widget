const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const renderer = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
let keydown, added = 0;
vm.runInNewContext(renderer.split('\n').find(line => line.startsWith("$('td-text').addEventListener('keydown'")), {
  $: () => ({ addEventListener: (_, fn) => { keydown = fn; } }), addTodo: () => added++,
});
const enter = { key: 'Enter', preventDefault() {} };
keydown({ ...enter, isComposing: true });
keydown({ ...enter, keyCode: 229 });
keydown({ ...enter, repeat: true });
assert.equal(added, 0);
keydown(enter);
assert.equal(added, 1);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-download-test-'));
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const names = {}; vm.createContext(names);
vm.runInContext(source.slice(source.indexOf('function safeName('), source.indexOf('function parseCdFilename(')), names);
assert.equal(names.safeName('팀.pdf'.normalize('NFD')), '팀.pdf');
let body = Buffer.from('first submission');
const hash = b => crypto.createHash('sha1').update(b).digest('hex');
const { preserveMaterial } = require('../material-history');
const context = { wasDeletedFile: require('../deleted-files').wasDeletedFile, preserveMaterial, ...require('../material-dedupe'), fs, path, STUDECK_DIR: () => root, safeName: s => s, sha1: hash, fetchMaterialBytes: async () => ({ body, filename: 'assignment.pdf' }) };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('async function downloadMaterial('), source.indexOf("ipcMain.handle('lms-download'")), context);
(async () => {
  const first = await context.downloadMaterial('url1', 'Course', '', { kind: 'assign', mode: 'new' });
  assert.equal(first.ok, true);
  const old = body;
  body = Buffer.from('revised submission');
  const revised = await context.downloadMaterial('url2', 'Course', '', { kind: 'assign', mode: 'new' });
  assert.equal(revised.changed, true);
  assert.equal(fs.readFileSync(revised.path, 'utf8'), body.toString());
  assert.equal(fs.readFileSync(path.join(root, '.studeck/backups/submissions/Course', hash(old) + '-assignment.pdf'), 'utf8'), old.toString());
  const same = await context.downloadMaterial('url2', 'Course', '', { kind: 'assign', mode: 'recheck', dest: revised.path, prevSig: 'stale' });
  assert.equal(same.changed, false);
  const material = await context.downloadMaterial('material', 'Course', '', { mode: 'new' });
  const previousMaterial = Buffer.from(body);
  body = Buffer.from('updated lecture material');
  const updatedMaterial = await context.downloadMaterial('material', 'Course', '', { mode: 'recheck', dest: material.path });
  assert.equal(updatedMaterial.changed, true);
  const historyDir = path.join(path.dirname(material.path), '이전 자료');
  assert.equal(fs.readdirSync(historyDir).length, 1);
  assert.deepEqual(fs.readFileSync(path.join(historyDir, fs.readdirSync(historyDir)[0])), previousMaterial);
  assert.deepEqual(fs.readFileSync(material.path), body);
  fs.unlinkSync(material.path);
  const deletedMaterial = await context.downloadMaterial('material', 'Course', '', { mode: 'recheck', dest: material.path });
  assert.equal(deletedMaterial.ok, true);
  assert.equal(fs.existsSync(material.path), true);
  let checked = 0;
  const downloadContext = { state: { matCourses: {} }, Date, cleanCourse: s => s, window: { api: { lmsDownload: async items => { checked = items.length; return []; } } } };
  vm.createContext(downloadContext);
  vm.runInContext(renderer.slice(renderer.indexOf('async function syncDownloads('), renderer.indexOf('async function downloadNewMaterials(')), downloadContext);
  await downloadContext.syncDownloads([{ url: 'url2', courseName: 'Course' }], { url2: { path: revised.path, checkedAt: Date.now() } }, 'assign', false);
  assert.equal(checked, 1);
  downloadContext.state.syncEnabled = true; downloadContext.state.syncReady = false; checked = 0;
  await downloadContext.syncDownloads([{ url: 'url2', courseName: 'Course' }], {}, 'assign', false);
  assert.equal(checked, 0);
  await downloadContext.syncDownloads([{ url: 'material', courseName: 'Course' }], { material: { path: material.path, checkedAt: Date.now() } }, 'material', true);
  assert.equal(checked, 1, 'LMS materials must download even when Git sync fails');
  // 같은 이름 수업자료 두 개(다른 LMS 항목): 두 번째는 ' (2)'로 따로 저장 → 번갈아 덮어쓰며 '바뀜'으로 다시 받지 않음
  body = Buffer.from('lecture A');
  const a1 = await context.downloadMaterial('matA', 'Course', '', { mode: 'new' });
  body = Buffer.from('lecture B');
  const b1 = await context.downloadMaterial('matB', 'Course', '', { mode: 'new', avoid: [a1.path] });
  assert.notEqual(b1.path, a1.path); assert.ok(path.basename(b1.path).endsWith(' (2).pdf'), b1.path);
  assert.equal(fs.readFileSync(a1.path, 'utf8'), 'lecture A');
  let sent = [];
  downloadContext.window.api.lmsDownload = async items => { sent = items; return []; };
  await downloadContext.syncDownloads([{ url: 'matA', courseName: 'Course' }, { url: 'matB', courseName: 'Course' }],
    { matA: { path: a1.path, at: 1, checkedAt: 0 }, matB: { path: a1.path, at: 2, checkedAt: 0 } }, 'material', true);
  const sa = sent.find(i => i.url === 'matA'), sb = sent.find(i => i.url === 'matB');
  assert.equal(sa.mode, 'recheck', '먼저 받은 항목이 원래 경로를 가짐');
  assert.equal(sb.mode, 'new'); assert.equal(JSON.stringify(sb.avoid.map(p => p.toLowerCase())), JSON.stringify([a1.path.toLowerCase()]), '겹친 항목은 새 이름으로 다시');
  // 중복 저장 방지 1: 교수님이 똑같은 파일을 다른 항목으로 또 올림(이름은 같고 내용도 같음) → ' (2)' 사본을 만들지 않고 A의 파일을 같이 씀
  body = Buffer.from('lecture A');
  const dup = await context.downloadMaterial('matC', 'Course', '', { mode: 'new', avoid: [a1.path, b1.path] });
  assert.equal(dup.path, a1.path, '같은 내용이면 기존 파일을 가리킴'); assert.equal(dup.same, true); assert.equal(dup.existed, true);
  const matDir = path.dirname(a1.path), countFiles = () => fs.readdirSync(matDir).filter(n => fs.statSync(path.join(matDir, n)).isFile()).length;
  const before = countFiles();
  // 같이 쓰는 기록(same)은 다음 새로고침에도 새로 받지 않고 확인만, 그때 내용이 같으면 그대로
  await downloadContext.syncDownloads([{ url: 'matA', courseName: 'Course' }, { url: 'matC', courseName: 'Course' }],
    { matA: { path: a1.path, at: 1, checkedAt: 0 }, matC: { path: a1.path, at: 3, checkedAt: 0, same: true } }, 'material', true);
  const sc = sent.find(i => i.url === 'matC');
  assert.equal(sc.mode, 'recheck', '같이 쓰는 기록은 새로 받지 않음'); assert.equal(sc.shared, true);
  const again = await context.downloadMaterial('matC', 'Course', '', { mode: 'recheck', dest: a1.path, shared: true, avoid: [a1.path] });
  assert.equal(again.changed, false); assert.equal(again.same, true); assert.equal(countFiles(), before, '파일이 늘지 않음');
  // 같이 쓰던 항목만 내용이 바뀌면 A의 파일을 덮어쓰지 않고 따로 저장
  body = Buffer.from('lecture C revised');
  const split = await context.downloadMaterial('matC', 'Course', '', { mode: 'recheck', dest: a1.path, shared: true, avoid: [a1.path, b1.path] });
  assert.notEqual(split.path, a1.path); assert.equal(split.changed, true); assert.ok(!split.same);
  assert.equal(fs.readFileSync(a1.path, 'utf8'), 'lecture A', 'A의 파일은 그대로');
  // 중복 저장 방지 2: 이름만 다르고 내용이 같은 파일이 과목 폴더 안(하위 폴더 포함)에 있으면 새로 쓰지 않음
  fs.mkdirSync(path.join(root, 'Course', '보조자료'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Course', '보조자료', '내가 정리한 이름.pdf'), 'week 5 slides');
  body = Buffer.from('week 5 slides');
  const kept = await context.downloadMaterial('matD', 'Course', '', { mode: 'new' });
  assert.equal(kept.path, path.join(root, 'Course', '보조자료', '내가 정리한 이름.pdf')); assert.equal(kept.same, false);
  assert.equal(fs.existsSync(path.join(matDir, 'assignment.pdf')) && fs.readFileSync(path.join(matDir, 'assignment.pdf'), 'utf8') === 'week 5 slides', false, '수업자료 폴더에 사본을 만들지 않음');
  // 중복 저장 방지 3: 받은 파일을 과목 폴더 안에서 옮기거나 이름을 바꾸면 그 위치를 따라가고 다시 받지 않음
  fs.renameSync(path.join(root, 'Course', '보조자료', '내가 정리한 이름.pdf'), path.join(root, 'Course', '5주차.pdf'));
  const moved = await context.downloadMaterial('matD', 'Course', '', { mode: 'recheck', dest: kept.path });
  assert.equal(moved.path, path.join(root, 'Course', '5주차.pdf')); assert.equal(moved.changed, false); assert.equal(fs.existsSync(kept.path), false);
  // 수업자료 폴더 밖에 있던 파일이 지워졌으면 그 자리에 되살리지 않고 수업자료 폴더에 받는다
  fs.unlinkSync(moved.path);
  const back = await context.downloadMaterial('matD', 'Course', '', { mode: 'recheck', dest: moved.path });
  assert.equal(fs.existsSync(moved.path), false); assert.equal(path.dirname(back.path), matDir);
  // '이전 자료'(교수님 수정 전 판)와 숨김 폴더는 같은 파일로 치지 않음
  const { findSameFile } = require('../material-dedupe');
  fs.mkdirSync(path.join(root, 'Only', '수업자료', '이전 자료'), { recursive: true }); fs.mkdirSync(path.join(root, 'Only', '.studeck'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Only', '수업자료', '이전 자료', 'old.pdf'), 'v1'); fs.writeFileSync(path.join(root, 'Only', '.studeck', 'x.pdf'), 'v1');
  assert.equal(findSameFile(path.join(root, 'Only'), Buffer.from('v1'), hash), null);
  console.log('PASS: IME Enter adds once; same-name resubmission replaces with backup; same-name lecture files from different LMS items saved separately; every refresh checks assignments');
  console.log('PASS: 수업자료 중복 저장 방지 — 같은 내용이면 사본을 만들지 않음, 같이 쓰는 파일은 덮어쓰지 않음, 과목 폴더 안에서 옮긴 파일은 따라감');
})().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch(e => { console.error(e); process.exitCode = 1; });
