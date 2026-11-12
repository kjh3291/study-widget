// 운영 앱(Studeck) 로컬 빌드: package.json build 설정 그대로(업데이트용 publish 정보 포함),
// 결과 폴더만 build-out.js 규칙(OneDrive 밖)으로. 사용: npm run dist:local [-- --mac|--win]
// CI 릴리스는 release.yml에서 따로 빌드한다.
const { spawnSync } = require('child_process');
const path = require('path');
const { buildOut, assertDepsInstalled } = require('./build-out');

assertDepsInstalled();
const out = buildOut('dist');
const cli = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js');
const args = [cli, ...process.argv.slice(2), '--publish', 'never', `-c.directories.output=${out}`];
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
if (r.status === 0) console.log(`Studeck 빌드 완료: ${out}`);
process.exitCode = r.status ?? 1;
