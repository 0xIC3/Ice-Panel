# syntax=docker/dockerfile:1.7

# Multi-stage Dockerfile for the Ice-Panel backend.
# Build context MUST be the monorepo root (so pnpm-workspace.yaml is accessible).
#
#   docker build -f apps/panel-backend/Dockerfile -t ice-panel-backend .

ARG NODE_VERSION=22-alpine

# ───── Build stage ─────
FROM node:${NODE_VERSION} AS builder
ENV CI=true
RUN corepack enable
WORKDIR /repo

# Copy manifests first so dependency installation is cacheable.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/panel-backend/package.json apps/panel-backend/
COPY packages/shared/package.json packages/shared/

# Install dev+prod deps for the backend filter (incl. workspace transitives).
RUN --mount=type=cache,id=pnpm,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --filter "@ice-panel/panel-backend..."

# Now bring in source.
COPY apps/panel-backend apps/panel-backend
COPY packages/shared packages/shared

# Generate Prisma client + compile TS to dist/.
WORKDIR /repo/apps/panel-backend
RUN pnpm exec prisma generate
RUN pnpm exec tsc

# Strip dev deps so only production node_modules remain.
WORKDIR /repo
RUN --mount=type=cache,id=pnpm,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --prod --filter "@ice-panel/panel-backend..."

# ───── Runtime stage ─────
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy the trimmed workspace from the builder.
COPY --from=builder /repo /app

WORKDIR /app/apps/panel-backend
EXPOSE 3000

# Healthcheck hits /health which pings Postgres + Redis.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
