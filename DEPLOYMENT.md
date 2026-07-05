# TeenTechEd Production Deploy

This setup uses:
- one domain: `https://teenteched.duckdns.org`
- Caddy as reverse proxy and TLS terminator
- Docker Compose for the whole stack

## Services

- `postgres`
- `redis`
- `minio`
- `backend`
- `frontend`
- `caddy`

## 1. Fill `.env`

Copy [`.env.example`](.env.example) to `.env` and fill the secrets.

Use these production values:

```env
FRONTEND_URL=https://teenteched.duckdns.org
ALLOWED_ORIGINS=https://teenteched.duckdns.org
VITE_API_URL=https://teenteched.duckdns.org
CADDY_EMAIL=you@example.com
TELEGRAM_WEBHOOK_URL=https://teenteched.duckdns.org/api/v1/telegram/webhook
```

The rest of the file keeps your app secrets:
- `JWT_SECRET_KEY`
- `PGCRYPTO_KEY`
- `FIRST_ADMIN_EMAIL`
- `FIRST_ADMIN_PASSWORD`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `NOTION_API_KEY`
- `NOTION_DATABASE_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_FILE`
- `DEEPGRAM_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

## 2. Open ports

Your VPS must allow:
- `80`
- `443`

Caddy will handle HTTPS automatically for `teenteched.duckdns.org`.

## 3. First deploy

On the server:

```bash
git clone https://github.com/ph1lomelaa/teenteched.git
cd teenteched
docker compose -f docker-compose.prod.yml up -d --build
```

If the repo is already cloned, just update it and run the same compose command:

```bash
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
```

## 4. What the stack does

- backend runs Alembic migrations
- backend seeds the first admin and base countries
- frontend is built with `VITE_API_URL=https://teenteched.duckdns.org`
- Caddy serves the frontend on `/`
- Caddy proxies `/api/*` and `/health` to the backend

## 5. Verify

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy
curl https://teenteched.duckdns.org/health
```

Open in browser:
- `https://teenteched.duckdns.org`

## 6. Updates

When you push to `main`, GitHub Actions will:
- build frontend
- validate backend syntax
- validate compose
- SSH into the server
- `git pull`
- run `docker compose -f docker-compose.prod.yml up -d --build --remove-orphans`

### Required GitHub secrets

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_PATH`

## 7. If it fails

Check:
- domain points to the VPS
- ports 80/443 are open
- Caddy logs
- backend logs
- `.env` has real secrets
