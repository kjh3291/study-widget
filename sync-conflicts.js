const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mergeShared } = require('./sync-model');
const { atomicJSON } = require('./sync-storage');
const { fingerprint } = require('./sync-service');
const SHARED = '.studeck/config.json';
const run = async (dir, args) => (await promisify(execFile)('git', args, { cwd: dir, windowsHide: true, encoding: 'buffer', maxBuffer: 100 * 1024 * 1024, timeout: 30000 })).stdout;
function safePath(dir, name) {
  const absolute = path.resolve(dir, name);
  if (!absolute.startsWith(path.resolve(dir) + path.sep) || name.split(/[\\/]/).includes('.git')) throw new Error('안전하지 않은 충돌 경로입니다.');
  let current = absolute;
  while (current !== path.resolve(dir)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('바로가기 파일의 충돌은 폴더에서 해결해 주세요.');
    current = path.dirname(current);
  }
  return absolute;
}
async function inspect(dir) {
  const raw = await run(dir, ['ls-files', '-u', '-z']);
  if (!raw.length) return null;
  const files = new Map();
  for (const entry of raw.toString('utf8').split('\0').filter(Boolean)) {
    const [meta, ...parts] = entry.split('\t'), name = parts.join('\t');
    const [mode, sha, stage] = meta.split(' ');
    if (!['100644', '100755'].includes(mode)) throw new Error('이 파일 형식의 충돌은 폴더에서 해결해 주세요: ' + name);
    if (!files.has(name)) files.set(name, { name, stages: {} });
    files.get(name).stages[stage] = { sha, mode, content: await run(dir, ['cat-file', 'blob', sha]) };
  }
  const entries = [...files.values()];
  const token = fingerprint([raw.toString('hex'), entries.map(f => {
    const target = safePath(dir, f.name);
    return [f.name, fs.existsSync(target) ? fingerprint(fs.readFileSync(target).toString('hex')) : null];
  })]);
  return { token, entries };
}
function mergedConfig(file, choices = {}) {
  const parse = stage => file.stages[stage] ? JSON.parse(file.stages[stage].content.toString('utf8')) : {};
  const local = parse(2), remote = parse(3);
  return mergeShared(parse(1), local, remote, choices);
}
const fieldId = (file, field) => JSON.stringify([file, field]);
async function describeConflicts(dir) {
  const info = await inspect(dir);
  if (!info) return null;
  const items = [];
  for (const file of info.entries) {
    if (file.name === SHARED) {
      for (const field of mergedConfig(file).conflicts) items.push({ ...field, id: fieldId(file.name, field.id), file: file.name });
    } else items.push({ id: file.name, file: file.name, binary: true, both: !!(file.stages[2] && file.stages[3]),
      local: { exists: !!file.stages[2], value: file.stages[2] ? file.stages[2].content.length + ' 바이트' : null },
      remote: { exists: !!file.stages[3], value: file.stages[3] ? file.stages[3].content.length + ' 바이트' : null } });
  }
  return { kind: 'files', token: info.token, items };
}
async function finishMerge(dir) {
  if (!(await run(dir, ['ls-files', '-u'])).length) await run(dir, ['commit', '--no-edit']);
}
async function autoResolve(dir) {
  const info = await inspect(dir);
  if (!info) return;
  for (const file of info.entries) {
    const target = safePath(dir, file.name);
    if (file.name === SHARED) {
      const merged = mergedConfig(file);
      if (merged.conflicts.length) continue;
      atomicJSON(target, { ...merged.data, _syncedAt: Date.now() }, path.join(dir, '.studeck/backups/writes'));
    } else if (file.name === '.gitignore') {
      const rules = [...new Set([2, 3].flatMap(s => file.stages[s]?.content.toString('utf8').split(/\r?\n/).filter(Boolean) || []))];
      if (rules.some(r => !['.studeck-migrated', '.studeck/backups/', '.DS_Store'].includes(r))) continue;
      fs.writeFileSync(target, rules.join('\n') + '\n');
    } else continue;
    await run(dir, ['add', '--', file.name]);
  }
  await finishMerge(dir);
}
async function resolveConflicts(dir, resolution) {
  const info = await inspect(dir);
  if (!info || info.token !== resolution.token) throw new Error('비교 중 파일이 바뀌었습니다. 다시 동기화한 뒤 선택해 주세요.');
  const plans = [];
  for (const file of info.entries) {
    const target = safePath(dir, file.name);
    if (file.name === SHARED) {
      const choices = Object.fromEntries(mergedConfig(file).conflicts.map(f => [f.id, resolution.choices?.[fieldId(file.name, f.id)]]));
      const merged = mergedConfig(file, choices);
      if (merged.conflicts.length) throw new Error('모든 충돌에서 사용할 값을 선택해 주세요.');
      plans.push({ file, target, content: Buffer.from(JSON.stringify({ ...merged.data, _syncedAt: Date.now() }, null, 2) + '\n') });
    } else {
      const choice = resolution.choices?.[file.name];
      if (!['local', 'remote', 'both'].includes(choice) || (choice === 'both' && !(file.stages[2] && file.stages[3]))) throw new Error('모든 파일에서 사용할 버전을 선택해 주세요.');
      const selected = file.stages[choice === 'remote' ? 3 : 2];
      const extra = choice === 'both' ? target.slice(0, target.length - path.extname(target).length) + ' (GitHub 사본 ' + info.token.slice(0, 8) + ')' + path.extname(target) : null;
      if (extra && fs.existsSync(extra)) throw new Error('보존할 사본 이름이 이미 있습니다. 폴더에서 이름을 바꿔 주세요.');
      plans.push({ file, target, content: selected?.content, mode: selected?.mode, extra });
    }
  }
  // Back up every original blob before applying any selection. Backups never enter Git.
  const backup = path.join(dir, '.studeck/backups/conflicts', info.token);
  fs.mkdirSync(backup, { recursive: true });
  for (const { file, target } of plans) {
    for (const stage of Object.values(file.stages)) fs.writeFileSync(path.join(backup, stage.sha), stage.content);
    if (fs.existsSync(target)) fs.copyFileSync(target, path.join(backup, fingerprint(file.name) + '-working'));
  }
  atomicJSON(path.join(backup, 'manifest.json'), info.entries.map(f => ({ name: f.name, stages: Object.fromEntries(Object.entries(f.stages).map(([k, s]) => [k, s.sha])) })));
  for (const plan of plans) {
    if (plan.content) { fs.mkdirSync(path.dirname(plan.target), { recursive: true }); fs.writeFileSync(plan.target, plan.content); if (process.platform !== 'win32' && plan.mode) fs.chmodSync(plan.target, plan.mode === '100755' ? 0o755 : 0o644); }
    else fs.rmSync(plan.target, { force: true });
    if (plan.extra) fs.writeFileSync(plan.extra, plan.file.stages[3].content);
    await run(dir, ['add', '--', plan.file.name, ...(plan.extra ? [path.relative(dir, plan.extra)] : [])]);
  }
  await finishMerge(dir);
}
module.exports = { autoResolve, describeConflicts, resolveConflicts };
