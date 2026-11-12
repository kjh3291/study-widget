// 설치 파일 빌드 결과 폴더. 프로젝트가 OneDrive 안에 있으면 수백 MB짜리 결과물이 클라우드로 올라가지 않게
// OneDrive 밖(%LOCALAPPDATA%\studeck-build)에 만든다. STUDECK_BUILD_DIR로 직접 지정할 수도 있다. CI는 그대로 저장소 안.
const path = require('path');

const root = path.join(__dirname, '..');

function buildOut(name) {
  if (process.env.STUDECK_BUILD_DIR) return path.join(process.env.STUDECK_BUILD_DIR, name);
  const inOneDrive = /[\\/]OneDrive[^\\/]*[\\/]/i.test(root + path.sep);
  if (inOneDrive && process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'studeck-build', name);
  }
  return path.join(root, name);
}

// package.json dependencies가 이 기기에 다 설치됐는지 확인. 빠진 채 빌드하면 설치본이 켜지자마자
// "Cannot find module" 오류로 죽는다(1.5.0 첫 로컬 빌드 때 electron-updater가 빠졌던 일).
function assertDepsInstalled() {
  const pkg = require(path.join(root, 'package.json'));
  const missing = Object.keys(pkg.dependencies || {}).filter(d => {
    try { require.resolve(d + '/package.json', { paths: [root] }); return false; } catch (e) { return true; }
  });
  if (missing.length) throw new Error(`설치 안 된 의존성: ${missing.join(', ')} — 먼저 npm install`);
}

module.exports = { buildOut, assertDepsInstalled };
