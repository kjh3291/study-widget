// LMS 로그인 창 '학번 기억': 이 기기에만(userData/lms-remember.json) 학번만 저장해 다음 로그인 때 미리 채운다.
// 비밀번호는 읽지도 저장하지도 않는다. 동기화 대상(sync-fields)에도 넣지 않는다.
const fs = require('node:fs'), path = require('node:path');

const MARK = '__STUDECK_LMS_ID__';
// 학번만 저장: 숫자 6~12자리. 다른 값(이메일·실수로 친 비밀번호 등)은 저장하지 않는다
const isStudentId = (v) => typeof v === 'string' && /^\d{6,12}$/.test(v.trim());
const maskId = (v) => (isStudentId(v) ? v.trim().slice(0, 4) + '*'.repeat(Math.max(0, v.trim().length - 6)) + v.trim().slice(-2) : '');

function load(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { enabled: v.enabled !== false, id: isStudentId(v.id) ? v.id.trim() : '' };
  } catch (e) { return { enabled: true, id: '' }; }   // 처음엔 켜짐(아직 기억한 학번 없음)
}
function save(file, data) {
  const value = { enabled: data.enabled !== false, id: data.enabled !== false && isStudentId(data.id) ? data.id.trim() : '' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
  return value;
}

// 로그인 페이지에 넣는 스크립트: 아이디 칸만 찾아(비밀번호 칸 제외) 비어 있으면 학번을 채우고,
// 로그인 버튼·Enter·제출 때 '아이디 칸의 값'만 콘솔 표시(MARK)로 앱에 알린다. 앱은 로그인에 성공했을 때만 저장한다.
function fillScript(id) {
  return `(function (id) {
  var sel = 'input[name="username"],input#input-username,input#username,input[name="userid"],input[name="user_id"],input[name="id"]';
  var u = Array.prototype.filter.call(document.querySelectorAll(sel), function (e) { return e.type !== 'password' && e.type !== 'hidden'; })[0];
  if (!u) return false;
  if (id && !u.value) { u.value = id; u.dispatchEvent(new Event('input', { bubbles: true })); u.dispatchEvent(new Event('change', { bubbles: true })); }
  if (!window.__studeckIdHook) {
    window.__studeckIdHook = true;
    var send = function () { console.log(${JSON.stringify(MARK)} + String(u.value || '')); };
    if (u.form) u.form.addEventListener('submit', send, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); }, true);
    document.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('button,input[type=submit],input[type=image],a'); if (t) send(); }, true);
  }
  return true;
})(${JSON.stringify(isStudentId(id) ? id.trim() : '')});`;
}
// 콘솔 메시지에서 학번 꺼내기(표시가 없거나 학번 모양이 아니면 '')
function idFromConsole(message) {
  const s = String(message || '');
  if (!s.startsWith(MARK)) return '';
  const v = s.slice(MARK.length).trim();
  return isStudentId(v) ? v : '';
}

module.exports = { isStudentId, maskId, load, save, fillScript, idFromConsole, MARK };
