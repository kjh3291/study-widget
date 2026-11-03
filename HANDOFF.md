# 인수인계 — 2026-11-03 (클라우드 세션 → PC 세션)

> PC 세션은 이 문서를 먼저 읽고 **위에서부터 순서대로** 진행한다. 각 단계 끝의 ✅ 조건을 확인하고, 실패하면 다음 단계로 넘어가지 말고 사용자에게 알린다.
> 서버 주소·계정·.env 값은 이 문서와 저장소에 적지 않는다(공개 저장소). 이전 인수인계(10/05)는 git 기록에 있다.

## 목표
동아리 오픈 **11/12~15** 전에 실험실 변경을 운영에 반영하고, 다운로드 페이지에서 새 버전을 받을 수 있게 한다.
- 권장 일정: 1~2단계 **11/6까지**, 3~5단계 **11/9까지**, 6단계 **11/10까지**, 7단계 **오픈 당일**.

## 지금 상태
- `lab` = `main` + 커밋 여러 개(아래, `git log origin/main..lab`). `main`은 `83e1808`(v1.4.0)에 머물러 있다.
- ⚠️ **GitHub에 v1.4.0 태그·릴리스가 없다**(마지막 태그 v1.3.4). 다운로드 페이지는 GitHub 최신 릴리스를 읽으므로, 새 버전 릴리스를 **게시(Publish)** 해야 오픈 날 받을 파일이 생긴다.
- 클라우드에서 확인한 것: `npm test` 32개 통과. 로컬 PostgreSQL로 띄운 서버에서 `test-server-files`·`test-file-sync`·`test-server-sync` 통과, **예전 앱(v1.4.0)의 파일 동기화도 바뀐 서버에서 파일을 지우거나 다시 올리지 않음** 확인.
- 클라우드에서 못 한 것: 실험실·운영 서버 배포, `test-server-community/rooms/focus/positions`·`test-lab-*`(서버 주소·SSH 고정), Electron 빌드·실행, 실제 충북대 LMS 로그인 창에서 학번 채우기.

