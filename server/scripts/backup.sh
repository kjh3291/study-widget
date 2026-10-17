#!/usr/bin/env bash
# Studeck 서버 백업: DB 덤프 + 개인 파일 볼륨을 ~/studeck/backups/<스택>/ 에 날짜별로 저장하고 14일치만 남긴다.
# 사용: server/scripts/backup.sh ~/studeck/prod   (crontab: 매일 새벽 4시)
set -euo pipefail
STACK=${1:?스택 폴더(예: ~/studeck/prod)}
NAME=$(basename "$STACK")
OUT="$HOME/studeck/backups/$NAME"
KEEP_DAYS=${KEEP_DAYS:-14}
STAMP=$(date +%Y%m%d-%H%M)
export DOCKER_HOST=${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}
mkdir -p "$OUT"; chmod 700 "$OUT"
cd "$STACK/server"
PROJECT=$(grep '^COMPOSE_PROJECT_NAME=' .env | cut -d= -f2)

docker compose exec -T db pg_dump -U studeck -d studeck --clean --if-exists | gzip > "$OUT/db-$STAMP.sql.gz.part"
mv "$OUT/db-$STAMP.sql.gz.part" "$OUT/db-$STAMP.sql.gz"
docker run --rm -v "${PROJECT}_filedata:/data:ro" -v "$OUT:/out" alpine:3 tar czf "/out/files-$STAMP.tar.gz.part" -C /data .
mv "$OUT/files-$STAMP.tar.gz.part" "$OUT/files-$STAMP.tar.gz"
chmod 600 "$OUT"/*-"$STAMP".*

find "$OUT" -name '*.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') 백업 완료: $OUT (db $(du -h "$OUT/db-$STAMP.sql.gz" | cut -f1), files $(du -h "$OUT/files-$STAMP.tar.gz" | cut -f1))"
