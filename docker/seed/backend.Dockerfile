# Образ бэкенда для ИЗОЛИРОВАННОЙ тестовой среды (docker-compose.seed.yml).
# Копия backend/Dockerfile, но со своим .dockerignore (backend.Dockerfile.dockerignore):
# в образ не попадают .env, .git, node_modules и прочее лишнее. Код запекается в
# образ, а не монтируется — тестовый контейнер не видит файлов хоста, включая .env с
# настоящими ключами.
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    gcc \
    libpq-dev \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/. .
COPY migration/ ./migration/

EXPOSE 8000