### lab에만 있는 변경(운영 반영 대상)
| 커밋 | 내용 | 서버 변경 |
|---|---|---|
| 3f72274 · 7498e1d | 직책(부원·임원·회장)·관리자 권한 분리, 임원 신청, 문의하기, 시간표 가독성 | 있음(직책·문의) |
| 652d001 · 35ede9b | LMS 같은 이름 자료 덮어쓰기 수정, 로그인 만료 안내 띠, 공지 목록 깨짐 | 없음 |
| cefbec8 | 수업자료 중복 저장 방지(같은 내용이면 사본 안 만듦) | 없음 |
| b4b9b28 | LMS 공지 A안(안 읽음 점, 날짜, 제목에서 읽은 마감 D-day 칩) | 없음 |
| 585fdaa | LMS 로그인 창 학번 기억(학번만, 이 기기에만) | 없음 |
| f0dd0a5 | 자료 저장 위치 지정(이슈 #9) | 없음 |
| 978ee3c · 05947e0 · 17f2d05 | LMS 항목 직접 완료(확인창), 시간표 우클릭 메뉴, 내 자료 GPT 디자인 적용, 정리 안내 짧은 문구 | 없음 |
| c3006c0 · 779252c | **서버엔 보조자료만**(과제도 로컬), **학기 정리**(종강+30일 뒤 서버에서 삭제, 기기 파일 유지)와 알림, 내 자료 폴더 화면 | **있음(files 열 추가, 정리 작업)** |

## 1단계 — 실험실 서버 배포
```bash
git fetch origin && git checkout lab && git pull origin lab
npm ci && npm test
```
서버에 접속해서(실험실 스택):
```bash
cd ~/studeck/lab && git pull
cd server && docker compose up -d --build
docker compose logs --tail=30 api
```
- `.env`에 `TERM_ENDS`·`TERM_GRACE_DAYS`가 없어도 기본값(06-30,12-31 / 30일)으로 돈다. 바꿀 때만 `server/.env.example`을 보고 추가.
- DB 열(`files.stored_at`, `files.expired`)은 시작할 때 자동으로 추가된다(`ALTER ... IF NOT EXISTS`).
- ✅ 로그에 오류 없음, `/health`가 `{"ok":true,"channel":"lab"}`.

## 2단계 — 실험실 자동 테스트
```bash
npm run test:server
npm run test:ui
```
- `test-server-files`에 학기 정리, `test-file-sync`에 "보조자료만·예전 과제 그대로·학기 정리" 시험이 추가됐다(`POST /files/expire-now`는 실험실 채널에서만 열림).
- ✅ 전부 PASS, 끝에 `lab-cleanup`이 시험 계정을 정리.

## 3단계 — Studeck Lab으로 직접 확인(사용자와 함께)
```bash
npm run dist:lab
```
기존 Lab 앱을 트레이까지 완전히 종료하고 설치한 뒤 확인한다:
- [ ] LMS 탭: 공지 줄 모양(안 읽음 점·굵게, 날짜, 마감 칩), 과목 묶음 머리의 가장 가까운 마감 칩
- [ ] LMS 로그인 → 다시 로그인 창을 열면 **아이디 칸에 학번이 채워짐**(비밀번호 칸은 비어 있어야 함). 설정 › LMS에 `2023****34`처럼 가려진 학번이 보임. 안 채워지면 로그인 창 아이디 칸의 `name`/`id`를 확인해 `lms-remember.js`의 선택자에 추가
- [ ] LMS 새로고침 뒤 수업자료 폴더에 같은 내용의 `(2)` 사본이 새로 생기지 않음
- [ ] 설정 › 파일 › 자료 저장 위치: 폴더를 고르고 새로고침 → 그 폴더에 받아짐. 기본으로 되돌리기 가능
- [ ] 설정 › 파일 › 내 자료: 과목 › 보조자료·수업자료·과제 탐색, 파일 열기·폴더에서 보기
- [ ] 보조자료에 넣은 파일은 다른 기기(맥 Lab)에 공유되고, **과제 파일은 공유되지 않음**
- [ ] 오늘: 제출이 없는 LMS 항목 체크 → '완료로 바꿀까요?' 확인창 → 목록에서 빠짐, 완료한 일에서 체크를 풀면 되돌아옴
- [ ] 시간표 수업 우클릭: LMS 과목 페이지·폴더들·집중 시작 메뉴, 시간표 이름과 LMS 이름이 띄어쓰기만 달라도 같은 과목으로 열림
- [ ] 오늘 화면 '시작하기' 카드: 새 프로필(설정 없는 상태)에서 보이고, LMS 로그인·시간표·할 일을 하면 저절로 체크, 닫기로 사라짐
- [ ] 운영진 관리 › 저장 공간: 전체·회원별 사용량, 서버 디스크, 할당량을 다 쓰면 모자라는지 경고
- [ ] 내 자료(GPT 디자인): 다크·라이트에서 모양, 실제 파일 크기·수정일, 열기·폴더에서 보기
- [ ] 동아리 탭: 직책·임원 신청·문의하기(지난번 변경)
- ✅ 사용자가 "운영에 반영해도 된다"고 확인.

### 3-1. 복구 리허설(실험실, 10분)
```bash
~/studeck/lab/server/scripts/backup.sh ~/studeck/lab
~/studeck/lab/server/scripts/restore.sh ~/studeck/lab --check      # 회원·파일 수가 맞는지
```
Studeck Lab에서 할 일 하나를 추가·동기화한 뒤 `restore.sh ~/studeck/lab`(스택 이름 `lab` 입력) → 그 할 일이 사라졌으면 복구 성공. 다시 원래대로 하려면 복구 직전에 자동으로 만든 백업으로 한 번 더 복구.
- ✅ 운영 반영 전에 "백업에서 되돌릴 수 있다"를 확인.

## 4단계 — 운영 서버 반영(사용자 확인 후에만)
서버에 접속해서 **백업 먼저**:
```bash
~/studeck/prod/server/scripts/backup.sh ~/studeck/prod
~/studeck/prod/server/scripts/restore.sh ~/studeck/prod --check   # 방금 백업이 멀쩡한지(바꾸는 것 없음)
ls -lh ~/studeck/backups/prod | tail -3
```
PC에서 main을 lab으로 fast-forward:
```bash
git checkout main && git pull origin main
git merge --ff-only lab
git push origin main
```
서버에서 운영 스택 배포:
```bash
cd ~/studeck/prod && git pull
cd server && docker compose up -d --build
docker compose logs --tail=30 api
```
- 서버를 앱보다 먼저 올려도 된다(예전 앱 v1.4.0과 맞물리는 것을 확인함). 예전 앱이 올려 둔 과제 파일은 그대로 있다가 학기 정리 때 사라진다.
- 서버 용량을 늘렸으면 운영 `.env`의 `QUOTA_MB`를 정하고 `docker compose up -d`.
- ✅ 운영 `/health` 정상, 윈도우의 지금 운영 앱(v1.4.0)이 평소처럼 동기화됨.

## 5단계 — 새 버전 릴리스
```bash
git pull origin main
git tag | sort -V | tail -3        # 번호 겹치지 않게 확인
```
- 버전: **1.5.0 권장**(기능이 많고 서버 변경 포함). `package.json`의 `version`만 바꾼다.
```bash
git commit -am "v1.5.0: LMS 공지 개편·학번 기억·자료 저장 위치·보조자료만 서버(학기 정리)·내 자료"
git push origin main
git tag v1.5.0 && git push origin v1.5.0
```
- 태그를 올리면 GitHub Actions가 윈도우 exe·맥 dmg/zip을 빌드해 **초안(draft) 릴리스**를 만든다.
- ✅ Actions 성공, 릴리스 초안에 `StudyWidget-1.5.0-Setup.exe`, `StudyWidget-1.5.0-mac-arm64.dmg`(그리고 x64)가 있음.

### 새 버전 업그레이드에 대해
- 이번 버전(v1.5.0)부터 앱에 업그레이드 기능이 들어간다. **v1.4.0 → v1.5.0은 한 번 손으로 설치**해야 하고, 그다음 릴리스부터 윈도우는 오늘 화면 띠의 '업그레이드'로 받아서 설치·재시작된다(맥은 내려받기 페이지가 열림, Apple 서명이 없어서 자동 설치 불가).
- 확인 방법: v1.5.0 게시 뒤 아주 작은 수정으로 v1.5.1을 태그·게시 → 윈도우 v1.5.0에서 20초쯤 뒤 띠가 뜨고, 누르면 받아서 다시 시작되는지. 초안(draft)은 안 보이고 Publish한 것만 보인다.

## 6단계 — 설치 확인 후 릴리스 게시
- 윈도우: 운영 앱 완전 종료 → 새 Setup.exe 설치 → 로그인 상태·할 일·시간표·보조자료 그대로인지.
- 맥: dmg 설치 → 실행(처음엔 macOS 확인 창) → 같은 계정으로 동기화.
- ✅ 둘 다 문제없으면 GitHub 릴리스 초안을 **Publish**. (초안은 다운로드 페이지에 안 뜬다)

## 7단계 — 오픈 당일: 다운로드 페이지 열기
운영 서버 `.env`의 `DOWNLOAD_MIN_VERSION`을 게시한 버전(예: `1.5.0`)으로 바꾸고:
```bash
cd ~/studeck/prod/server && docker compose up -d
```
- ✅ 운영 주소 첫 화면에서 "내려받기" 버튼이 보이고 윈도우·맥 파일로 연결됨.

## 끝나면
- 이슈 #9(수업자료 저장 위치·중복)는 운영 반영 뒤 닫는다. `material-location` 브랜치는 lab에 옮겨 넣었으므로 지워도 된다(사용자 확인 후).
- 이 문서의 진행 상황을 갱신하거나, 다 끝났으면 "완료"로 바꿔 커밋한다.

## 참고 문서
- 동아리원 안내문: `docs/club-guide.md` (오픈 공지에 붙이기, 다운로드 주소는 공지에 직접)
- 사용 시나리오(화면 캡처 모음)는 claude.ai 아티팩트로 사용자에게 공유됨

## 오픈 뒤 할 일(급하지 않음)
칭호·배지 시스템, 출석 상태 호환(5개 ↔ 4개), 내 자료 화면 GPT 디자인(`docs/design-requests/my-files.md`), 웹 버전, GitHub 동기화 코드 제거(운영 전환 1주 경과 — 사용자 확인 후).
