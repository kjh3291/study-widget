// 서버 테스트 대상. 기본은 실험실 서버(tailnet + SSH로 DB 확인) — PC에서는 지금처럼 그대로 쓴다.
// 다른 서버로 돌리려면(클라우드에서 로컬 서버 등):
//   STUDECK_TEST_SERVER=http://localhost:18444      서버 주소
//   STUDECK_TEST_PSQL=postgres://studeck@localhost:55432/studeck   DB를 SSH 대신 psql로 직접
//   STUDECK_TEST_RESTART="..."                      api 다시 시작 명령(커뮤니티 재연결 시험용, 없으면 그 시험만 건너뜀)
// 운영 서버(8443·ts.net)에는 쓰지 않는다.
const { execFileSync } = require('node:child_process');
const URL = process.env.STUDECK_TEST_SERVER || 'http://100.96.247.43:8444';
if (/:8443\b|ts\.net/.test(URL)) { console.error('운영 서버에는 실행하지 않습니다.'); process.exit(1); }
const WS = URL.replace(/^http/, 'ws') + '/ws';
const LOCAL = !!process.env.STUDECK_TEST_PSQL;
function sql(q) {
  if (LOCAL) return execFileSync('psql', [process.env.STUDECK_TEST_PSQL, '-At', '-c', q]).toString().trim();
  return execFileSync('ssh', ['kimti4', `cd ~/studeck/lab/server && docker compose exec -T db psql -U studeck -d studeck -At -c "${q}"`]).toString().trim();
}
function restartApi() {
  if (LOCAL) { if (!process.env.STUDECK_TEST_RESTART) return false; execFileSync('sh', ['-c', process.env.STUDECK_TEST_RESTART]); return true; }
  execFileSync('ssh', ['kimti4', 'cd ~/studeck/lab/server && docker compose restart api >/dev/null 2>&1']);
  return true;
}
module.exports = { URL, WS, sql, restartApi, LOCAL };
