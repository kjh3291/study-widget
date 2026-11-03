# 개발 규칙 (맥 ↔ 윈도우 두 기기 공동 개발)

> Studeck 위젯을 **집(윈도우)** 과 **학교(맥북 M4, arm64)** 두 기기에서 번갈아 개발한다.
> 두 기기가 같은 `main` 브랜치를 밀고 당기므로 아래 규칙을 반드시 지킨다.

## 저장소 구분 (중요)
- **`kjh3291/study-widget`** (공개) = **앱 코드**. 여기서 개발/커밋/릴리스.
- **`kjh3291/studeck-data`** (비공개) = **개인 자료·설정 동기화**(수업자료/보조자료/과제 + `.studeck/config.json`). 위젯이 자동 관리. **여기에 코드 커밋 금지, 코드 repo에 개인 데이터 커밋 금지.**

## 기본 흐름 (매번)
1. **작업 시작 전 반드시 최신화**: `git pull origin main`
   - 루트에 **`HANDOFF.md`가 있으면 먼저 읽고 처리**(다른 기기가 남긴 인수인계).
2. 작업 → `node --check`로 문법 확인
3. **작업 끝나면 즉시 커밋 + 푸시**: `git add <파일> && git commit && git push origin main`
   - 다른 기기가 바로 받아갈 수 있게 **미루지 말고 바로 push**.
4. **한 번에 한 기기에서만** 코드 수정. 양쪽에서 동시에 고치고 push하면 충돌 남.
   - 다른 기기로 넘어가기 전 반드시 이 기기 것을 push, 새 기기에선 pull부터.

## 운영 / 실험실 (2026-10 ~)
- **실험실**: `lab` 브랜치 · 실험실 서버(tailnet 전용) · **Studeck Lab** 앱(`npm run dist:lab`, 별도 설정·`Studeck-Lab` 폴더). 새 기능·수정은 **항상 여기서 먼저** 구현·테스트한다.
- **운영**: `main` 브랜치 · 운영 서버(`https://cosmicsevertest.tailcb1558.ts.net`, Tailscale Funnel) · **Studeck** 앱. 실험실에서 테스트를 통과하고 사용자가 확인한 것만 `lab → main`(fast-forward)으로 옮긴다. 운영 서버·운영 DB는 직접 실험하지 않는다.
- 테스트: `npm test` · `npm run test:ui` · `npm run test:server`(실험실 서버·SSH 필요, 끝나면 시험 계정 자동 정리) · `node scripts/test-prod-switch.js`(운영 앱으로 전환 리허설).
  - 서버 테스트 대상은 `scripts/lab-target.js`. 기본은 실험실 서버(SSH). `STUDECK_TEST_SERVER`(주소)·`STUDECK_TEST_PSQL`(DB 접속 문자열)·`STUDECK_TEST_RESTART`(api 재시작 명령)를 주면 다른 서버(클라우드의 로컬 PostgreSQL+서버)로 전체를 돌릴 수 있다. Electron 테스트는 리눅스에서 `xvfb-run -a`, root면 `--no-sandbox`.
- 서버 배포: 서버에서 `~/studeck/<lab|prod>`에서 `git pull` 후 `server/`에서 `docker compose up -d --build`. 운영 배포 전 `server/scripts/backup.sh ~/studeck/prod`.
- 복구: `server/scripts/restore.sh ~/studeck/<lab|prod> --check`로 최근 백업이 멀쩡한지(회원·파일 수) 확인만 할 수 있다. `restore.sh ~/studeck/<스택> [STAMP]`는 스택 이름을 입력해야 진행하고, 지금 상태를 먼저 백업한 뒤 DB(한 트랜잭션)·파일을 그 시점으로 되돌린다. 리허설은 실험실에서만.
- 서버 동기화(학번 로그인·데이터·보조자료·커뮤니티)만 있다. 예전 GitHub 동기화 코드는 v1.5(lab-next)에서 지웠다. 예전 기기의 `Studeck/.studeck/config.json`은 처음 켤 때 기준값으로만 읽는다.

## 자료 저장 기준 (2026-11 ~)
- **수업자료·과제**: LMS에서 다시 받을 수 있으므로 **각 기기에만** 저장(서버에 올리지 않음). 저장 위치는 설정 › 파일 › 자료 저장 위치(이 기기 전용).
- **보조자료**: 서버 개인 공간에 저장(사람마다 `QUOTA_MB`, 기본 2GB). 지운 파일·이전 버전은 30일 보관.
- **학기 정리**: 서버에 올린 날 이후 첫 종강일(`TERM_ENDS`, 기본 06-30·12-31) + `TERM_GRACE_DAYS`(기본 30일)이 지나면 서버에서 내용·이전 버전을 지우고 행을 `expired`로 남긴다. 기기는 자기 파일을 지우지 않고 다시 올리지도 않는다(고치면 새 학기 파일로 올라감). 예전 앱(v1.4.0)이 같은 내용을 다시 올려도 서버가 거절한다.
- 실험실 서버에는 시험용 `POST /files/expire-now {at}`(내 파일만, 주어진 시각 기준)이 있다. 운영 채널에서는 열리지 않는다.
- 웹 버전(아직 없음)에서는 수업자료·과제를 서버에 두지 않으므로 LMS 원본 링크로 바로 받게 한다(`file-tree.js`의 `lmsEntries('web')`).

