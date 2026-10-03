#!/usr/bin/env bash
# Поднимает изолированную тестовую среду в Docker (проект tte-seed): Postgres
# tte_seed + Redis + бэкенд :8099 (+ фронт :5173), заливает сид и проверяет API.
# Рабочие контейнеры (tte_backend, tte_postgres, …) и их данные не трогаются.
#   scripts/seed-up.sh                  # Postgres + Redis + бэкенд :8099
#   scripts/seed-up.sh --with-frontend  # + фронт в Docker на :5173 (тяжёлый: node_modules и Vite
#                                       #   на смонтированных файлах; на машине с малой памятью лучше
#                                       #   запускать фронт на хосте: VITE_LOCAL_API_PORT=8099 npm run dev)
set -euo pipefail
# shellcheck source=scripts/seed-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/seed-lib.sh"

WITH_UI=0
for a in "$@"; do case "$a" in --with-frontend) WITH_UI=1 ;; *) die "неизвестный флаг $a" ;; esac; done

seed_guard
PY="$ROOT_DIR/.venv/bin/python"
[ -x "$PY" ] || die "нет $PY (окружение нужно для сид-скрипта): python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt"

# Порты: заняты чужими процессами — отказ (свои контейнеры проекта пересоздадутся).
own_ports="$(docker ps --filter "label=com.docker.compose.project=$SEED_PROJECT" --format '{{.Ports}}' 2>/dev/null || true)"
ports=(8099 55432); [ "$WITH_UI" = 1 ] && ports+=(5173)
for p in "${ports[@]}"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && ! grep -q ":$p->" <<<"$own_ports"; then
    die "порт $p занят не тестовой средой (lsof -nP -iTCP:$p -sTCP:LISTEN). Освободите его; чужое скрипт не трогает."
  fi
done

SERVICES=(postgres redis backend); [ "$WITH_UI" = 1 ] && SERVICES+=(frontend)
echo "Собираю и поднимаю проект $SEED_PROJECT (${SERVICES[*]})…"
"${COMPOSE[@]}" up -d --build "${SERVICES[@]}"

echo "Жду бэкенд (схема + миграции при старте)…"
ready=0
for _ in $(seq 1 90); do
  curl -s -o /dev/null "http://127.0.0.1:8099/api/v1/auth/google/config" && { ready=1; break; }
  sleep 2
done
if [ "$ready" != 1 ]; then
  "${COMPOSE[@]}" logs --tail 40 backend >&2
  die "бэкенд не поднялся за 3 минуты"
fi

echo "Заливаю сид (--reset)…"
SEED_DATABASE_URL="postgresql+asyncpg://seed:seed@127.0.0.1:55432/tte_seed" \
  PYTHONPATH="$ROOT_DIR:$ROOT_DIR/backend" "$PY" "$ROOT_DIR/backend/scripts/seed_access_requests.py" --reset >/tmp/tte-seed-up.seed.log \
  || { cat /tmp/tte-seed-up.seed.log >&2; die "сид не прошёл"; }

echo "Проверяю API под тестовым admin…"
count="$(python3 - <<'PY'
import json, urllib.request
B = "http://127.0.0.1:8099/api/v1"
def call(path, body=None, tok=None):
    h = {"Content-Type": "application/json", **({"Authorization": "Bearer " + tok} if tok else {})}
    r = urllib.request.Request(B + path, data=json.dumps(body).encode() if body else None, headers=h)
    return json.load(urllib.request.urlopen(r))
tok = call("/auth/login", {"email": "admin@seed.teenteched.test", "password": "SeedAdmin#2026"})["access_token"]
print(len(call("/access-requests", tok=tok)["items"]))
PY
)" || die "не удалось получить /access-requests под admin@seed.teenteched.test"
[ "$count" = "13" ] || die "ожидалось 13 заявок, получено $count"

if [ "$WITH_UI" = 1 ]; then
  echo "Жду фронт (первый запуск ставит node_modules, это 1–2 минуты)…"
  ok=0
  for _ in $(seq 1 120); do curl -s -o /dev/null "http://127.0.0.1:5173/" && { ok=1; break; }; sleep 2; done
  [ "$ok" = 1 ] || { "${COMPOSE[@]}" logs --tail 30 frontend >&2; die "фронт не поднялся"; }
fi

cat <<MSG

Тестовая среда готова (Docker-проект $SEED_PROJECT, база tte_seed — НЕ настоящие данные). Заявок: $count.
  Бэкенд:  http://127.0.0.1:8099
  Фронт:   $([ "$WITH_UI" = 1 ] && echo "http://127.0.0.1:5173/settings/access-requests" || echo "не запущен: cd frontend && VITE_LOCAL_API_PORT=8099 npm run dev -- --host 127.0.0.1 --port 5173")
$(sed -n '/^Логины/,/^$/p' /tmp/tte-seed-up.seed.log)
  Вверху страницы жёлтая плашка «ТЕСТОВАЯ БАЗА».
  Остановить: scripts/seed-down.sh   (с удалением данных: scripts/seed-down.sh --purge)
MSG
