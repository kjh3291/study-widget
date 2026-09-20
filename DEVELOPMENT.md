# 개발 규칙 (맥 ↔ 윈도우 두 기기 공동 개발)

> Studeck 위젯을 **집(윈도우)** 과 **학교(맥북 M4, arm64)** 두 기기에서 번갈아 개발한다.
> 두 기기가 같은 `main` 브랜치를 밀고 당기므로 아래 규칙을 반드시 지킨다.

## 저장소 구분 (중요)
- **`kjh3291/study-widget`** (공개) = **앱 코드**. 여기서 개발/커밋/릴리스.
- **`kjh3291/studeck-data`** (비공개) = **개인 자료·설정 동기화**(수업자료/보조자료/과제 + `.studeck/config.json`). 위젯이 자동 관리. **여기에 코드 커밋 금지, 코드 repo에 개인 데이터 커밋 금지.**

## 기본 흐름 (매번)
1. **작업 시작 전 반드시 최신화**: `git pull origin main`
2. 작업 → `node --check`로 문법 확인
3. **작업 끝나면 즉시 커밋 + 푸시**: `git add <파일> && git commit && git push origin main`
   - 다른 기기가 바로 받아갈 수 있게 **미루지 말고 바로 push**.
4. **한 번에 한 기기에서만** 코드 수정. 양쪽에서 동시에 고치고 push하면 충돌 남.
   - 다른 기기로 넘어가기 전 반드시 이 기기 것을 push, 새 기기에선 pull부터.

## 커밋 메시지
- 형식: 한 줄 요약 + 필요시 세부. 끝에 항상:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
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
  - **맥 앱은 미서명이라 첫 실행 시** 격리 해제 + 애드혹 서명 필요:
    ```bash
    xattr -dr com.apple.quarantine "/Applications/스터디 위젯.app"
    codesign --force --deep --sign - "/Applications/스터디 위젯.app"
    ```
  - (TODO: CI에서 맥 애드혹 서명 자동화하면 위 과정 불필요.)

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
- `renderer.js` — 모든 UI/상태(할 일/일정/LMS/기록/출석/집중화면/동기화 로직)
- `preload.js` — IPC 브리지
- `index.html` — 마크업/CSS
- `.github/workflows/release.yml` — 태그 push 시 win+mac 빌드 CI
