#!/usr/bin/env bash
# Studeck 서버 복구: backup.sh가 만든 DB 덤프 + 개인 파일 묶음으로 스택(prod|lab)을 그 시점으로 되돌린다.
#
# 사용:
#   server/scripts/restore.sh ~/studeck/lab --check            # 가장 최근 백업이 멀쩡한지만 확인(아무것도 바꾸지 않음)
#   server/scripts/restore.sh ~/studeck/lab --check 20261103-0400
#   server/scripts/restore.sh ~/studeck/lab [STAMP]            # 복구(STAMP 없으면 가장 최근). 스택 이름을 입력해야 진행
#
# 복구 순서: 백업 파일 검사 → 확인 입력 → 지금 상태를 한 번 더 백업(되돌릴 수 있게) → api 정지
#            → DB 복원(한 트랜잭션, 실패하면 아무것도 안 바뀜) → 파일 볼륨 복원 → api 시작 → 상태 확인
# 복구 리허설은 실험실에서만: lab 백업 → 시험 계정 하나 만들기 → 그 백업으로 복구 → 계정이 사라졌는지 확인.
set -euo pipefail
STACK=${1:?스택 폴더(예: ~/studeck/lab)}
shift
CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then CHECK_ONLY=1; shift; fi
STAMP=${1:-}
NAME=$(basename "$STACK")
IN="$HOME/studeck/backups/$NAME"
export DOCKER_HOST=${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}
cd "$STACK/server"
PROJECT=$(grep '^COMPOSE_PROJECT_NAME=' .env | cut -d= -f2)

# 1. 어느 백업인지 정하고 검사
if [[ -z "$STAMP" ]]; then
  STAMP=$(ls -1 "$IN"/db-*.sql.gz 2>/dev/null | sed -E 's/.*db-([0-9]{8}-[0-9]{4})\.sql\.gz/\1/' | sort | tail -1)
  [[ -n "$STAMP" ]] || { echo "백업이 없습니다: $IN"; exit 1; }
fi
DB="$IN/db-$STAMP.sql.gz"; FILES="$IN/files-$STAMP.tar.gz"
[[ -f "$DB" && -f "$FILES" ]] || { echo "백업 파일이 없습니다: $DB / $FILES"; exit 1; }
gzip -t "$DB" || { echo "DB 덤프가 깨졌습니다: $DB"; exit 1; }
NFILES=$(tar tzf "$FILES" | grep -vc '/$' || true)
NUSERS=$(gunzip -c "$DB" | awk '/^COPY public.users /{on=1;next} on&&/^\\\.$/{on=0} on{n++} END{print n+0}')
NROWS=$(gunzip -c "$DB" | awk '/^COPY public.files /{on=1;next} on&&/^\\\.$/{on=0} on{n++} END{print n+0}')
echo "백업 $NAME $STAMP: 회원 $NUSERS명, 파일 기록 $NROWS개, 파일 내용 $NFILES개 (db $(du -h "$DB" | cut -f1), files $(du -h "$FILES" | cut -f1))"
if [[ $CHECK_ONLY == 1 ]]; then echo "검사만 했습니다. 바뀐 것 없음."; exit 0; fi

# 2. 확인 입력(실수로 운영을 덮지 않게)
[[ "$NAME" == "prod" ]] && echo "⚠️  운영(prod) 스택입니다. 지금 동아리원이 쓰는 데이터가 $STAMP 시점으로 돌아갑니다."
read -r -p "되돌리려면 스택 이름($NAME)을 입력하세요: " ANSWER
[[ "$ANSWER" == "$NAME" ]] || { echo "취소했습니다."; exit 1; }

# 3. 지금 상태를 먼저 백업(복구를 되돌릴 수 있게)
"$(dirname "$0")/backup.sh" "$STACK"

# 4~6. api를 멈추고 DB·파일 복원
docker compose stop api
# pg_dump --clean --if-exists 덤프라 기존 표를 지우고 다시 만든다. 한 트랜잭션이라 중간에 실패하면 원래대로.
gunzip -c "$DB" | docker compose exec -T db psql -q -U studeck -d studeck -v ON_ERROR_STOP=1 --single-transaction >/dev/null
docker run --rm -v "${PROJECT}_filedata:/data" -v "$IN:/in:ro" alpine:3 \
  sh -c "find /data -mindepth 1 -delete && tar xzf /in/files-$STAMP.tar.gz -C /data"
docker compose start api

# 7. 상태 확인
BIND_IP=$(grep '^BIND_IP=' .env | cut -d= -f2); API_PORT=$(grep '^API_PORT=' .env | cut -d= -f2)
for _ in $(seq 1 30); do
  if curl -fsS "http://$BIND_IP:$API_PORT/health" >/dev/null 2>&1; then
    echo "$(date '+%F %T') 복구 완료: $NAME ← $STAMP. 회원 수 $(docker compose exec -T db psql -U studeck -d studeck -At -c 'select count(*) from users')명"
    exit 0
  fi
  sleep 2
done
echo "api가 응답하지 않습니다. docker compose logs api 를 확인하세요."; exit 1
