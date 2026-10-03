#!/usr/bin/env bash
# Restore a production dump into a disposable, network-isolated PostgreSQL
# container. This script never connects to or modifies the source database.
set -euo pipefail

DUMP_FILE="${1:?Использование: $0 backups/backup.sql.gz}"
[[ -f "$DUMP_FILE" ]] || { echo "Дамп не найден: $DUMP_FILE" >&2; exit 1; }
command -v docker >/dev/null || { echo "Нужен Docker" >&2; exit 1; }
if [[ "$DUMP_FILE" == *.gz ]]; then gzip -t "$DUMP_FILE"; fi

IMAGE="${POSTGRES_VERIFY_IMAGE:-postgres:15-alpine}"
CONTAINER="tte-backup-verify-$$"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$CONTAINER" --network none \
  -e POSTGRES_USER=verify -e POSTGRES_DB=verify -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$IMAGE" >/dev/null
for _ in {1..40}; do
  if docker exec "$CONTAINER" pg_isready -U verify -d verify >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U verify -d verify >/dev/null
docker exec "$CONTAINER" psql -U verify -d verify -v ON_ERROR_STOP=1 \
  -c 'CREATE ROLE tte;' >/dev/null
docker exec "$CONTAINER" psql -U verify -d verify -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;' >/dev/null

if [[ "$DUMP_FILE" == *.gz ]]; then
  gzip -dc "$DUMP_FILE" | docker exec -i "$CONTAINER" psql -U verify -d verify -v ON_ERROR_STOP=1 >/dev/null
else
  docker exec -i "$CONTAINER" psql -U verify -d verify -v ON_ERROR_STOP=1 < "$DUMP_FILE" >/dev/null
fi

docker exec "$CONTAINER" psql -U verify -d verify -v ON_ERROR_STOP=1 -Atc \
  "SELECT 'students=' || count(*) FROM students
   UNION ALL SELECT 'contracts=' || count(*) FROM contracts
   UNION ALL SELECT 'mentor_assignments=' || count(*) FROM mentor_assignments
   UNION ALL SELECT 'notion_snapshots=' || count(*) FROM notion_snapshots"
echo 'Проверка восстановления прошла; временная база будет удалена.'
