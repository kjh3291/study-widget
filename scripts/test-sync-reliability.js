const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { copy, trackChanges, reconcile, mergeShared, equal, initializeOutbox } = require('../sync-model');
const { atomicJSON, readShared } = require('../sync-storage');
const { createSyncService } = require('../sync-service');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-outbox-'));
const task = (id, text) => ({ id, text, done: false });
function fixture(initial, remote = {}) {
  const dir = fs.mkdtempSync(path.join(root, 'client-')), configPath = path.join(dir, 'local.json'), sharedPath = path.join(dir, 'shared.json');
  atomicJSON(configPath, { ...initial, sync: { enabled: true, repo: 'test/data', token: 'test-only' } });
  atomicJSON(sharedPath, remote);
  const f = { calls: 0, statuses: [], offline: false, failSave: false, pushed: null,
    load: () => JSON.parse(fs.readFileSync(configPath)),
    save: data => { if (f.failSave) throw new Error('disk full'); atomicJSON(configPath, data); },
    edit: patch => f.save(trackChanges(f.load(), patch)),
    read: () => readShared(sharedPath), write: data => atomicJSON(sharedPath, data),
    transport: async () => { f.calls++; if (f.during) await f.during(f.calls); if (f.offline) return { ok: false, error: 'offline' }; f.pushed = f.read(); return { ok: true }; },
    conflicts: async () => null, resolveFiles: async () => {}, dirty: async () => false,
    notify: status => f.statuses.push(copy(status)),
  };
  f.restart = () => { f.service = createSyncService(f); };
  f.restart(); return f;
}
(async () => {
  const upgraded = initializeOutbox({ todos: [task('old', 'unsent legacy')] }, {});
  assert.ok(upgraded.pendingShared.todos);
  assert.equal(reconcile(upgraded, { todos: [task('remote', 'existing')] }).data.todos.length, 2);
  const local = task('mac', 'offline addition'), remote = task('win', 'other device');
  const f = fixture({}, { todos: [remote], theme: 'light' });
  f.edit({ todos: [local] }); f.offline = true;
  assert.equal((await f.service.run()).ok, false);
  assert.ok(f.load().pendingShared.todos); f.restart(); f.offline = false;
  assert.equal((await f.service.run()).ok, true);
  assert.deepEqual(new Set(f.pushed.todos.map(x => x.id)), new Set(['mac', 'win']));
  assert.deepEqual(f.load().pendingShared, {}); assert.equal(f.load().theme, 'light');
  console.log('PASS: offline first-connection edits survive restart and merge with remote additions');

  for (const key of ['todos', 'events']) {
    const initial = { [key]: [{ id: 'deleted', text: 'removed while offline' }] };
    const deletion = fixture(initial, { ...initial, _syncedAt: Date.now() + 86400000 });
    deletion.edit({ [key]: [] }); deletion.offline = true;
    assert.equal((await deletion.service.run()).ok, false);
    deletion.restart(); deletion.offline = false;
    assert.equal((await deletion.service.run()).ok, true);
    assert.deepEqual(deletion.pushed[key], []);
    assert.equal((await deletion.service.run()).ok, true);
    assert.deepEqual(deletion.load()[key], []);
  }
  console.log('PASS: offline todo/event deletions survive restart and a remote clock ahead');
  const base = { todos: [task('a', 'A'), task('b', 'B')] };
  const left = copy(base), right = copy(base); left.todos[0].done = true; right.todos[1].text = 'B edited';
  const merged = mergeShared(base, left, right); assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.data.todos[0].done, true); assert.equal(merged.data.todos[1].text, 'B edited');
  const deleted = mergeShared(base, { todos: [base.todos[1]] }, { todos: [task('a', 'edited'), base.todos[1]] });
  assert.equal(deleted.conflicts.length, 1);
  const choice = mergeShared(base, { todos: [base.todos[1]] }, { todos: [task('a', 'edited'), base.todos[1]] }, { [deleted.conflicts[0].id]: 'remote' });
  assert.equal(choice.data.todos[1].text, 'edited');
  console.log('PASS: independent edits merge; deletion versus edit requires explicit choice');

  const conflict = fixture(base, { todos: [task('a', 'remote title'), base.todos[1]] });
  conflict.edit({ todos: [task('a', 'local title'), base.todos[1]] });
  const blocked = await conflict.service.run(); assert.equal(blocked.ok, false); assert.equal(blocked.conflicts.kind, 'settings');
  assert.ok(conflict.load().pendingShared.todos);
  const resolution = { ...blocked.conflicts, choices: Object.fromEntries(blocked.conflicts.items.map(i => [i.id, 'remote'])) };
  conflict.edit({ theme: 'gray' });
  assert.match((await conflict.service.run(resolution)).error, /바뀌었습니다/);
  const fresh = await conflict.service.run();
  assert.equal((await conflict.service.run({ ...fresh.conflicts, choices: resolution.choices })).ok, true);
  assert.equal(conflict.load().todos[0].text, 'remote title'); assert.equal(conflict.load().theme, 'gray');
  console.log('PASS: same-field conflict, stale choice rejection, explicit resolution');

  const concurrent = fixture({ todos: [task('a', 'before')] }, { todos: [task('a', 'before'), remote] });
  concurrent.edit({ todos: [task('a', 'first edit')] });
  concurrent.during = async n => { if (n === 2) concurrent.edit({ todos: [task('a', 'second edit')] }); };
  const first = await concurrent.service.run(); assert.equal(first.pending, true); assert.ok(concurrent.load().pendingShared.todos);
  const second = await concurrent.service.run(); assert.equal(second.ok, true); assert.equal(second.pending, false);
  assert.equal(concurrent.pushed.todos[0].text, 'second edit'); assert.equal(concurrent.pushed.todos[1].id, 'win');
  console.log('PASS: editing during upload preserves later edits AND incoming remote additions');

  const migration = fixture({ theme: 'gray' }, {});
  migration.during = async n => { if (n === 2) migration.offline = true; };
  assert.equal((await migration.service.run()).ok, false);
  assert.equal(migration.load().lastSuccessfulSync, undefined);
  assert.equal(migration.statuses.some(s => s.phase === 'synced'), false);
  migration.during = null; migration.offline = false;
  assert.equal((await migration.service.run()).ok, true); assert.equal(migration.pushed.theme, 'gray');
  console.log('PASS: newly shared settings are uploaded before reporting success');

  const disk = fixture({ theme: 'dark' }, { theme: 'dark' }); disk.edit({ theme: 'gray' }); disk.failSave = true;
  assert.equal((await disk.service.run()).ok, false); assert.ok(disk.load().pendingShared.theme);
  assert.equal(disk.statuses.some(s => s.phase === 'synced'), false);
  disk.failSave = false; assert.equal((await disk.service.run()).ok, true);
  fs.writeFileSync(path.join(root, 'corrupt.json'), '{ invalid');
  assert.throws(() => readShared(path.join(root, 'corrupt.json')));
  assert.equal(equal({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(reconcile({ theme: 'gray' }, {}).data.theme, 'gray');
  console.log('PASS: save failure preserves outbox; corrupt shared data is rejected');
})().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
