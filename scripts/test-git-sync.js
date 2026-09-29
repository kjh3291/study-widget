// Run the production sync functions against isolated local Git repositories.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFile, execFileSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-sync-test-'));
const command = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const start = source.indexOf('function git(args, cwd)');
const end = source.indexOf("ipcMain.handle('git-connect'", start);
const { archiveGitChanges } = require('../material-history');
const context = { archiveGitChanges, fs, path, process, console, execFile: (bin, args, opts, cb) => {
  // Redirect only the remote URL to the isolated bare repository.
  if (args[0] === 'remote' && ['add', 'set-url'].includes(args[1])) args = [...args.slice(0, 3), path.join(root, 'remote.git')];
  execFile(bin, args, opts, cb);
}};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
(async () => {
  const remote = path.join(root, 'remote.git'), local = path.join(root, 'mac'), other = path.join(root, 'windows');
  fs.mkdirSync(local); fs.mkdirSync(other);
  command(root, 'init', '--bare', remote);
  command(other, 'init', '-b', 'main');
  command(other, 'config', 'user.name', 'Test'); command(other, 'config', 'user.email', 'test@local');
  fs.writeFileSync(path.join(other, 'supplement.txt'), 'from Windows');
  fs.writeFileSync(path.join(other, '.gitignore'), '.studeck-migrated\n.studeck/backups/\n');
  command(other, 'add', '.'); command(other, 'commit', '-m', 'remote data');
  command(other, 'remote', 'add', 'origin', remote); command(other, 'push', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(local, 'local.txt'), 'from Mac');
  assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, true);
  assert.equal(fs.readFileSync(path.join(local, 'supplement.txt'), 'utf8'), 'from Windows');
  command(other, 'pull', '--no-rebase');
  assert.equal(fs.readFileSync(path.join(other, 'local.txt'), 'utf8'), 'from Mac');
  // Same-name supplementary binary edits use content, not just the filename.
  const supplement = path.join('테스트 과목', '보조자료', '같은 이름.pdf');
  fs.mkdirSync(path.dirname(path.join(other, supplement)), { recursive: true });
  const first = Buffer.from([0, 1, 2, 255]), updated = Buffer.from([0, 9, 8, 255]);
  fs.writeFileSync(path.join(other, supplement), first);
  assert.equal((await context.gitSync(other, 'owner/data', 'fake')).ok, true);
  assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(local, supplement)), first);
  fs.writeFileSync(path.join(other, supplement), updated);
  assert.equal((await context.gitSync(other, 'owner/data', 'fake')).ok, true);
  assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(local, supplement)), updated);
  const previousDir = path.join(local, '테스트 과목', '보조자료', '이전 자료');
  const versions = fs.readdirSync(previousDir);
  assert.equal(versions.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(previousDir, versions[0])), first);
  // Verify the reverse direction too, with the same filename and byte length.
  fs.writeFileSync(path.join(local, supplement), first);
  assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, true);
  assert.equal((await context.gitSync(other, 'owner/data', 'fake')).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(other, supplement)), first);
  const otherHistory = path.join(other, '테스트 과목', '보조자료', '이전 자료');
  assert.equal(fs.readdirSync(otherHistory).length, 2);
  assert.ok(fs.readdirSync(otherHistory).some(name => fs.readFileSync(path.join(otherHistory, name)).equals(updated)));
  // A conflicting edit must report failure and must not change remote HEAD.
  fs.writeFileSync(path.join(other, 'supplement.txt'), 'remote edit');
  command(other, 'commit', '-am', 'remote edit'); command(other, 'push');
  const head = command(remote, 'rev-parse', 'main');
  fs.writeFileSync(path.join(local, 'supplement.txt'), 'local edit');
  assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, false);
  assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, false);
  assert.equal(command(remote, 'rev-parse', 'main'), head);
  console.log('PASS: unrelated histories merge, two-way file sharing, same-name binary edits both directions, conflicts do not push');
})().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
