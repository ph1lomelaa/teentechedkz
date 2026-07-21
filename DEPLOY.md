# Деплой TeenTechEd — шпаргалка

Прод-сервер: `65.21.188.181` (Hetzner, Ubuntu 24.04), сайт: https://teenteched.duckdns.org

## Полный цикл деплоя

**1. На Mac'е — закоммитить и запушить изменения:**

```bash
git add -A
git commit -m "описание изменений"
git push
```

**2. Зайти на сервер:**

```bash
ssh root@65.21.188.181
```

**3. На сервере — обновить код и пересобрать:**

```bash
cd ~/teentechedkz
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Предупреждение `found orphan containers` — игнорировать.

## ⚠️ Важные правила

- **`COMPOSE_PROJECT_NAME=teenteched` должен всегда оставаться в `~/teentechedkz/.env` на сервере.**
  Без него compose создаст проект `teentechedkz` с новыми ПУСТЫМИ томами — база и файлы
  «пропадут» (на самом деле останутся в старых томах `teenteched_*`, но прод поднимется пустым).
- **Никогда не добавлять `--remove-orphans`** — на сервере крутятся другие проекты,
  можно снести чужой caddy/контейнеры.
- Данные живут в томах `teenteched_postgres_data` (база) и `teenteched_minio_data` (файлы).
  Их нельзя удалять.
- `google_service_account.json` не хранится в git — лежит только на сервере в `~/teentechedkz/`.
  При переносе на новый сервер копировать вручную.
- Старая папка деплоя `/home/deploy/teenteched` — устаревшая, деплоим из `~/teentechedkz`.

## Диагностика на сервере

```bash
# Статус контейнеров проекта
docker ps --filter name=tte_

# Логи backend (последние 100 строк, живой хвост)
docker logs tte_backend_prod --tail 100 -f

# Логи frontend / nginx
docker logs tte_frontend_prod --tail 100

# Перезапустить один сервис без пересборки
docker compose -f docker-compose.prod.yml restart backend

# Зайти внутрь backend-контейнера
docker exec -it tte_backend_prod sh

# Консоль Postgres
docker exec -it tte_postgres_prod psql -U tte -d tte_db
```

## Бэкап базы

```bash
# Сделать дамп (на сервере)
docker exec tte_postgres_prod pg_dump -U tte -Fc tte_db > ~/backup_tte_$(date +%F).dump

# Скачать дамп на Mac (выполнять на Mac'е)
scp root@65.21.188.181:~/backup_tte_*.dump ~/Downloads/

# Восстановить из дампа
docker exec -i tte_postgres_prod pg_restore -U tte -d tte_db --clean < ~/backup_tte_2026-07-21.dump
```

## Если сборка падает с «container name is already in use»

Значит, потерялся `COMPOSE_PROJECT_NAME=teenteched` в `.env` (или деплой идёт не из той папки).
НЕ удалять контейнеры — сначала вернуть строку в `.env` и повторить `up -d --build`.
