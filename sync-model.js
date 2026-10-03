(function () {
const { sharedFields, sharedSnapshot } = typeof module !== 'undefined' ? require('./sync-fields') : window.SyncFields;
const equal = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(a[k], b[k])));
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const version = value => value === undefined ? { exists: false } : { exists: true, value: copy(value) };

// Three-way merging preserves independent edits. A conflicting value always needs a choice.
function mergeValue(base, local, remote, path, conflicts, choices) {
  if (equal(local, remote) || equal(remote, base)) return copy(local);
  if (equal(local, base)) return copy(remote);
  if (object(local) && object(remote) && (object(base) || base === undefined)) {
    const result = Object.create(null);
    for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeValue(base?.[key], local[key], remote[key], [...path, key], conflicts, choices);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  if ((base === undefined || Array.isArray(base)) && Array.isArray(local) && Array.isArray(remote)) {
    base = base || [];
    const keyed = values => values.every(x => object(x) && typeof x.id === 'string') && new Set(values.map(x => x.id)).size === values.length;
    if ([base, local, remote].every(keyed)) {
      const maps = [base, local, remote].map(xs => new Map(xs.map(x => [x.id, x])));
      return [...new Set([...local, ...remote, ...base].map(x => x.id))].flatMap(id => {
        const value = mergeValue(...maps.map(m => m.get(id)), [...path, { id }], conflicts, choices);
        return value === undefined ? [] : [value];
      });
    }
    if ([base, local, remote].every(xs => xs.every(x => typeof x === 'string'))) {
      return [...new Set([...local, ...remote])].filter(x => !base.includes(x) || (local.includes(x) && remote.includes(x)));
    }
  }
  const id = JSON.stringify(path);
  if (choices[id] === 'local') return copy(local);
  if (choices[id] === 'remote') return copy(remote);
  conflicts.push({ id, path, local: version(local), remote: version(remote) });
  return copy(local);
}
function mergeShared(base, local, remote, choices = {}) {
  const conflicts = [], data = {};
  for (const key of sharedFields) {
    // Older clients omit newly introduced settings; omission is not a deletion.
    const value = remote[key] === undefined ? copy(local[key]) : mergeValue(base[key], local[key], remote[key], [key], conflicts, choices);
    if (value !== undefined) data[key] = value;
  }
  return { data: copy(data), conflicts };
}
function initializeOutbox(config, baseline) {
  if (config.pendingShared && typeof config.pendingShared === 'object') return config;
  const next = { ...config, pendingShared: {} };
  for (const key of sharedFields) if (config[key] !== undefined && !equal(config[key], baseline[key])) next.pendingShared[key] = version(baseline[key]);
  return next;
}
function trackChanges(config, patch) {
  const next = { ...config, ...patch, pendingShared: { ...config.pendingShared } };
  let changed = false;
  for (const key of sharedFields) {
    if (!Object.hasOwn(patch, key) || equal(config[key], patch[key])) continue;
    if (!Object.hasOwn(next.pendingShared, key)) next.pendingShared[key] = version(config[key]);
    changed = true;
  }
  if (changed) next.syncRevision = (config.syncRevision || 0) + 1;
  return next;
}
function reconcile(config, remote, choices = {}) {
  const conflicts = [], data = {};
  for (const key of sharedFields) {
    const pending = config.pendingShared?.[key];
    const value = remote[key] === undefined ? copy(config[key]) : pending
      ? mergeValue(pending.exists ? pending.value : undefined, config[key], remote[key], [key], conflicts, choices)
      : copy(remote[key]);
    if (value !== undefined) data[key] = value;
  }
  return { data: copy(data), conflicts };
}
function acknowledge(current, sentConfig, confirmed) {
  const next = { ...current, pendingShared: { ...current.pendingShared } };
  for (const key of sharedFields) {
    if (equal(current[key], sentConfig[key])) {
      if (confirmed[key] !== undefined) next[key] = copy(confirmed[key]);
      delete next.pendingShared[key];
    } else {
      // Rebase on what this run captured, not on remote additions the user hasn't seen.
      next.pendingShared[key] = version(sentConfig[key]);
    }
  }
  return next;
}
const api = { equal, copy, version, initializeOutbox, trackChanges, mergeShared, reconcile, acknowledge, sharedSnapshot };
if (typeof module !== 'undefined') module.exports = api;
else window.SyncModel = api;
})();
