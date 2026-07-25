#!/usr/bin/env bash
#
# Ежедневный бэкап БД TeenTechEd CRM.
#
# Делает pg_dump из работающего postgres-контейнера, сжимает, кладёт локально,
# удаляет старые дампы и (опционально) выгружает копию off-site в MinIO.
#
# Запуск вручную:   ./scripts/backup.sh
# Cron (прод):       0 3 * * * /opt/teenteched/scripts/backup.sh >> /var/log/tte-backup.log 2>&1
#
# Настройки берутся из окружения или из .env рядом с репозиторием. Значения по
# умолчанию рассчитаны на docker-compose.prod.yml (container_name: tte_postgres_prod).
set -euo pipefail

# --- расположение репозитория (скрипт лежит в scripts/) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Подхватываем .env (POSTGRES_USER/DB, MINIO_* и т.п.), не затирая уже заданное окружение.
if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

# --- настройки ---
PG_CONTAINER="${PG_CONTAINER:-tte_postgres_prod}"
DB_USER="${POSTGRES_USER:-tte}"
DB_NAME="${POSTGRES_DB:-tte_db}"
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

# Off-site в MinIO. Пустой MINIO_BACKUP_BUCKET => выгрузка отключена.
# ВНИМАНИЕ: если MinIO живёт на том же сервере, это НЕ защищает от отказа диска.
# Для настоящего off-site укажи внешний S3-endpoint в переменных ниже.
MINIO_BACKUP_BUCKET="${MINIO_BACKUP_BUCKET:-db-backups}"
MINIO_CONTAINER="${MINIO_CONTAINER:-tte_minio_prod}"
MINIO_ALIAS_ENDPOINT="${MINIO_ALIAS_ENDPOINT:-http://localhost:9000}"
MINIO_ROOT_USER="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_SECRET_KEY:-minioadmin}"

TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
DUMP_NAME="tte_${DB_NAME}_${TIMESTAMP}.sql.gz"
DUMP_PATH="${BACKUP_DIR}/${DUMP_NAME}"

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"; }
die() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; exit 1; }

mkdir -p "${BACKUP_DIR}"

# --- проверки ---
command -v docker >/dev/null 2>&1 || die "docker не найден в PATH"
docker inspect "${PG_CONTAINER}" >/dev/null 2>&1 \
  || die "контейнер postgres '${PG_CONTAINER}' не найден (задай PG_CONTAINER)"

# --- дамп ---
log "Дамп БД '${DB_NAME}' из контейнера '${PG_CONTAINER}' -> ${DUMP_PATH}"
# --clean --if-exists делает дамп самодостаточным для восстановления поверх существующей схемы.
if ! docker exec "${PG_CONTAINER}" \
      pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists \
      | gzip -c > "${DUMP_PATH}.tmp"; then
  rm -f "${DUMP_PATH}.tmp"
  die "pg_dump завершился с ошибкой — дамп НЕ создан"
fi

# Пустой/битый дамп не должен подменять хороший — проверяем целостность gzip и размер.
if ! gzip -t "${DUMP_PATH}.tmp" 2>/dev/null; then
  rm -f "${DUMP_PATH}.tmp"
  die "получился битый gzip — дамп отброшен"
fi
MIN_BYTES="${BACKUP_MIN_BYTES:-1000}"
ACTUAL_BYTES="$(wc -c < "${DUMP_PATH}.tmp")"
if (( ACTUAL_BYTES < MIN_BYTES )); then
  rm -f "${DUMP_PATH}.tmp"
  die "дамп подозрительно мал (${ACTUAL_BYTES} байт < ${MIN_BYTES}) — отброшен"
fi

mv "${DUMP_PATH}.tmp" "${DUMP_PATH}"
log "Дамп готов: ${DUMP_PATH} ($(du -h "${DUMP_PATH}" | cut -f1))"

# --- off-site в MinIO (опционально) ---
if [[ -n "${MINIO_BACKUP_BUCKET}" ]] && docker inspect "${MINIO_CONTAINER}" >/dev/null 2>&1; then
  log "Выгрузка off-site в MinIO: ${MINIO_BACKUP_BUCKET}/${DUMP_NAME}"
  # Используем встроенный в образ minio/minio клиент mc внутри контейнера.
  if docker exec "${MINIO_CONTAINER}" sh -c "
        mc alias set tte '${MINIO_ALIAS_ENDPOINT}' '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' >/dev/null 2>&1 &&
        mc mb -p tte/'${MINIO_BACKUP_BUCKET}' >/dev/null 2>&1 || true
      " && docker exec -i "${MINIO_CONTAINER}" sh -c "
        cat > /tmp/${DUMP_NAME} && mc cp /tmp/${DUMP_NAME} tte/'${MINIO_BACKUP_BUCKET}/${DUMP_NAME}' && rm -f /tmp/${DUMP_NAME}
      " < "${DUMP_PATH}"; then
    log "Off-site копия загружена."
  else
    # Не валим весь бэкап из-за off-site — локальный дамп уже есть.
    log "WARN: off-site выгрузка в MinIO не удалась (локальный дамп сохранён)."
  fi
else
  log "Off-site выгрузка пропущена (MINIO_BACKUP_BUCKET пуст или контейнер '${MINIO_CONTAINER}' не найден)."
fi

# --- ротация ---
log "Удаляю локальные дампы старше ${RETENTION_DAYS} дней"
find "${BACKUP_DIR}" -name 'tte_*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete || true

# --- метрика для мониторинга ---
# Пишем метку времени успешного бэкапа в textfile-коллектор node_exporter.
# Prometheus увидит tte_backup_last_success_timestamp_seconds; алерт срабатывает,
# если бэкап не обновлялся дольше суток (см. monitoring/prometheus/alerts.yml).
TEXTFILE_DIR="${TEXTFILE_DIR:-${REPO_ROOT}/monitoring/textfile}"
if mkdir -p "${TEXTFILE_DIR}" 2>/dev/null; then
  PROM_FILE="${TEXTFILE_DIR}/backup.prom"
  {
    echo "# HELP tte_backup_last_success_timestamp_seconds Unix-время последнего успешного бэкапа БД."
    echo "# TYPE tte_backup_last_success_timestamp_seconds gauge"
    echo "tte_backup_last_success_timestamp_seconds $(date +%s)"
    echo "# HELP tte_backup_last_size_bytes Размер последнего дампа в байтах."
    echo "# TYPE tte_backup_last_size_bytes gauge"
    echo "tte_backup_last_size_bytes ${ACTUAL_BYTES}"
  } > "${PROM_FILE}.tmp" && mv "${PROM_FILE}.tmp" "${PROM_FILE}"
  log "Метрика бэкапа записана: ${PROM_FILE}"
fi

log "Готово."
