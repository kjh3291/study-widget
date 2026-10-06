const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const gitBytes = (dir, args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd: dir, encoding: 'buffer', windowsHide: true, timeout: 120000, maxBuffer: 128 * 1024 * 1024 }, (error, out) => error ? reject(new Error('이전 자료를 읽지 못해 동기화를 중단했습니다.')) : resolve(out));
});
function isMaterial(relative) {
  const parts = relative.split(/[\\/]/);
  return parts.length >= 3 && ['수업자료', '보조자료'].includes(parts[1].normalize('NFC')) && !parts.some(p => p.normalize('NFC') === '이전 자료') && !parts.includes('..');
}
function preserveMaterial(dir, relative, bytes) {
  if (!isMaterial(relative)) return;
  const parsed = path.parse(relative);
  // Content-based names let both devices archive the same revision without duplicates.
  const version = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const target = path.join(dir, parsed.dir, '이전 자료', parsed.name + ' (이전-' + version + ')' + parsed.ext);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    if (!fs.readFileSync(target).equals(bytes)) throw new Error('이전 자료 파일명이 겹쳐 동기화를 중단했습니다.');
  } else fs.writeFileSync(target, bytes, { flag: 'wx' });
  return target;
}
async function archiveGitChanges(dir, incoming = false, incomingRef = 'FETCH_HEAD') {
  // An empty repository has no previous version to retain.
  try { await gitBytes(dir, ['rev-parse', '--verify', 'HEAD']); } catch { return; }
  const args = ['diff', '--name-only', '--diff-filter=M', '-z', 'HEAD'];
  if (incoming) args.push(incomingRef);
  let changed = (await gitBytes(dir, args)).toString('utf8').split('\0').filter(isMaterial);
  if (incoming) {
    let base;
    try { base = (await gitBytes(dir, ['merge-base', 'HEAD', incomingRef])).toString('utf8').trim(); } catch { /* Independent initial histories. */ }
    if (base) {
      const remoteChanges = new Set((await gitBytes(dir, ['diff', '--name-only', '--diff-filter=M', '-z', base, incomingRef])).toString('utf8').split('\0'));
      changed = changed.filter(relative => remoteChanges.has(relative));
    }
  }
  for (const relative of changed) {
    const bytes = await gitBytes(dir, ['show', 'HEAD:' + relative]);
    preserveMaterial(dir, relative, bytes);
  }
}
module.exports = { isMaterial, preserveMaterial, archiveGitChanges };
