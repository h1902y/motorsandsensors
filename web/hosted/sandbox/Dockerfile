# webcode cloud sandbox image — one of these runs per user inside a Fly
# Firecracker micro-VM. The VM boundary is the isolation; this image just
# ships the daemon + a minimal userland for the user's throwaway shell.
#
# Build context = repo root:  docker build -f hosted/sandbox/Dockerfile .

# ── build stage: compile protocol + web + daemon ──────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package*.json ./
COPY packages/protocol/package*.json packages/protocol/
COPY packages/daemon/package*.json packages/daemon/
COPY packages/web/package*.json packages/web/
RUN npm install --workspaces --include-workspace-root
COPY . .
RUN npm run build -w @webcode/protocol \
 && npm run build -w @webcode/web \
 && npm run build -w webcode

# ── runtime stage: slim image with a minimal userland ─────────────────
FROM node:22-bookworm-slim AS runtime
# a tiny userland for the sandbox shell (kept lean; no build-essential by default)
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates python3 less nano procps \
 && rm -rf /var/lib/apt/lists/*

# non-root sandbox user; the VM is the security boundary, but drop root anyway
RUN useradd -m -s /bin/bash sandbox
WORKDIR /app

# daemon dist + its node_modules (node-pty linux prebuild lands here) + web UI
COPY --from=build /src/packages/daemon/dist ./packages/daemon/dist
COPY --from=build /src/packages/daemon/package.json ./packages/daemon/package.json
COPY --from=build /src/packages/protocol/dist ./packages/protocol/dist
COPY --from=build /src/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build /src/packages/web/dist ./packages/web/dist
COPY --from=build /src/node_modules ./node_modules

COPY hosted/sandbox/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV WEBCODE_HOSTED=1 \
    WEBCODE_ROOT=/home/sandbox/workspace \
    PORT=8080 \
    NODE_ENV=production
EXPOSE 8080
USER sandbox
RUN mkdir -p /home/sandbox/workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
