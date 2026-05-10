#!/usr/bin/env bash
# deploy-frontend.sh — fast path for SPA-only changes.
#
# Skips Prisma migrate + backend rebuild. Use this when you only edited
# anything under apps/frontend/ — typically <30s end-to-end vs
# ~2 min for the full deploy.
#
# Usage:  ./scripts/deploy-frontend.sh

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

if [[ ! -f "$COMPOSE_FILE" || ! -f "$ENV_FILE" ]]; then
    echo "[deploy-fe] run from panel project root (need $COMPOSE_FILE + $ENV_FILE)" >&2
    exit 1
fi

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

echo "[deploy-fe] git pull"
git pull

echo "[deploy-fe] rebuild + restart frontend"
"${DC[@]}" up -d --build frontend

echo "[deploy-fe] status"
"${DC[@]}" ps frontend
