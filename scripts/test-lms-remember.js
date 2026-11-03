// LMS 로그인 창 학번 기억 점검(lms-remember.js): 학번만 저장·비밀번호 칸은 건드리지 않음·끄면 지움
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const M = require('../lms-remember');

assert.equal(M.isStudentId('2023041234'), true);
assert.equal(M.isStudentId(' 2023041234 '), true);
assert.equal(M.isStudentId('abc123!@#'), false, '학번 모양이 아니면 저장 안 함');
assert.equal(M.isStudentId('me@cbnu.ac.kr'), false);
assert.equal(M.isStudentId('12345'), false);
assert.equal(M.maskId('2023041234'), '2023****34');
assert.equal(M.maskId('nope'), '');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studeck-remember-'));
const file = path.join(dir, 'lms-remember.json');
try {
  assert.deepEqual(M.load(file), { enabled: true, id: '' }, '처음엔 켜짐, 학번 없음');
  M.save(file, { enabled: true, id: '2023041234' });
  assert.deepEqual(M.load(file), { enabled: true, id: '2023041234' });
  M.save(file, { enabled: true, id: 'secret-pass' });
  assert.deepEqual(M.load(file), { enabled: true, id: '' }, '학번이 아닌 값은 저장되지 않음');
  M.save(file, { enabled: true, id: '2023041234' });
  M.save(file, { enabled: false, id: '2023041234' });
  assert.deepEqual(M.load(file), { enabled: false, id: '' }, '끄면 학번도 지움');
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))), '{"enabled":false,"id":""}', '파일에는 켜짐 여부와 학번만');
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(M.load(file), { enabled: true, id: '' }, '깨진 파일은 처음 상태로');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

// 콘솔 표시에서 학번만 꺼냄
assert.equal(M.idFromConsole(M.MARK + '2023041234'), '2023041234');
assert.equal(M.idFromConsole(M.MARK + 'hello'), '');
assert.equal(M.idFromConsole('2023041234'), '', '표시 없는 콘솔 글은 무시');

// 로그인 페이지 스크립트: 아이디 칸만 채우고 비밀번호 칸은 읽지도 바꾸지도 않음
function page(userValue) {
  const listeners = {};
  const touched = [];
  const field = (type, name, value) => new Proxy({ type, name, value, form: null, dispatchEvent() {} }, {
    get(t, k) { if (type === 'password' && k === 'value') touched.push('read'); return t[k]; },
    set(t, k, v) { if (type === 'password' && k === 'value') touched.push('write'); t[k] = v; return true; },
  });
  const pw = field('password', 'username', 'pw-secret');   // 이름이 겹쳐도 비밀번호 칸은 거른다
  const user = field('text', 'username', userValue);
  const form = { addEventListener: (ev, fn) => (listeners['form:' + ev] = fn) };
  user.form = form;
  const logs = [];
  const ctx = {
    window: {}, Event: function (t) { this.type = t; }, console: { log: (m) => logs.push(m) },
    document: { querySelectorAll: () => [pw, user], addEventListener: (ev, fn) => (listeners['doc:' + ev] = fn) },
  };
  return { ctx, user, listeners, logs, touched };
}
let p = page('');
assert.equal(vm.runInNewContext(M.fillScript('2023041234'), p.ctx), true);
assert.equal(p.user.value, '2023041234', '빈 아이디 칸에 학번 채움');
p.user.value = '2023049999';
p.listeners['form:submit']();
assert.deepEqual(p.logs, [M.MARK + '2023049999'], '제출 때 아이디 칸 값만 알림');
assert.deepEqual(p.touched, [], '비밀번호 칸은 읽지도 쓰지도 않음');
p = page('2020000000');
vm.runInNewContext(M.fillScript('2023041234'), p.ctx);
assert.equal(p.user.value, '2020000000', '이미 입력된 값은 덮어쓰지 않음');
assert.ok(!/['"]password['"]\s*\]|\.password\b/.test(M.fillScript('2023041234')), '스크립트가 비밀번호 칸을 고르지 않음');
console.log('PASS: LMS 학번 기억 — 학번만(숫자 6~12자리) 이 기기에 저장, 끄면 지움, 아이디 칸만 채우고 비밀번호 칸은 건드리지 않음');