## 운영 전환 절차 (v1.4.0, GitHub 동기화 → 서버)
1. 실험실에서 위 테스트 모두 통과, `node scripts/test-prod-switch.js` 통과.
2. 운영 서버 백업 → `main` ← `lab` fast-forward → 운영 서버 `git pull` + `docker compose up -d --build`.
3. `package.json` 버전 `1.4.0` → 커밋 → `git tag v1.4.0 && git push origin v1.4.0` → CI 빌드 → 릴리스 Publish.
4. **윈도우를 먼저**: 옛 앱 완전 종료 → v1.4.0 설치·실행 → 시작 화면에서 운영진 아이디(`kjh3291`)로 가입(최고 관리자로 바로 승인) → 로그인. 서버가 비어 있으므로 윈도우의 할 일·일정·시간표·보조자료·과제가 서버로 올라간다. 예전 GitHub 토큰은 설정에서 지워진다.
5. 서버 데이터 확인(할 일·일정·시간표·파일 개수가 윈도우와 같은지).
6. **맥은 그다음**: v1.4.0 설치 → 같은 계정 로그인 → 서버 데이터로 시작한다(맥의 옛 데이터는 올리지 않음). 서버와 다르거나 맥에만 있던 파일은 맥의 `Studeck/.studeck/서버 전환 전 보관/`에 남는다.
7. 다운로드 페이지는 운영 서버 `.env`의 `DOWNLOAD_MIN_VERSION`보다 높은 릴리스가 있어야 열린다. 동아리 오픈 날까지는 높게 두었다가 오픈 때 `1.4.0`으로 낮추고 `docker compose up -d`.
8. 1주일 문제가 없으면 GitHub 동기화 코드 제거, `studeck-data` 저장소는 보관.

## 커밋 메시지
- 형식: 한 줄 요약 + 필요시 세부. 끝에 항상:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **OS 전용 변경**이면 앞에 태그: `[mac] ...`, `[win] ...`. (예: `[mac] CI 애드혹 서명 추가`)
- 공통 변경(대부분)은 태그 없이.

## 버전 / 릴리스 규칙
- 버전은 `package.json`의 `version` **하나만** 증가시킨다.
- **버전 올리기 전 반드시 `git pull` + `git tag | sort -V | tail`로 최신 버전 확인** → 번호 중복 금지.
- 릴리스: `package.json` 버전 올림 → 커밋 → `git tag vX.Y.Z && git push origin vX.Y.Z`.
  - 태그를 push하면 **GitHub Actions(.github/workflows/release.yml)가 윈도우 exe + 맥 dmg/zip 을 자동 빌드**해 초안 릴리스 생성.
  - **한 기기에서만** 버전 올리고 태그. 양쪽에서 같은 버전 태그 만들지 말 것.
- **로컬 빌드**(`electron-builder --win`/`--mac`)는 그 기기에서 즉시 써보려는 용도. `dist/`는 `.gitignore`라 커밋 안 됨(그대로 둘 것).

## OS별 빌드
- 윈도우: `npx electron-builder --win` → `dist/StudyWidget-<v>-Setup.exe`
- 맥(arm64): `npx electron-builder --mac` → `dist/StudyWidget-<v>-mac-arm64.dmg`
  - CI에서 `StudyWidget.app`과 Helper에 electron-builder 기본 ad-hoc 서명을 적용하고 실행을 검사합니다. 기존 수동 `--deep` 재서명은 사용하지 않습니다. Apple 공증은 별도이며 최초 실행은 macOS의 확인이 필요할 수 있습니다.

## 설치 시 주의 (단일 인스턴스)
- 새 버전을 설치·실행해도 **옛 앱이 켜져 있으면** 단일 인스턴스 잠금 때문에 새 버전이 안 뜨고 기존 창만 앞으로 온다.
- 반드시 **기존 앱 완전 종료(트레이/독 아이콘까지) 후** 새 버전 실행. (맥은 ⌘Q, 윈도우는 트레이 우클릭 종료)

## 보안 (변하지 않는 규칙)
- LMS 비밀번호 **저장/취급 금지**(실제 로그인 창만). `persist:lms` 세션 쿠키만 재사용.
- GitHub 토큰은 각 기기 `userData/config.json`에만 저장. **코드/이슈/커밋/동기화 트리에 절대 넣지 말 것.**
- 개인정보(config.json, lms-debug)는 저장소에 커밋 금지.

## 파일 지도(핵심)
- `main.js` — Electron 메인(창/IPC/다운로드/폴더/단일인스턴스/백업/GitHub 동기화 git 호출)
- `lms.js` — 충북대 coursemos 스크래핑/다운로드/디버그 덤프
- `lms-notices.js` — LMS 공지 제목에서 마감일 읽기·D-day 칩(순수 계산, `scripts/test-lms-notices.js`)
- `lms-remember.js` — LMS 로그인 창 학번 기억(학번만, `userData/lms-remember.json`, 동기화 안 함)
- `material-dedupe.js` — 수업자료 중복 저장 방지(같은 내용 파일 찾기)
- `material-folders.js` — 자료 저장 위치(기본·전체·과목별)
- `file-tree.js` — '내 자료' 폴더 보기 계산(앱: 이 기기 파일, 웹: LMS 링크, 학기 정리 표시)
- `file-sync.js` — 보조자료 ↔ 서버 동기화(학기 정리 반영)
- `server/src/terms.js` — 학기 정리 규칙
- `renderer.js` — 모든 UI/상태(할 일/일정/LMS/기록/출석/집중화면/동기화 로직)
- `preload.js` — IPC 브리지
- `index.html` — 마크업/CSS
- `.github/workflows/release.yml` — 태그 push 시 win+mac 빌드 CI
