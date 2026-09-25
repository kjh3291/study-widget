// electron-builder afterPack 훅: 맥 .app에 ad-hoc 서명(codesign -s -)을 붙인다.
// identity:null 이라 electron-builder는 서명을 건너뛰는데, arm64 macOS는 서명 없는
// 앱 실행을 거부한다("손상되어 열 수 없음"). ad-hoc 서명으로 최소한 실행은 되게 한다.
// (Gatekeeper 격리 경고는 별개 문제 — 유료 Developer ID + notarization 필요)
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`  • ad-hoc signing  ${appPath}`);
  // --deep: 내부 프레임워크/헬퍼까지 안쪽부터 서명, --force: 기존 서명 덮어쓰기
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  // 검증: 서명이 유효하지 않으면 빌드를 실패시킨다
  execFileSync('codesign', ['--verify', '--verbose', appPath], { stdio: 'inherit' });
};
