// 서버 첫 화면(/): Studeck 소개 + 내려받기 + 설치 안내. 설치 파일은 GitHub 릴리스에서 받는다(Funnel 대역폭 절약).
// DOWNLOAD_MIN_VERSION보다 낮은 릴리스만 있으면 "오픈 준비 중"으로 보여 준다(서버 동기화가 없는 옛 앱 배포 방지).
const REPO = process.env.DOWNLOAD_REPO || 'kjh3291/study-widget';
const MIN_VERSION = process.env.DOWNLOAD_MIN_VERSION || '';
let cache = { at: 0, release: null };

const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return true;
};

async function latestRelease() {
  if (Date.now() - cache.at < 10 * 60 * 1000) return cache.release;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'user-agent': 'Studeck', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    const j = r.ok ? await r.json() : null;
    const pick = re => j?.assets?.find(a => re.test(a.name))?.browser_download_url || null;
    cache = { at: Date.now(), release: j && { version: j.tag_name, url: j.html_url,
      win: pick(/Setup\.exe$/i), macArm: pick(/mac-arm64\.dmg$/i), macIntel: pick(/mac-x64\.dmg$/i) } };
  } catch { cache = { at: Date.now() - 9 * 60 * 1000, release: cache.release }; }
  return cache.release;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(rel) {
  const ready = rel && rel.win && (!MIN_VERSION || newer(rel.version, MIN_VERSION));
  const btn = (href, label, sub) => href ? `<a class="dl" href="${esc(href)}">${label}<small>${sub}</small></a>` : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Studeck · 동아리 학습 도우미</title>
<style>
:root{--bg:#0d0e11;--card:#16181d;--line:#262a31;--text:#eef0f3;--muted:#9097a3;--accent:#5b9dff}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--text);font:15px/1.65 "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;padding:48px 18px}
main{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:28px}
h1{font-size:40px;letter-spacing:-1px}h1 span{color:var(--accent)}h2{font-size:18px;margin-bottom:10px}
.lead{color:var(--muted);font-size:17px}.feat{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.feat div,.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}.feat b{display:block}.feat small{color:var(--muted)}
.dls{display:flex;flex-wrap:wrap;gap:10px}.dl{flex:1 1 200px;display:flex;flex-direction:column;background:var(--accent);color:#fff;text-decoration:none;border-radius:12px;padding:14px 16px;font-weight:800}
.dl small{font-weight:500;opacity:.85}.wait{background:var(--card);border:1px dashed var(--accent);border-radius:14px;padding:16px;color:var(--muted)}
ol{padding-left:20px;color:var(--muted)}li b{color:var(--text)}footer{color:var(--muted);font-size:12.5px}
</style></head><body><main>
<header><h1>Stu<span>deck</span></h1><p class="lead">시간표·할 일·일정·LMS 과제를 한 위젯에서. 동아리 공지와 채팅까지.</p></header>
<section class="feat">
<div><b>LMS 자동 연동</b><small>과제 마감·공지·수업자료를 알아서 모아 줘요</small></div>
<div><b>기기 간 동기화</b><small>집·학교 컴퓨터에서 같은 할 일과 자료</small></div>
<div><b>집중 기록</b><small>과목별 공부 시간과 출석 관리</small></div>
<div><b>동아리 커뮤니티</b><small>공지·채팅·프로필 (준비 중)</small></div>
</section>
<section><h2>내려받기</h2>
${ready ? `<div class="dls">${btn(rel.win, 'Windows', '설치 파일 (.exe)')}${btn(rel.macArm, 'macOS (Apple 칩)', 'M1·M2·M3·M4')}${btn(rel.macIntel, 'macOS (Intel)', '2020년 이전 맥')}</div>
<p style="color:var(--muted);font-size:13px;margin-top:8px">현재 버전 ${esc(rel.version)} · <a style="color:var(--accent)" href="${esc(rel.url)}">릴리스 노트</a></p>`
    : `<div class="wait">곧 공개됩니다. 동아리 공지를 기다려 주세요.</div>`}
</section>
<section class="card"><h2>설치 안내</h2>
<ol>
<li><b>Windows</b>: "Windows의 PC 보호" 창이 뜨면 <b>추가 정보 → 실행</b>을 누르세요.</li>
<li><b>macOS</b>: 처음 열 때 "확인되지 않은 개발자" 경고가 뜨면 <b>시스템 설정 → 개인정보 보호 및 보안</b> 아래쪽의 <b>그래도 열기</b>를 누르세요.</li>
<li>앱을 열고 <b>가입 신청</b>(학번·이름·비밀번호) → 운영진이 승인하면 로그인할 수 있어요.</li>
</ol></section>
<footer>Studeck은 동아리 서버에서 운영됩니다. 학교 계정(LMS) 비밀번호는 서버에 저장하지 않습니다. 동아리 안에서 공유된 자료는 외부에 배포하지 마세요.</footer>
</main></body></html>`;
}

export function registerSite(app) {
  app.get('/', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'public, max-age=300')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    return page(await latestRelease());
  });
}
