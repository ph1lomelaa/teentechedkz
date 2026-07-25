#!/usr/bin/env bash
#
# Скачивает готовые дашборды с grafana.com в monitoring/dashboards/ и привязывает
# их к нашему источнику данных Prometheus (uid=prometheus). Grafana подхватит их
# автоматически (см. provisioning/dashboards/provider.yml).
#
# Запуск (один раз перед первым стартом Grafana, и когда захочешь обновить):
#   ./monitoring/fetch-dashboards.sh
#
# Дашборды не коммитятся в репо (см. .gitignore) — это сторонний контент,
# который легко перекачать этой командой.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${SCRIPT_DIR}/dashboards"
mkdir -p "${OUT_DIR}"

# id:имя_файла — популярные проверенные дашборды.
DASHBOARDS=(
  "1860:node-exporter-full.json"      # Node Exporter Full — CPU/RAM/диск/сеть хоста
  "14282:cadvisor.json"               # Cadvisor Exporter — метрики контейнеров
)

for entry in "${DASHBOARDS[@]}"; do
  id="${entry%%:*}"
  name="${entry##*:}"
  url="https://grafana.com/api/dashboards/${id}/revisions/latest/download"
  echo "Скачиваю дашборд ${id} -> ${name}"
  # Подменяем плейсхолдер источника данных на наш uid, чтобы дашборд сразу
  # рисовался без ручного выбора datasource.
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" | sed 's/\${DS_PROMETHEUS}/prometheus/g' > "${OUT_DIR}/${name}"
  else
    wget -qO- "${url}" | sed 's/\${DS_PROMETHEUS}/prometheus/g' > "${OUT_DIR}/${name}"
  fi
done

echo "Готово. Дашборды в ${OUT_DIR}. Перезапусти Grafana, если она уже запущена:"
echo "  docker compose -f monitoring/docker-compose.monitoring.yml restart grafana"
