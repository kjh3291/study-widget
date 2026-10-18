// 자동 테스트가 만든 실험실 시험 계정(가짜 학번 97…/99…, 10자리)을 실험실 DB에서만 지운다. 운영 서버에는 쓰지 않는다.
const { execFileSync } = require('node:child_process');
// 시험 계정이 만든 채팅방(메시지·참여자는 함께 지워짐)부터 지운 뒤 계정을 지운다
const TEST = "SELECT id FROM users WHERE username ~ '^9[79][0-9]{8}$'";
const query = `DELETE FROM rooms WHERE kind <> 'all' AND (owner_id IN (${TEST}) OR created_by IN (${TEST})); DELETE FROM users WHERE username ~ '^9[79][0-9]{8}$'`;
const out = execFileSync('ssh', ['kimti4', `cd ~/studeck/lab/server && docker compose exec -T db psql -U studeck -d studeck -At -c "${query}"`]).toString().trim();
console.log('실험실 시험 계정 정리: ' + out);
