#!/usr/bin/env bash
#
# Готовность базы к массовой самозаписи (/join).
#
# Авто-привязка ученика к карточке держится на одном совпадении — точном
# телефоне. Значит, качество завтрашней регистрации целиком определяется
# качеством колонки students.phone сегодня. Скрипт отвечает на три вопроса:
#
#   1. Скольким телефон вообще не даст сработать (пустой или короче 10 цифр).
#   2. У скольких карточек кабинет уже выдан — эти в авто-привязку не попадут.
#   3. Какие телефоны стоят у нескольких карточек — эти уйдут в ручную очередь
#      намеренно: угадывать между двумя карточками с одним номером нельзя.
#
# Только чтение: ничего не меняет. Прогнать ДО того, как раздавать ссылку.
#
# Запуск:  ./scripts/check-join-readiness.sh
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

psql() {
  docker exec -i "${PG_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 "$@"
}

echo "== Сводка по карточкам =="
psql <<'SQL'
SELECT
  count(*) AS "всего",
  count(*) FILTER (
    WHERE phone IS NULL OR length(regexp_replace(phone, '\D', '', 'g')) < 10
  ) AS "телефон непригоден",
  count(*) FILTER (WHERE user_id IS NOT NULL) AS "кабинет уже есть",
  count(*) FILTER (
    WHERE user_id IS NULL
      AND phone IS NOT NULL
      AND length(regexp_replace(phone, '\D', '', 'g')) >= 10
  ) AS "готовы к авто-привязке"
FROM students
WHERE is_archived = false;
SQL

echo
echo "== Телефоны на нескольких карточках (уйдут в ручную очередь) =="
psql <<'SQL'
SELECT
  right(regexp_replace(phone, '\D', '', 'g'), 10) AS "телефон",
  count(*) AS "карточек",
  string_agg(full_name, ' | ') AS "кто"
FROM students
WHERE is_archived = false
  AND phone IS NOT NULL
  AND length(regexp_replace(phone, '\D', '', 'g')) >= 10
GROUP BY 1
HAVING count(*) > 1
ORDER BY 2 DESC, 1
LIMIT 50;
SQL

echo
echo "== Карточки без пригодного телефона (этих придётся разбирать руками) =="
psql <<'SQL'
SELECT full_name AS "кто", coalesce(phone, '(пусто)') AS "телефон", intake_year AS "год"
FROM students
WHERE is_archived = false
  AND user_id IS NULL
  AND (phone IS NULL OR length(regexp_replace(phone, '\D', '', 'g')) < 10)
ORDER BY full_name
LIMIT 100;
SQL

echo
echo "Готово. «Готовы к авто-привязке» — те, кто завтра зайдёт сам, без админа."
