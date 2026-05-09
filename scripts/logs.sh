#!/usr/bin/env bash
# logs.sh — quick log inspector for the panel stack.
#
# Default: tail last 100 lines from EVERY service (panel-backend +
# panel-frontend + caddy + postgres + redis), one block per service.
# Use this when something feels off after a deploy.
#
# Modes:
#   ./scripts/logs.sh              # last 100 of every service
#   ./scripts/logs.sh -f           # follow live
#   ./scripts/logs.sh be           # backend only (alias: backend)
#   ./scripts/logs.sh fe           # frontend only (alias: frontend)
#   ./scripts/logs.sh caddy        # caddy / TLS
#   ./scripts/logs.sh db           # postgres
#   ./scripts/logs.sh redis        # redis
#   ./scripts/logs.sh be -f        # follow specific service

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

if [[ ! -f "$COMPOSE_FILE" || ! -f "$ENV_FILE" ]]; then
    echo "[logs] run from panel project root (need $COMPOSE_FILE + $ENV_FILE)" >&2
    exit 1
fi

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# Resolve short alias → compose service name. Stays in sync with
# docker-compose.prod.yml — update if services change.
SERVICE=""
FOLLOW=0
TAIL_N=100

for arg in "$@"; do
    case "$arg" in
        be|backend)         SERVICE="panel-backend" ;;
        fe|frontend)        SERVICE="panel-frontend" ;;
        caddy|tls)          SERVICE="caddy" ;;
        db|postgres|pg)     SERVICE="postgres" ;;
        redis|cache)        SERVICE="redis" ;;
        -f|--follow|tail)   FOLLOW=1 ;;
        --tail=*)           TAIL_N="${arg#--tail=}" ;;
        *)
            echo "[logs] unknown arg: $arg (try: be / fe / caddy / db / redis / -f)" >&2
            exit 2
            ;;
    esac
done

ARGS=(--tail="$TAIL_N")
if [[ $FOLLOW -eq 1 ]]; then
    ARGS+=(-f)
fi

if [[ -n "$SERVICE" ]]; then
    "${DC[@]}" logs "${ARGS[@]}" "$SERVICE"
    exit $?
fi

# All-services mode — one block per service. `docker compose logs` with
# no args prints them interleaved which is hard to skim; loop to keep
# them grouped.
for s in panel-backend panel-frontend caddy postgres redis; do
    echo "═══════════════════════════════════════════════════════════"
    echo " $s (last $TAIL_N lines)"
    echo "═══════════════════════════════════════════════════════════"
    "${DC[@]}" logs --tail="$TAIL_N" "$s" 2>/dev/null || echo "(service '$s' not running)"
    echo
done
