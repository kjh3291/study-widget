// LMS course materials are per-device caches, not shared Git data.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = async (dir, args, extraEnv = {}) => (await promisify(execFile)('git', ['-c', 'core.precomposeunicode=false', ...args], { cwd: dir, env: { ...process.env, ...extraEnv }, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024 })).stdout;
function isLocalMaterial(relative) {
  const parts = relative.split('/');
  return parts.length >= 3 && parts[1].normalize('NFC') === '수업자료';
}
async function removeFromIndex(dir, names, env) {
  for (let i = 0; i < names.length; i += 100) await run(dir, ['update-index', '--force-remove', '--', ...names.slice(i, i + 100)], env);
}
async function untrackLocalMaterials(dir) {
  const names = (await run(dir, ['ls-files', '-z'])).split('\0').filter(isLocalMaterial);
  // Index only: never remove or replace the device's actual files.
  await removeFromIndex(dir, [...new Set(names)]);
}
async function filterIncomingMaterials(dir) {
  const names = (await run(dir, ['ls-tree', '-r', '--name-only', '-z', 'FETCH_HEAD'])).split('\0').filter(isLocalMaterial);
  if (!names.length) return 'FETCH_HEAD';
  const parent = (await run(dir, ['rev-parse', 'FETCH_HEAD'])).trim();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-material-index-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(temporary, 'index') };
    await run(dir, ['read-tree', parent], env);
    await removeFromIndex(dir, names, env);
    const tree = (await run(dir, ['write-tree'], env)).trim();
    const commit = (await run(dir, ['commit-tree', tree, '-p', parent, '-m', 'Keep LMS course materials local to each device'])).trim();
    // Merge a descendant of the fetched commit, so shared data/history is retained
    // and legacy clients cannot overwrite the local LMS cache during checkout.
    return commit;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { isLocalMaterial, untrackLocalMaterials, filterIncomingMaterials };
