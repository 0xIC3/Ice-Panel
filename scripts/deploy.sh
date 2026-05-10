#!/usr/bin/env bash
# deploy.sh — full panel re-deploy (slice 34 ops)
#
# Pulls the latest code, applies any new Prisma migrations, rebuilds all
# containers (Docker layer cache makes this fast — only changed stages
# actually rebuild), and prints status + a tail of the backend log so
# you can spot a startup error before tabbing away.
#
# Usage:
#   ./scripts/deploy.sh             # standard re-deploy
#   ./scripts/deploy.sh --cleanup   # also prune old images/build cache
#                                     after the rebuild lands
#
# Run from the panel project root (where docker-compose.prod.yml lives).

set -euo pipefail

CLEANUP_AFTER=0
for arg in "$@"; do
    case "$arg" in
        --cleanup|--prune) CLEANUP_AFTER=1 ;;
        *)
            echo "[deploy] unknown arg: $arg" >&2
            exit 2
            ;;
    esac
done

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

echo "[deploy] backend tail"
"${DC[@]}" logs --tail=30 backend || true

if [[ $CLEANUP_AFTER -eq 1 ]]; then
    echo
    echo "[deploy] running cleanup …"
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    "$SCRIPT_DIR/cleanup.sh"
fi
