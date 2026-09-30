const { equal, copy, reconcile, acknowledge, sharedSnapshot } = require('./sync-model');
const { createHash } = require('node:crypto');
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Config is the durable outbox. Network failures never acknowledge local changes.
function createSyncService({ load, save, read, write, transport, conflicts, resolveFiles, dirty, notify = () => {} }) {
  let running = null, status = { phase: 'idle' };
  const publish = patch => { status = { ...status, ...patch }; notify(status); return status; };
  function changed() { publish({ phase: 'pending', error: '', conflicts: null }); }
  function run(resolution) {
    if (running) return running;
    running = (async () => {
      const connection = load().sync || {};
      if (!connection.enabled) return { ok: false, error: '동기화 연결 설정이 필요합니다.' };
      publish({ phase: 'syncing', error: '', conflicts: null });
      if (resolution?.kind === 'files') await resolveFiles(resolution);
      const first = await transport(connection);
      if (!first.ok) {
        const files = await conflicts();
        if (files) return blocked(files);
        throw new Error(first.error);
      }
      const sent = copy(load()), remote = read();
      const token = fingerprint([sent.syncRevision, sharedSnapshot(sent), sent.pendingShared, remote]);
      if (resolution?.kind === 'settings' && resolution.token !== token) throw new Error('비교 중 내용이 바뀌었습니다. 다시 동기화한 뒤 선택해 주세요.');
      const merged = reconcile(sent, remote, resolution?.kind === 'settings' ? resolution.choices : {});
      if (merged.conflicts.length) return blocked({ kind: 'settings', token, items: merged.conflicts });
      if (!equal(merged.data, sharedSnapshot(remote))) {
        write({ ...merged.data, _syncedAt: Math.max(Date.now(), (Number(remote._syncedAt) || 0) + 1) });
        const uploaded = await transport(connection);
        if (!uploaded.ok) {
          const files = await conflicts();
          if (files) return blocked(files);
          throw new Error(uploaded.error);
        }
      }
      const confirmed = read();
      // A disconnect/reconnect while awaiting the network must not apply the old account's data.
      if (!equal(load().sync, connection)) throw new Error('동기화 연결이 바뀌었습니다. 현재 연결로 다시 시도해 주세요.');
      const next = acknowledge(load(), sent, confirmed);
      next.lastSuccessfulSync = Date.now();
      save(next);
      const filesPending = await dirty();
      const pending = Object.keys(load().pendingShared || {}).length > 0 || filesPending;
      publish({ phase: pending ? 'pending' : 'synced', lastSuccessfulAt: next.lastSuccessfulSync, error: '', conflicts: null });
      return { ok: true, pending, snapshot: sharedSnapshot(confirmed), status };
    })().catch(error => {
      const result = { ok: false, error: error.message };
      publish({ phase: 'error', error: error.message, conflicts: null });
      return result;
    }).finally(() => { running = null; });
    return running;
  }
  function blocked(conflict) {
    const error = '양쪽에서 같은 내용을 수정했습니다. 비교 후 선택해 주세요.';
    publish({ phase: 'conflict', error, conflicts: conflict });
    return { ok: false, error, conflicts: conflict };
  }
  return { run, changed, isRunning: () => !!running, status: () => ({ ...status, lastSuccessfulAt: load().lastSuccessfulSync || null,
    pendingCount: Object.keys(load().pendingShared || {}).length }) };
}
module.exports = { createSyncService, fingerprint };
