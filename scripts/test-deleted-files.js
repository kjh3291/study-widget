const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { preserveDeleted, wasDeletedFile } = require('../deleted-files');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-deleted-'));
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
(async () => {
  const relative = '선형대수학/보조자료/정리.pdf';
  const first = preserveDeleted(root, relative, Buffer.from('first'));
  assert.equal(first, path.join(root, '삭제한 파일', relative));
  assert.equal(preserveDeleted(root, relative, Buffer.from('first')), first);
  const second = preserveDeleted(root, relative, Buffer.from('second'));
  assert.notEqual(second, first);
  assert.equal(fs.readFileSync(first, 'utf8'), 'first');
  assert.equal(fs.readFileSync(second, 'utf8'), 'second');
  assert.equal(preserveDeleted(root, relative, Buffer.from('second')), second);
  assert.equal(preserveDeleted(root, '.studeck/config.json', Buffer.from('{}')), undefined);
  assert.throws(() => preserveDeleted(root, '../outside', Buffer.from('x')));
  if (process.platform !== 'win32') {
    fs.symlinkSync(root, path.join(root, '삭제한 파일', 'link'));
    assert.throws(() => preserveDeleted(root, 'link/test', Buffer.from('x')), /바로가기/);
  }
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@local');
  const file = path.join(root, 'lecture.pdf');
  fs.writeFileSync(file, 'downloaded'); git('add', '--', 'lecture.pdf'); git('commit', '-m', 'original');
  fs.unlinkSync(file);
  assert.equal(await wasDeletedFile(root, file), true);
  git('add', '-u'); git('commit', '-m', 'deleted');
  assert.equal(await wasDeletedFile(root, file), true);
  assert.equal(await wasDeletedFile(root, path.join(root, 'new.pdf')), false);
  fs.writeFileSync(file, 'explicitly restored');
  assert.equal(await wasDeletedFile(root, file), false);
  console.log('PASS: holding-folder layout, version collision/retry, path safety and LMS deletion history');
})().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch(e => { console.error(e); process.exitCode = 1; });
