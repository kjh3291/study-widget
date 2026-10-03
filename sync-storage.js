const fs = require('node:fs');
const path = require('node:path');
function atomicJSON(filename, value, tempDir = path.dirname(filename)) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const temp = path.join(tempDir, path.basename(filename) + '.pending-' + process.pid);
  try {
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, filename);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function readShared(filename) {
  if (!fs.existsSync(filename)) return {};
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('공유 설정을 읽을 수 없습니다. 충돌 해결 또는 백업 복구가 필요합니다.');
  for (const key of ['todos', 'events', 'timetableFull', 'subjects', 'readIds', 'starredLms', 'newMaterials']) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error('공유 설정 형식이 올바르지 않습니다: ' + key);
  }
  return data;
}
module.exports = { atomicJSON, readShared };
