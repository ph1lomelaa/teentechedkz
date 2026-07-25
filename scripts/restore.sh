#!/usr/bin/env bash
#
# Восстановление БД TeenTechEd CRM из дампа, созданного scripts/backup.sh.
#
# ВНИМАНИЕ: перезаписывает данные в целевой БД. Дампы делаются с --clean --if-exists,
# поэтому существующие таблицы будут удалены и созданы заново из дампа.
#
# Использование:
#   ./scripts/restore.sh backups/tte_tte_db_2026-07-25_030000.sql.gz
#
# Перед восстановлением на проде ОБЯЗАТЕЛЬНО сделай свежий бэкап текущего
# состояния (./scripts/backup.sh) — на случай, если восстанавливаешь не тот дамп.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

PG_CONTAINER="${PG_CONTAINER:-tte_postgres_prod}"
DB_USER="${POSTGRES_USER:-tte}"
DB_NAME="${POSTGRES_DB:-tte_db}"

die() { echo "ERROR: $*" >&2; exit 1; }

DUMP_FILE="${1:-}"
[[ -n "${DUMP_FILE}" ]] || die "укажи путь к дампу: ./scripts/restore.sh <файл.sql.gz>"
[[ -f "${DUMP_FILE}" ]] || die "файл не найден: ${DUMP_FILE}"
command -v docker >/dev/null 2>&1 || die "docker не найден в PATH"
docker inspect "${PG_CONTAINER}" >/dev/null 2>&1 \
  || die "контейнер postgres '${PG_CONTAINER}' не найден (задай PG_CONTAINER)"

echo "!!! ВНИМАНИЕ: сейчас будет ПЕРЕЗАПИСАНА база '${DB_NAME}' в контейнере '${PG_CONTAINER}'"
echo "    из дампа: ${DUMP_FILE}"
read -r -p "Продолжить? Введи 'yes' для подтверждения: " CONFIRM
[[ "${CONFIRM}" == "yes" ]] || die "отменено пользователем"

echo "Восстанавливаю..."
# Расширения (pgcrypto/pg_trgm) должны существовать до восстановления данных.
docker exec -i "${PG_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;" >/dev/null

if [[ "${DUMP_FILE}" == *.gz ]]; then
  gunzip -c "${DUMP_FILE}" | docker exec -i "${PG_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1
else
  docker exec -i "${PG_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 < "${DUMP_FILE}"
fi

echo "Готово. Перезапусти бэкенд, если он был запущен во время восстановления:"
echo "  docker compose -f docker-compose.prod.yml restart backend worker"
