#!/usr/bin/env bash
# Останавливает процессы, запущенные scripts/dev-seed.sh. Трогает только те pid
# из /tmp/tte-dev-seed, чья командная строка совпадает (pid мог быть переиспользован).
set -uo pipefail

STATE_DIR="/tmp/tte-dev-seed"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
say() { [ "$QUIET" = 1 ] || echo "$*"; }

stop_one() { # name, pattern
  local pid_file="$STATE_DIR/$1.pid"
  [ -f "$pid_file" ] || { say "$1: не запущен"; return; }
  local pid; pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= | grep -q "$2"; then
    kill "$pid" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    say "$1: остановлен (pid $pid)"
  else
    say "$1: процесса $pid уже нет"
  fi
  rm -f "$pid_file"
}

stop_one backend "uvicorn app.main:app"
stop_one frontend "vite"
