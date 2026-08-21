# ────────────────────────────────────────────────────────────────────────
# Runtime container — serves compiled exercise bundles behind nginx.
#
# Build (from repo root):
#   docker build -f runtime/container/Dockerfile -t physics-runtime .
#
# URL layout inside the container:
#   /                              → strict 404
#   /<slug>-v<version>/            → the exercise's built index.html + assets
#   /_health                       → "ok"
#
# The public nginx (external) proxies /runtime/* → this container, stripping
# the /runtime/ prefix. Per D19, the public nginx also runs auth_request
# BEFORE forwarding — so unauthenticated requests never reach this container.
# ────────────────────────────────────────────────────────────────────────

# ─── Stage 1: build runtime packages + all exercises, then aggregate ───
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# Manifest first (Docker layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Source
COPY runtime/ ./runtime/
COPY exercises/ ./exercises/

# Install workspace deps
RUN pnpm install --frozen-lockfile

# Build all @physics/* packages in workspace-topological order.
# `pnpm -r` respects dependency ordering (protocol before sdk before preview).
RUN pnpm --filter '@physics/*' -r --workspace-concurrency=1 run build && \
    ls -la runtime/protocol/dist/ runtime/sdk/dist/

# Build all exercises. Tolerate an empty exercises/ directory during
# early scaffolding (before any exercise exists).
RUN pnpm --filter './exercises/*' -r --workspace-concurrency=1 run build || echo "no exercises to build yet"

# Aggregate exercise dist/s into runtime/container/dist/<slug>-v<version>/
RUN node runtime/container/build.mjs

# ─── Stage 2: nginx serves the aggregated folder ───
FROM nginx:alpine
COPY --from=build /app/runtime/container/dist/ /usr/share/nginx/html/
# nginx:alpine's entrypoint runs envsubst on files in /etc/nginx/templates/
# matching *.template, writing to /etc/nginx/conf.d/. NGINX_ENVSUBST_FILTER
# restricts substitution to RUNTIME_SIGNING_SECRET only so nginx-native
# variables ($uri, $arg_sig, $secure_link_expires, …) survive intact.
COPY runtime/container/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=^RUNTIME_SIGNING_SECRET$
EXPOSE 80
# RUNTIME_SIGNING_SECRET must be passed at `docker run -e ...` (same value
# as backend's .env). No default — running without it will fail at request
# time (empty secret ≠ backend's secret ⇒ all signatures rejected).
