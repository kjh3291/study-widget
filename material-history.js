const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// 교수님이 바꾼 수업자료의 이전 판을 같은 폴더의 '이전 자료'에 남긴다(내용 해시로 이름을 지어 같은 판은 한 번만)
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
module.exports = { isMaterial, preserveMaterial };
