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
const end = source.indexOf("const SYNC_DATA_PATH", start);
const { archiveGitChanges } = require('../material-history');
const context = { readShared: require('../sync-storage').readShared, autoResolve: require('../sync-conflicts').autoResolve, archiveGitChanges, fs, path, process, console, execFile: (bin, args, opts, cb) => {
  // Redirect only the remote URL to the isolated bare repository.
  const prefix = args[0] === '-c' ? args.slice(0, 2) : [];
  args = args.slice(prefix.length);
  if (args[0] === 'remote' && ['add', 'set-url'].includes(args[1])) args = [...args.slice(0, 3), path.join(root, 'remote.git')];
  execFile(bin, [...prefix, ...args], opts, cb);
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
  const { describeConflicts, resolveConflicts } = require('../sync-conflicts');
  const info = await describeConflicts(local);
  assert.equal(info.items[0].file, 'supplement.txt');
  // Editing a working file while the dialog is open invalidates its choice.
  fs.appendFileSync(path.join(local, 'supplement.txt'), '\nnew edit');
  await assert.rejects(resolveConflicts(local, { ...info, choices: { 'supplement.txt': 'both' } }), /바뀌었습니다/);
  const current = await describeConflicts(local);
  await resolveConflicts(local, { ...current, choices: { 'supplement.txt': 'both' } });
  assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, true);
  assert.equal((await context.gitSync(other, 'owner/data', 'fake')).ok, true);
  const extra = fs.readdirSync(other).find(f => f.startsWith('supplement (GitHub'));
  assert.equal(fs.readFileSync(path.join(other, extra), 'utf8'), 'remote edit');
  assert.equal(fs.readFileSync(path.join(other, 'supplement.txt'), 'utf8'), 'local edit');
  assert.equal(command(local, 'ls-files', '.studeck/backups').trim(), '');
  // Legacy clients can still edit the JSON file directly. Merge by stable task IDs.
  const writeConfig = (dir, data) => { fs.mkdirSync(path.join(dir, '.studeck'), { recursive: true }); fs.writeFileSync(path.join(dir, '.studeck/config.json'), JSON.stringify(data, null, 2)); };
  const base = { todos: [{ id: 'a', text: 'first', done: false }, { id: 'b', text: 'second', done: false }] };
  writeConfig(local, base); assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, true);
  assert.equal((await context.gitSync(other, 'owner/data', 'fake')).ok, true);
  writeConfig(other, { todos: [{ ...base.todos[0], text: 'Windows title' }, base.todos[1]] });
  assert.equal((await context.gitSync(other, 'owner/data', 'fake')).ok, true);
  writeConfig(local, { todos: [{ ...base.todos[0], text: 'Mac title' }, { ...base.todos[1], done: true }] });
  assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, false);
  const settings = await describeConflicts(local);
  assert.equal(settings.items.length, 1);
  await resolveConflicts(local, { ...settings, choices: { [settings.items[0].id]: 'remote' } });
  assert.equal((await context.gitSync(local, 'owner/data', 'fake')).ok, true);
  assert.equal((await context.gitSync(other, 'owner/data', 'fake')).ok, true);
  const final = JSON.parse(fs.readFileSync(path.join(other, '.studeck/config.json')));
  assert.equal(final.todos[0].text, 'Windows title'); assert.equal(final.todos[1].done, true);
  // Full new-client path: durable config -> Git -> second device's config.
  const { createSyncService } = require('../sync-service');
  const { atomicJSON, readShared } = require('../sync-storage');
  const { trackChanges } = require('../sync-model');
  function client(dir, profile) {
    const configPath = path.join(root, profile + '.json'), sharedPath = path.join(dir, '.studeck/config.json');
    atomicJSON(configPath, { ...readShared(sharedPath), pendingShared: {}, sync: { enabled: true, repo: 'owner/data', token: 'fake' } });
    const load = () => JSON.parse(fs.readFileSync(configPath)), save = data => atomicJSON(configPath, data);
    const service = createSyncService({ load, save, read: () => readShared(sharedPath),
      write: data => atomicJSON(sharedPath, data, path.join(dir, '.studeck/backups/writes')),
      transport: () => context.gitSync(dir, 'owner/data', 'fake'),
      conflicts: () => describeConflicts(dir), resolveFiles: choice => resolveConflicts(dir, choice),
      dirty: async () => !!command(dir, 'status', '--porcelain').trim(),
    });
    return { service, load, edit: patch => save(trackChanges(load(), patch)) };
  }
  const macClient = client(local, 'mac-profile'), winClient = client(other, 'win-profile');
  macClient.edit({ todos: macClient.load().todos.map(t => t.id === 'a' ? { ...t, text: 'Mac independent' } : t), theme: 'gray' });
  winClient.edit({ todos: winClient.load().todos.map(t => t.id === 'b' ? { ...t, text: 'Windows independent' } : t) });
  assert.equal((await macClient.service.run()).ok, true);
  assert.equal((await winClient.service.run()).ok, true);
  assert.equal((await macClient.service.run()).ok, true);
  assert.deepEqual(macClient.load().todos, winClient.load().todos);
  assert.equal(macClient.load().todos[0].text, 'Mac independent');
  assert.equal(macClient.load().todos[1].text, 'Windows independent');
  assert.equal(winClient.load().theme, 'gray');
  macClient.edit({ theme: 'dark' }); winClient.edit({ theme: 'light' });
  assert.equal((await macClient.service.run()).ok, true);
  const conflictResult = await winClient.service.run();
  assert.equal(conflictResult.conflicts.kind, 'settings');
  const remoteBeforeChoice = command(remote, 'rev-parse', 'main');
  assert.equal((await winClient.service.run()).ok, false);
  assert.equal(command(remote, 'rev-parse', 'main'), remoteBeforeChoice);
  assert.equal((await winClient.service.run({ ...conflictResult.conflicts, choices: { [conflictResult.conflicts.items[0].id]: 'local' } })).ok, true);
  assert.equal((await macClient.service.run()).ok, true);
  assert.equal(macClient.load().theme, 'light');
  const publicShared = readShared(path.join(local, '.studeck/config.json'));
  assert.equal(publicShared.pendingShared, undefined); assert.equal(publicShared.sync, undefined);
  console.log('PASS: full two-client config sharing, simultaneous task edits, explicit setting conflict and retry without loss');
  console.log('PASS: two-way files, same-name binary versions, conflicts block push, stale choices rejected, both versions shared, JSON field resolution preserves independent edits');
})().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
