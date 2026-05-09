#!/usr/bin/env bash
# deploy.sh — full panel re-deploy (slice 34 ops)
#
# Pulls the latest code, applies any new Prisma migrations, rebuilds all
# containers (Docker layer cache makes this fast — only changed stages
# actually rebuild), and prints status + a tail of the backend log so
# you can spot a startup error before tabbing away.
#
# Usage:  ./scripts/deploy.sh
# Run from the panel project root (where docker-compose.prod.yml lives).

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

if [[ ! -f "$COMPOSE_FILE" || ! -f "$ENV_FILE" ]]; then
    echo "[deploy] run from panel project root (need $COMPOSE_FILE + $ENV_FILE)" >&2
    exit 1
fi

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

echo "[deploy] git pull"
git pull

echo "[deploy] prisma migrate deploy"
"${DC[@]}" run --rm migrate

echo "[deploy] rebuild + restart all services"
"${DC[@]}" up -d --build

echo "[deploy] status"
"${DC[@]}" ps

echo "[deploy] panel-backend tail"
"${DC[@]}" logs --tail=30 panel-backend || true
