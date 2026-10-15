// 운영(prod) / 실험실(lab) 채널. 실험실 빌드에는 channel.json({"channel":"lab"})이 들어가고,
// 개발 중에는 STUDECK_CHANNEL=lab으로 바꿀 수 있다. 다른 모듈보다 먼저 require해야
// userData 경로(설정·LMS 세션·단일 인스턴스 잠금)가 운영 앱과 분리된다.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function readChannel() {
  if (process.env.STUDECK_CHANNEL) return process.env.STUDECK_CHANNEL;
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'channel.json'), 'utf8')).channel || 'prod'; }
  catch { return 'prod'; }
}

const CHANNEL = readChannel() === 'lab' ? 'lab' : 'prod';
const IS_LAB = CHANNEL === 'lab';

const PROFILE = IS_LAB ? {
  userDataName: 'studeck-lab',
  studeckFolder: 'Studeck-Lab',
  appUserModelId: 'cbnu.study.widget.lab',
  icon: 'icon-dev.ico',
  serverUrl: 'http://100.96.247.43:8444',
} : {
  userDataName: null, // 기존 운영 경로(everytime-widget) 유지
  studeckFolder: 'Studeck',
  appUserModelId: 'cbnu.study.widget',
  icon: 'icon.ico',
  serverUrl: 'http://100.96.247.43:8443',
};

// 테스트는 임시 프로필을 먼저 지정하고 STUDECK_KEEP_USERDATA=1로 실제 실험실 프로필을 건드리지 않는다.
if (PROFILE.userDataName && !process.env.STUDECK_KEEP_USERDATA) app.setPath('userData', path.join(app.getPath('appData'), PROFILE.userDataName));

module.exports = { CHANNEL, IS_LAB, PROFILE };
