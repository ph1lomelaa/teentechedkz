#!/usr/bin/env bash
# Останавливает тестовую среду (проект tte-seed). С --purge удаляет и её тома.
# Работает только с проектом tte-seed; рабочие контейнеры и тома не затрагивает.
set -euo pipefail
# shellcheck source=scripts/seed-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/seed-lib.sh"

PURGE=0
for a in "$@"; do case "$a" in --purge) PURGE=1 ;; *) die "неизвестный флаг $a" ;; esac; done

seed_guard
if [ "$PURGE" = 1 ]; then
  "${COMPOSE[@]}" down --volumes --remove-orphans
  echo "Тестовая среда остановлена, тома проекта $SEED_PROJECT удалены."
else
  "${COMPOSE[@]}" down --remove-orphans
  echo "Тестовая среда остановлена (данные сохранены; удалить: scripts/seed-down.sh --purge)."
fi
