// 실험실 앱(Studeck Lab) 빌드: 운영 앱과 나란히 설치되도록 이름·appId·설치 폴더·아이콘을 바꾸고
// channel.json({"channel":"lab"})을 넣는다. 사용: npm run dist:lab [-- --mac|--win]
const fs = require('fs');
const path = require('path');
const builder = require('electron-builder');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const channelFile = path.join(root, 'channel.json');

const base = pkg.build;
const config = {
  ...base,
  appId: base.appId + '.lab',
  productName: 'StudeckLab',
  artifactName: 'StudeckLab-${version}-Setup.${ext}',
  extraMetadata: { name: 'studeck-lab' }, // 설치 폴더(%LOCALAPPDATA%\Programs\studeck-lab) 분리
  directories: { output: 'dist-lab' },
  files: [...base.files.filter(f => !/^icon\./.test(f)), 'channel.json', 'icon-dev.ico', 'icon-dev.png'],
  win: { ...base.win, icon: 'icon-dev.ico' },
  portable: { artifactName: 'StudeckLab-${version}-Portable.${ext}' },
  nsis: { ...base.nsis, shortcutName: 'Studeck Lab' },
  mac: { ...base.mac, icon: 'icon-dev.png', artifactName: 'StudeckLab-${version}-mac-${arch}.${ext}' },
};

const platform = process.argv.includes('--mac') ? builder.Platform.MAC : process.argv.includes('--win') ? builder.Platform.WINDOWS : undefined;

fs.writeFileSync(channelFile, JSON.stringify({ channel: 'lab' }) + '\n');
builder.build({ config, publish: 'never', ...(platform ? { targets: platform.createTarget() } : {}) })
  .then(out => { console.log('Studeck Lab 빌드 완료:\n' + out.join('\n')); })
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => fs.rmSync(channelFile, { force: true }));
