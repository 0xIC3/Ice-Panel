#!/usr/bin/env bash
# deploy-frontend.sh — fast path for SPA-only changes.
#
# Skips Prisma migrate + backend rebuild. Use this when you only edited
# anything under apps/panel-frontend/ — typically <30s end-to-end vs
# ~2 min for the full deploy.
#
# Usage:
#   ./scripts/deploy-frontend.sh           # standard rebuild (uses cache)
#   ./scripts/deploy-frontend.sh --no-cache  # force full rebuild — use
#                                            this when nginx.conf changed
#                                            (Docker layer cache occasionally
#                                            keeps the old config layer)

set -euo pipefail

NO_CACHE=0
for arg in "$@"; do
    case "$arg" in
        --no-cache|--fresh) NO_CACHE=1 ;;
        *)
            echo "[deploy-fe] unknown arg: $arg" >&2
            exit 2
            ;;
    esac
done

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

if [[ ! -f "$COMPOSE_FILE" || ! -f "$ENV_FILE" ]]; then
    echo "[deploy-fe] run from panel project root (need $COMPOSE_FILE + $ENV_FILE)" >&2
    exit 1
fi

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

echo "[deploy-fe] git pull"
git pull

if [[ $NO_CACHE -eq 1 ]]; then
    echo "[deploy-fe] forced rebuild (no cache)"
    "${DC[@]}" build --no-cache frontend
    "${DC[@]}" up -d frontend
else
    echo "[deploy-fe] rebuild + restart frontend"
    "${DC[@]}" up -d --build frontend
fi

echo "[deploy-fe] status"
"${DC[@]}" ps frontend
