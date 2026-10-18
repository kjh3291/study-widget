// icons.css 생성: Lucide(ISC 라이선스) 선 아이콘을 CSS mask로. 글자색을 따른다.
//  - 새 디자인(2차): <span class="sd-ico" data-icon="timer"></span>  (Lucide 이름 그대로)
//  - 예전 이름:      <span class="ico-home"></span>                    (아래 OLD 표로 Lucide 이름에 연결)
// 사용: npm pack lucide-static@0.460.0 로 받은 package/icons 폴더를 넘긴다.
//   node scripts/gen-icons.js <lucide-static/package/icons>
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'timer.svg'))) { console.error('lucide-static icons 폴더를 넘겨 주세요'); process.exit(1); }

// 새 디자인에서 쓰는 Lucide 이름(2차 handoff screens.html + 앱 화면)
const NAMES = `chevron-left chevron-right chevron-down play pause square trash-2 star list-plus x search ellipsis calendar-days timer image-plus
clock arrow-up plus minus users users-round user user-plus repeat folder folder-open chart-no-axes-column chart-column square-pen utensils tent-tree
refresh-cw rotate-cw pin panels-top-left orbit message-circle-plus messages-square graduation-cap file-text file-up external-link copy code-xml
circle-check circle-alert calendar-range book-open shield-check palette minimize-2 maximize-2 log-out key-round house history hard-drive github
eye-off clipboard-check bell archive lock flag megaphone image send user-check grid-3x3 table-2 check undo-2 trophy coffee`.split(/\s+/).filter(Boolean);
// 예전 클래스 이름 → Lucide 이름
const OLD = { home: 'house', book: 'book-open', chat: 'messages-square', more: 'ellipsis', mini: 'minimize-2', expand: 'maximize-2', min: 'minus',
  x: 'x', back: 'chevron-left', next: 'chevron-right', calendar: 'calendar-days', grid: 'grid-3x3', school: 'graduation-cap', chart: 'chart-column',
  attend: 'user-check', search: 'search', newchat: 'message-circle-plus', pin: 'pin', users: 'users', megaphone: 'megaphone', palette: 'palette',
  bell: 'bell', sync: 'refresh-cw', drive: 'hard-drive', shield: 'shield-check', user: 'user', play: 'play', plus: 'plus', send: 'arrow-up',
  image: 'image', code: 'code-xml', food: 'utensils', flag: 'flag', lock: 'lock', logout: 'log-out', folder: 'folder', timer: 'timer', star: 'star' };

const body = name => {
  const svg = fs.readFileSync(path.join(dir, name + '.svg'), 'utf8');
  return svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s+/g, ' ').trim();
};
const url = name => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>${body(name).replace(/"/g, "'")}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
let css = '/* 생성 파일: node scripts/gen-icons.js — Lucide 아이콘(ISC). 글자색을 따르는 선 아이콘 */\n';
css += '.sd-ico, [class^="ico-"], [class*=" ico-"] { display: inline-block; width: 18px; height: 18px; flex: none; background: currentColor; -webkit-mask: var(--i) center / contain no-repeat; mask: var(--i) center / contain no-repeat; vertical-align: middle; }\n';
for (const n of NAMES) css += `[data-icon="${n}"] { --i: ${url(n)}; }\n`;
for (const [o, n] of Object.entries(OLD)) css += `.ico-${o} { --i: ${url(n)}; }\n`;
fs.writeFileSync(path.join(__dirname, '..', 'icons.css'), css);
console.log('icons.css', NAMES.length, 'icons +', Object.keys(OLD).length, 'old names');
