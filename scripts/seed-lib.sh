# Общие проверки для seed-up.sh / seed-down.sh. Подключается через `source`.
# Главное правило: работаем ТОЛЬКО с compose-проектом tte-seed и его объектами.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED_PROJECT="tte-seed"
SEED_FILE="$ROOT_DIR/docker-compose.seed.yml"
# --env-file /dev/null: рабочий .env не читается даже для подстановки переменных.
COMPOSE=(docker compose --env-file /dev/null -p "$SEED_PROJECT" -f "$SEED_FILE" --profile ui)

# Имена рабочей среды, которых в тестовом compose быть не должно ни при каких условиях.
WORKING_NAMES_RE='^(tte_postgres|tte_backend|tte_worker|tte_frontend|tte_redis|tte_minio)$|^teentechedkz_|^teentechedkz-'

die() { echo "ОШИБКА: $*" >&2; exit 1; }

seed_guard() {
  command -v docker >/dev/null || die "не найден docker"
  docker info >/dev/null 2>&1 || die "Docker не запущен — откройте Docker Desktop."
  [ -f "$SEED_FILE" ] || die "нет $SEED_FILE"
  local cfg; cfg="$("${COMPOSE[@]}" config --format json)" || die "docker-compose.seed.yml не разобрался"
  SEED_CFG="$cfg" python3 - "$SEED_PROJECT" "$WORKING_NAMES_RE" <<'PY' || exit 1
import json, os, re, sys
project, bad = sys.argv[1], re.compile(sys.argv[2])
c = json.loads(os.environ["SEED_CFG"])
errs = []
if c.get("name") != project: errs.append(f"имя проекта {c.get('name')!r}, ожидалось {project!r}")
for svc, v in c["services"].items():
    n = v.get("container_name", "")
    if not n.startswith("tte_seed_") or bad.search(n): errs.append(f"сервис {svc}: контейнер {n!r}")
    if "env_file" in v: errs.append(f"сервис {svc}: env_file запрещён (рабочие ключи)")
    for p in v.get("ports", []):
        if str(p.get("published")) in ("8001", "5432", "6379", "3000", "9000", "9001"):
            errs.append(f"сервис {svc}: порт {p.get('published')} принадлежит рабочей среде")
    for vol in v.get("volumes", []):
        src = vol.get("source", "")
        real = c.get("volumes", {}).get(src, {}).get("name", src)
        if vol.get("type") == "volume" and not real.startswith(project + "_"): errs.append(f"сервис {svc}: том {real!r}")
for name, v in c.get("volumes", {}).items():
    if not v.get("name", "").startswith(project + "_"): errs.append(f"том {name}: {v.get('name')!r}")
for name, v in c.get("networks", {}).items():
    if not v.get("name", "").startswith(project + "_"): errs.append(f"сеть {name}: {v.get('name')!r}")
if errs:
    print("ОШИБКА: тестовый compose пересекается с рабочей средой — отказ:\n  " + "\n  ".join(errs), file=sys.stderr); sys.exit(1)
PY
}
