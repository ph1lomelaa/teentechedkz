.PHONY: up down build logs migrate seed shell-backend tunnel tunnel-stop

# Start all services
up:
	docker-compose up -d

# Build and start
build:
	docker-compose up -d --build

# Stop all services
down:
	docker-compose down

# View logs
logs:
	docker-compose logs -f backend

# Run Alembic migrations
migrate:
	docker-compose exec backend alembic upgrade head

# Run seed (creates admin + country data)
seed:
	docker-compose exec backend python -m app.core.seed

# Shell into backend container
shell-backend:
	docker-compose exec backend bash

# Run migration from Excel/Notion
migrate-data:
	docker-compose exec backend python -m migration.runner $(ARGS)

# Run tests
test:
	docker-compose exec backend pytest tests/ -v

# Generate new Alembic migration
alembic-revision:
	docker-compose exec backend alembic revision --autogenerate -m "$(MSG)"

# Format code
fmt:
	docker-compose exec backend black app/ migration/
	docker-compose exec backend isort app/ migration/

# Start local ngrok tunnel for the Telegram webhook (idempotent)
tunnel:
	./scripts/tunnel.sh

# Stop the local ngrok tunnel
tunnel-stop:
	./scripts/tunnel-stop.sh
