#!/usr/bin/env bash
# deploy-backend.sh — backend-only re-deploy.
#
# Pulls latest, applies pending migrations (always cheap when there are
# none), rebuilds + restarts panel-backend. Frontend stays untouched —
# use this when you only edited apps/panel-backend/, prisma/, or
# packages/shared/.
#
# Usage:  ./scripts/deploy-backend.sh

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

if [[ ! -f "$COMPOSE_FILE" || ! -f "$ENV_FILE" ]]; then
    echo "[deploy-be] run from panel project root (need $COMPOSE_FILE + $ENV_FILE)" >&2
    exit 1
fi

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

echo "[deploy-be] git pull"
git pull

echo "[deploy-be] prisma migrate deploy"
"${DC[@]}" run --rm migrate

echo "[deploy-be] rebuild + restart panel-backend"
"${DC[@]}" up -d --build panel-backend

echo "[deploy-be] status"
"${DC[@]}" ps panel-backend

echo "[deploy-be] panel-backend tail"
"${DC[@]}" logs --tail=40 panel-backend || true
