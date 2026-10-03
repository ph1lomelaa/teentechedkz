#!/usr/bin/env bash
# Одной командой поднимает тестовую среду: база tte_seed + сид + бэкенд :8099 +
# фронт :5173, смотрящий на этот бэкенд. Настоящие данные (контейнер на :8001)
# не затрагиваются. Остановка: scripts/dev-seed-stop.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="/tmp/tte-dev-seed"
BACKEND_PORT=8099
FRONTEND_PORT=5173
PY="$ROOT_DIR/.venv/bin/python"

DB_HOST="${DEV_SEED_DB_HOST:-127.0.0.1}"
DB_NAME="${DEV_SEED_DB_NAME:-tte_seed}"
DB_USER="${DEV_SEED_DB_USER:-$(whoami)}"
DB_PORT=5432
REDIS_DB=15

die() { echo "ОШИБКА: $*" >&2; exit 1; }

# --- защита: только локальная база с именем tte_seed ---------------------------
case "$DB_HOST" in 127.0.0.1|localhost) ;; *) die "хост БД «${DB_HOST}» не локальный — отказ." ;; esac
[ "$DB_NAME" = "tte_seed" ] || die "база должна называться tte_seed, а не «${DB_NAME}» — отказ."
[ -x "$PY" ] || die "нет $PY — создайте окружение: python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt"
[ -f "$ROOT_DIR/frontend/node_modules/vite/bin/vite.js" ] || die "нет frontend/node_modules — выполните: cd frontend && npm install"

# --- сервисы -------------------------------------------------------------------
command -v pg_isready >/dev/null || die "не найден pg_isready (нужен PostgreSQL): brew install postgresql@17"
pg_isready -q -h "$DB_HOST" -p "$DB_PORT" || die "Postgres не отвечает на $DB_HOST:$DB_PORT. Запустите: brew services start postgresql@17"
command -v redis-cli >/dev/null && [ "$(redis-cli -h 127.0.0.1 ping 2>/dev/null)" = "PONG" ] \
  || die "Redis не отвечает на 127.0.0.1:6379. Запустите: brew services start redis"

# --- прежние процессы: только свои, по pid-файлу ---------------------------------
mkdir -p "$STATE_DIR"
"$ROOT_DIR/scripts/dev-seed-stop.sh" --quiet || true

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
for p in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  port_busy "$p" && die "порт $p занят чужим процессом (lsof -nP -iTCP:$p -sTCP:LISTEN). Освободите его — этот скрипт чужое не убивает."
done

# --- база и схема --------------------------------------------------------------
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -v ON_ERROR_STOP=1 -q)
if ! "${PSQL[@]}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='tte_seed'" | grep -q 1; then
  echo "Создаю базу tte_seed…"
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE tte_seed"
fi
"${PSQL[@]}" -d tte_seed -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;" \
  || die "не удалось создать расширения pgcrypto/pg_trgm в tte_seed"

DB_URL="postgresql+asyncpg://$DB_USER@$DB_HOST:$DB_PORT/tte_seed"
export PYTHONPATH="$ROOT_DIR:$ROOT_DIR/backend"
# Та же схема, что на старте контейнера: create_all + stamp head (ничего не делает, если уже есть).
(cd "$ROOT_DIR/backend" && DATABASE_URL="$DB_URL" ENVIRONMENT=development "$PY" -m app.core.bootstrap_db) \
  >"$STATE_DIR/bootstrap.log" 2>&1 || { tail -20 "$STATE_DIR/bootstrap.log"; die "bootstrap_db не прошёл"; }
(cd "$ROOT_DIR/backend" && DATABASE_URL="$DB_URL" ENVIRONMENT=development "$PY" -m alembic upgrade head) \
  >>"$STATE_DIR/bootstrap.log" 2>&1 || { tail -20 "$STATE_DIR/bootstrap.log"; die "alembic upgrade head не прошёл"; }

echo "Заливаю тестовые данные (--reset)…"
SEED_OUT="$(SEED_DATABASE_URL="$DB_URL" "$PY" "$ROOT_DIR/backend/scripts/seed_access_requests.py" --reset)"

# --- бэкенд и фронт ------------------------------------------------------------
BACKEND_LOG=/tmp/tte-dev-seed-backend.log
FRONTEND_LOG=/tmp/tte-dev-seed-frontend.log
# `cd` вне фонового списка: иначе $! — pid подоболочки, а не самого процесса, и остановка промахнётся.
( cd "$ROOT_DIR"
  DATABASE_URL="$DB_URL" REDIS_URL="redis://127.0.0.1:6379/$REDIS_DB" ENVIRONMENT=development \
    nohup "$PY" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port "$BACKEND_PORT" \
    >"$BACKEND_LOG" 2>&1 &
  echo $! >"$STATE_DIR/backend.pid" )
# Напрямую node, а не npx: pid-файл должен указывать на сам vite, иначе остановка осиротит процесс.
( cd "$ROOT_DIR/frontend"
  VITE_LOCAL_API_PORT="$BACKEND_PORT" \
    nohup node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort \
    >"$FRONTEND_LOG" 2>&1 &
  echo $! >"$STATE_DIR/frontend.pid" )

wait_for() { # url, name, log
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$1" && return 0
    sleep 2
  done
  tail -15 "$3" >&2
  "$ROOT_DIR/scripts/dev-seed-stop.sh" --quiet || true
  die "$2 не поднялся за 2 минуты (лог: $3)"
}
wait_for "http://127.0.0.1:$BACKEND_PORT/api/v1/auth/google/config" "бэкенд" "$BACKEND_LOG"
wait_for "http://127.0.0.1:$FRONTEND_PORT/" "фронт" "$FRONTEND_LOG"

cat <<MSG

Тестовая среда готова (база tte_seed, НЕ настоящие данные).
  Адрес:   http://127.0.0.1:$FRONTEND_PORT/settings/access-requests
  Бэкенд:  http://127.0.0.1:$BACKEND_PORT   (логи: $BACKEND_LOG, $FRONTEND_LOG)
$(printf '%s\n' "$SEED_OUT" | sed -n '/^Логины/,/^$/p')
  Вверху страницы жёлтая плашка «ТЕСТОВАЯ БАЗА» — значит вы на сиде.
  Остановить: scripts/dev-seed-stop.sh
MSG
