# 인수인계 (윈도우 → 맥) — 2026-10-03

> 맥 Claude: `git pull` 후 이 문서부터 읽고 순서대로 진행해 주세요. 끝나면 이 파일은 삭제하거나 결과로 갱신해 주세요.

## 요약
맥과 윈도우의 **할 일·시간표가 서로 다르다.** 원인은 공유 데이터 동기화가 "마지막에 저장한 기기가 통째로 이기는" 방식이기 때문이다. **PR #4(`sync-reliability`)가 바로 이 문제를 고친다.** 맥에서 PR #4 병합 → v1.3.2 릴리스 → 맥 설치 순서로 진행한다. 단, **맥 데이터 백업이 먼저다.**

## 윈도우 쪽 현재 상태
- 설치 버전: **v1.3.1** (2026-10-03 설치). 동기화 정상(새 토큰으로 인증 OK).
- 공유 데이터(`studeck-data/.studeck/config.json`) = 윈도우 데이터와 동일: 할 일 25개(미완료 9), 일정 2개, 시간표 8과목(`timetableSource: everytime`), 마지막 업로드 `2026-10-03T12:44Z`.
- 윈도우에서 PR #4 `npm test` 실행 → **16개 모두 PASS** (`test:ui`는 PR의 Windows/macOS CI 결과로 갈음).
- 윈도우에서는 이 작업이 끝날 때까지 코드 수정·할 일 편집을 하지 않는다(한 번에 한 기기 규칙).

## 원인 (studeck-data 커밋 기록 분석)
1. 윈도우가 10/3까지 **v1.2.4**였다. v1.2.4는 공유 항목 11개만 올리고 `timetableFull`·설정을 빼고 썼다. 맥(v1.3.x)은 23개를 썼다. 그래서 기록상 시간표가 `8과목 → 0 → 8과목 → 0`으로 번갈아 덮어써졌다.
2. v1.3.1의 `initSync`/`applySharedState`는 `_syncedAt`이 더 큰 쪽의 스냅샷을 **통째로** 적용한다. 다른 기기에서 아직 안 올린 변경은 받아오는 순간 사라진다.
3. **맥의 마지막 업로드는 2026-10-01 17:46(KST).** 그 뒤 맥에서 바꾼 할 일·시간표 추가분은 GitHub에 없다. 맥 위젯이 꺼져 있었거나, `.studeck/config.json` 병합 충돌로 동기화가 멈췄을 가능성이 있다. 설정 → 동기화 메시지와 `~/Desktop/Studeck`의 `git status`를 확인할 것.

## 맥에서 할 일 (순서 중요)
### 0. 데이터 보호 — 가장 먼저
v1.3.1 상태로 동기화되면 윈도우의 더 최신 스냅샷이 맥에만 있는 할 일·시간표를 덮어쓸 수 있다.
```bash
cp ~/Library/Application\ Support/everytime-widget/config.json ~/Desktop/studeck-mac-backup.json
git -C ~/Desktop/Studeck status
git -C ~/Desktop/Studeck log --oneline -5
```
- 경로가 다르면 `ls ~/Library/Application\ Support/`로 찾는다(윈도우는 productName과 무관하게 `everytime-widget`이었다).
- 이미 덮어써졌다면 복구 경로: 위 백업 파일, `~/Desktop/Studeck`의 로컬 커밋(동기화는 pull 전에 로컬 상태를 먼저 커밋함), `userData/backups/`.

### 1. PR #4 병합
- https://github.com/kjh3291/study-widget/pull/4 — 현재 충돌 없이 병합 가능(mergeable: clean).
- 병합 후 `git pull`, `npm test` 재확인.

### 2. v1.3.2 릴리스
- `git tag | sort -V | tail` 로 최신이 `v1.3.1`인지 확인 → `package.json` 버전 `1.3.2` → 커밋 → `git tag v1.3.2 && git push origin v1.3.2`.
- CI(Release)가 윈도우·맥 빌드를 끝내면 릴리스를 Publish.

### 3. 맥에 v1.3.2 설치 후 확인
- 옛 앱을 완전히 종료(⌘Q) 후 설치·실행.
- 확인할 것:
  - 맥에만 있던 할 일이 남아 있고, 윈도우 할 일 25개도 함께 보이는지.
  - 맥에서 추가한 시간표가 유지되는지. 이후 공유 파일에 올라갔는지는 `studeck-data`의 `.studeck/config.json`에서 `timetableFull` 확인.
  - 충돌 선택 창이 뜨면 사용자에게 어느 쪽을 남길지 물어볼 것.
- 결과(특히 맥에만 있던 항목이 무엇이었는지)를 이 파일에 적어 push.

### 4. 윈도우는 그 다음
맥 확인이 끝나면 사용자가 윈도우에서 v1.3.2를 설치한다(윈도우 Claude가 설치 가능).

## 남은 개선 (선택)
- PR #4의 병합 모델에서 `timetableFull`은 항목에 `id`가 없어 **과목 단위로 합치지 않는다.** 한 기기만 바꾸면 그대로 반영되지만, 양쪽 모두 바꾸면 통째로 하나를 고르는 충돌이 된다. 사용자가 "시간표도 동기화 잘 되게"를 원하므로 과목/수업 단위 `id` 부여나 과목명 기준 병합을 검토할 것.

## 지키는 것
- 토큰·비밀번호는 코드·이슈·커밋에 넣지 않는다.
- 커밋 끝에 `Co-Authored-By` 라인. 맥 전용 변경은 `[mac]` 태그.
