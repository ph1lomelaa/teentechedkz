#!/usr/bin/env bash
# Starts (or reuses) a local ngrok tunnel to the backend so Telegram can
# reach the webhook. Set NGROK_STATIC_DOMAIN in .env once you've claimed a
# free static domain in the ngrok dashboard, so TELEGRAM_WEBHOOK_URL never
# has to change again.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/.ngrok"
PID_FILE="$STATE_DIR/tunnel.pid"
LOG_FILE="$STATE_DIR/tunnel.log"
BACKEND_PORT="${BACKEND_PORT:-8001}"

mkdir -p "$STATE_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "ngrok already running (pid $(cat "$PID_FILE")). Nothing to do."
  exit 0
fi

if [ -f "$ROOT_DIR/.env" ]; then
  NGROK_STATIC_DOMAIN="$(grep -E '^NGROK_STATIC_DOMAIN=' "$ROOT_DIR/.env" | cut -d= -f2- || true)"
fi

if [ -n "${NGROK_STATIC_DOMAIN:-}" ]; then
  echo "Starting ngrok on port $BACKEND_PORT with static domain $NGROK_STATIC_DOMAIN..."
  nohup ngrok http "$BACKEND_PORT" --domain="$NGROK_STATIC_DOMAIN" > "$LOG_FILE" 2>&1 &
else
  echo "Starting ngrok on port $BACKEND_PORT (no NGROK_STATIC_DOMAIN set — URL will change on restart)..."
  nohup ngrok http "$BACKEND_PORT" > "$LOG_FILE" 2>&1 &
fi
echo $! > "$PID_FILE"
disown

sleep 2
PUBLIC_URL="$(curl -s http://127.0.0.1:4040/api/tunnels | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["tunnels"][0]["public_url"])' 2>/dev/null || true)"
if [ -n "$PUBLIC_URL" ]; then
  echo "Tunnel up: $PUBLIC_URL"
  echo "Set TELEGRAM_WEBHOOK_URL=$PUBLIC_URL/api/v1/telegram/webhook in .env, then restart backend."
else
  echo "ngrok started (pid $(cat "$PID_FILE")) but couldn't confirm the public URL yet — check $LOG_FILE"
fi

