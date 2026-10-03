# Attendee: бот для записи встреч

Attendee — открытый сервер ботов ([attendee-labs/attendee](https://github.com/attendee-labs/attendee), лицензия Elastic 2.0:
можно размещать у себя для своих нужд). Бот заходит в Zoom, Google Meet или Teams по ссылке, пишет разговор
и распознаёт его нашим Deepgram. Платформа управляет им через API (`backend/app/services/meeting_bot/`).
Код на стороне платформы и переменные `.env` — `backend/app/core/config.py` (блок MEETING_BOT_*) и `.env.example`.

Версия закреплена на коммите **500168b** (01.10.2026): API платформы сверялся именно с ним.

## Рядом с платформой на том же сервере

Решение 02.10.2026: Attendee запускаем на сервере платформы, но **отдельным проектом** (`/opt/tte-attendee`,
свои Postgres, Redis и MinIO, свои тома). Платформа и её автодеплой его не трогают, и наоборот.
Порты выбраны так, чтобы не пересекаться с платформой и мониторингом:
Postgres 5433, Redis 6380, MinIO 9300/9301, API 8100 (всё на локальных адресах).

Риски этого варианта и как их держать:
- **Ресурсы.** 3–5 встреч одновременно — это +4–6 vCPU и +8–12 ГБ памяти поверх платформы. Проверить до запуска:
  `nproc; free -g; df -h /`. Если не хватает, уменьшить `BOT_MAX_SIMULTANEOUS_BOTS` или переехать на отдельный сервер.
- **Права.** Лаунчеру ботов нужен доступ к Docker хоста (это root). Не давать доступ к панели Attendee посторонним.
- Никогда не выполнять `--remove-orphans` и `down -v` в проекте платформы (общий Caddy, тома данных).

## Почему в идеале отдельный сервер

- Лаунчеру ботов нужен доступ к Docker хоста (`/var/run/docker.sock`), это права root.
- Боты работают в сети хоста и получают все переменные окружения Attendee.
- Каждый бот для Meet и Teams запускает полноценный Chrome: 1 CPU и 2 ГБ на встречу.

Рядом с базой студентов это держать не стоит, и боты не должны отнимать ресурсы у платформы.

## Сервер

- Ubuntu 22.04 или 24.04, **x86_64 (amd64)**. Образ Attendee не собирается под ARM: Zoom SDK есть только для amd64.
- Docker Engine с плагином compose, Caddy (TLS).
- Размер: база около 2 vCPU / 4 ГБ плюс **1 vCPU / 2 ГБ на каждую одновременную встречу**.
  Например, 4 встречи одновременно — 6 vCPU / 12 ГБ, лучше 8 vCPU / 16 ГБ с запасом.
  Лимит одновременных ботов — `BOT_MAX_SIMULTANEOUS_BOTS` в `attendee.env`.

## Развёртывание

1. **DNS.** Две A-записи на IP сервера:
   - `attendee.teenteched.kz` — API и панель Attendee;
   - `attendee-files.teenteched.kz` — записи встреч (платформа скачивает отсюда mp3).

2. **Код Attendee и наши файлы:**
   ```bash
   sudo git clone https://github.com/attendee-labs/attendee.git /opt/attendee
   sudo git -C /opt/attendee checkout 500168b
   sudo mkdir -p /opt/tte-attendee
   # скопировать сюда docker-compose.attendee.yml и attendee.env.example из этой папки
   cd /opt/tte-attendee && sudo cp attendee.env.example attendee.env && sudo chmod 600 attendee.env
   ```

3. **Секреты в `attendee.env`** (каждый сгенерировать отдельно, никуда не пересылать):
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(50))"                      # DJANGO_SECRET_KEY
   python3 -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"  # CREDENTIALS_ENCRYPTION_KEY
   openssl rand -hex 24                                                               # POSTGRES_PASSWORD
   openssl rand -hex 12; openssl rand -hex 24                                         # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (для MinIO)
   ```

4. **Сборка и запуск** (сборка около 10 минут):
   ```bash
   cd /opt/tte-attendee
   docker compose -f docker-compose.attendee.yml --env-file attendee.env build
   docker compose -f docker-compose.attendee.yml --env-file attendee.env up -d
   ```
   Контейнер `app` сам применяет миграции при старте.

5. **Хранилище записей** — создать бакет. Образ `minio/mc` из Docker Hub больше не скачивается,
   поэтому используем boto3 внутри контейнера `app` (ключи он берёт из своего окружения):
   ```bash
   docker compose -f docker-compose.attendee.yml --env-file attendee.env exec -T app python -c "
   import boto3, os
   s3 = boto3.client('s3', endpoint_url='http://127.0.0.1:9300', region_name='us-east-1',
       aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'])
   names = [b['Name'] for b in s3.list_buckets()['Buckets']]
   print('бакеты:', names)
   if 'attendee-recordings' not in names:
       s3.create_bucket(Bucket='attendee-recordings'); print('создан attendee-recordings')
   "
   ```

6. **Caddy.** Сначала узнать, как он запущен:
   ```bash
   systemctl is-active caddy; docker ps --format '{{.Names}}\t{{.Image}}' | grep -i caddy
   ```
   - **Служба на хосте** (`active`): `ATTENDEE_BIND=127.0.0.1`, адрес в конфиге — `127.0.0.1`.
   - **Контейнер**: `ATTENDEE_BIND=172.17.0.1` в `attendee.env` (затем `up -d` заново), адрес в конфиге — `172.17.0.1`.
     Порты 8100 и 9300 не должны быть открыты в интернет: проверить `ss -ltnp | grep -E ':8100|:9300'` —
     там должен быть только выбранный адрес, не `0.0.0.0`.

   Добавить в конфиг общего Caddy (другие сайты не трогать) и перезагрузить его:
   ```
   attendee.teenteched.kz {
       reverse_proxy <адрес>:8100
   }
   attendee-files.teenteched.kz {
       reverse_proxy <адрес>:9300
   }
   ```

7. **Аккаунт в Attendee.** Почты нет, поэтому создаём и подтверждаем аккаунт командой:
   ```bash
   docker compose -f docker-compose.attendee.yml --env-file attendee.env exec app python manage.py createsuperuser
   docker compose -f docker-compose.attendee.yml --env-file attendee.env exec app python manage.py shell -c \
     "from allauth.account.models import EmailAddress; from django.contrib.auth import get_user_model; \
      u = get_user_model().objects.latest('id'); \
      EmailAddress.objects.update_or_create(user=u, email=u.email, defaults={'verified': True, 'primary': True})"
   ```
   Шаг не проверялся на живом сервере. Если вход в панель не пустит, сообщите — поправлю.

8. **Настройки в панели** `https://attendee.teenteched.kz`:
   - создать проект и **API-ключ**;
   - Settings → Credentials → **Deepgram**: ключ Deepgram;
   - Settings → Credentials → **Zoom OAuth App**: Client ID, Client Secret и Webhook Secret из Zoom Marketplace.
     Client Secret вводится **только здесь**, платформе он не нужен;
   - Settings → Webhooks: создать вебхук на `https://teenteched.kz/api/v1/webhooks/meeting-bot/attendee`
     с триггером `zoom_oauth_connection.state_change` (ментор отключил Zoom). Скопировать **секрет вебхуков**.
     Вебхуки о самих встречах платформа задаёт при запуске каждого бота.
   - Zoom Marketplace → Features → Access → Event Subscription: адрес из кнопки «Webhook url» у Zoom OAuth App
     в панели Attendee, события «Meeting has been created» и «User's profile info has been updated».
     Это нужно для записи без окна «Разрешить запись?» у организатора.

9. **Платформа** — в `.env` сервера платформы, затем перезапустить `backend` и `worker`:
   ```
   MEETING_BOT_ENABLED=true
   MEETING_BOT_PROVIDER=attendee
   ATTENDEE_API_URL=https://attendee.teenteched.kz
   ATTENDEE_API_KEY=<API-ключ из шага 8>
   ATTENDEE_WEBHOOK_SECRET=<секрет вебхуков из шага 8>
   ZOOM_CLIENT_ID=<Client ID>
   ZOOM_REDIRECT_URI=https://teenteched.kz/api/v1/integrations/zoom/callback
   ```

## Первая проверка (тестовая встреча, не с реальным студентом)

- [ ] Google Meet: бот просится в звонок, после «Впустить» плашка платформы показывает «Идёт запись».
- [ ] В чате встречи сообщение «Идёт запись встречи для конспекта TeenTechEd».
- [ ] Текст идёт по ходу разговора, **ментор и собеседник — два разных спикера**.
- [ ] После встречи: «Конспект готов — проверьте», в сессии есть звук (mp3 в MinIO платформы).
- [ ] Не впустить бота 10 минут: «Бота не впустили» и уведомление.
- [ ] Встреча с выбранным языком **«Қазақша»**: текст на казахском распознан.
- [ ] Три встречи одновременно: звук не смешивается, сервер справляется.
- [ ] Zoom — после одобрения приложения Zoom: подключение в профиле, бот заходит без окна разрешения записи.

## Эксплуатация

- Боты живут в отдельных контейнерах:
  `docker ps --filter label=attendee.type=ephemeral-bot`.
  Перезапуск `app`, `worker` или `scheduler` их не обрывает. Перезапуск `postgres` и `redis` обрывает, поэтому делать это вне встреч.
- Логи бота: `BOT_CONTAINER_AUTO_REMOVE=false` в `attendee.env`, затем `docker logs <контейнер>`.
- Обновление Attendee: только после проверки, что API не изменился (`backend/app/services/meeting_bot/attendee.py`).
  Новый коммит прописать в README, `image:` и `BOT_CONTAINER_IMAGE`.
- Бэкап: том `attendee_postgres` (подключения Zoom менторов) и `attendee.env`. Записи в MinIO — временные,
  платформа копирует звук к себе.
