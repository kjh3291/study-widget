const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const TRASH = '삭제한 파일';
const { isLocalMaterial } = require('./local-materials');
const git = async (dir, args) => (await promisify(execFile)('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 20 * 1024 * 1024 })).stdout;
function userFile(relative) {
  return !['.git', '.studeck', '.gitignore', '.DS_Store', '.studeck-migrated', TRASH].includes(relative.split('/')[0]);
}
function safePath(dir, relative) {
  const parts = relative.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.includes('\\')) || path.isAbsolute(relative)) throw new Error('삭제 보관 경로가 올바르지 않습니다.');
  let current = path.resolve(dir);
  for (const part of parts) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('삭제 보관 경로에 바로가기가 있어 동기화를 중단했습니다.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return current;
}
// Copy before Git removes a file. Failure stops the merge; repeat attempts reuse the same copy.
function preserveDeleted(dir, relative, bytes) {
  if (!userFile(relative)) return;
  let target = safePath(dir, TRASH + '/' + relative);
  if (fs.existsSync(target)) {
    if (fs.statSync(target).isFile() && fs.readFileSync(target).equals(bytes)) return target;
    const parsed = path.posix.parse(relative), hash = createHash('sha256').update(bytes).digest('hex');
    target = safePath(dir, TRASH + '/' + path.posix.join(parsed.dir, parsed.name + ' (삭제-' + hash + ')' + parsed.ext));
    if (fs.existsSync(target)) {
      if (fs.statSync(target).isFile() && fs.readFileSync(target).equals(bytes)) return target;
      throw new Error('삭제 보관 파일명이 겹쳐 동기화를 중단했습니다.');
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fd = fs.openSync(target, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  catch (error) { fs.closeSync(fd); fs.unlinkSync(target); throw error; }
  fs.closeSync(fd);
  return target;
}
async function preserveIncomingDeletions(dir, incomingRef = 'FETCH_HEAD') {
  let base;
  try { base = (await git(dir, ['merge-base', 'HEAD', incomingRef])).trim(); }
  catch (error) { if (error.code === 1) return; throw error; } // Independent repositories have no deletions relative to each other.
  const deleted = (await git(dir, ['diff', '--no-renames', '--name-only', '--diff-filter=D', '-z', base, incomingRef])).split('\0').filter(Boolean).filter(userFile).filter(relative => !isLocalMaterial(relative));
  for (const relative of deleted) {
    const source = safePath(dir, relative);
    if (!fs.existsSync(source)) continue;
    if (!fs.statSync(source).isFile()) throw new Error('삭제 대상이 일반 파일이 아니어서 동기화를 중단했습니다.');
    preserveDeleted(dir, relative, fs.readFileSync(source));
  }
}
// A missing file with Git history was deliberately removed/renamed. LMS polling
// must not recreate it; restoring a copy to its original location is explicit.
async function wasDeletedFile(dir, filename) {
  const relative = path.relative(dir, filename).split(path.sep).join('/');
  safePath(dir, relative);
  if (fs.existsSync(filename) || !fs.existsSync(path.join(dir, '.git'))) return false;
  try { await git(dir, ['rev-parse', '--verify', 'HEAD']); }
  catch (error) { if (error.code === 128) return false; throw error; }
  return !!(await git(dir, ['log', '-1', '--format=%H', '--', ':(literal)' + relative])).trim();
}
module.exports = { preserveDeleted, preserveIncomingDeletions, wasDeletedFile, TRASH };
