# ── Stage 1: Install dependencies ────────────────────────────
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN bun install --frozen-lockfile

# ── Stage 2: Build client + compile binary ───────────────────
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=deps /app/packages/server/node_modules packages/server/node_modules
COPY --from=deps /app/packages/client/node_modules packages/client/node_modules
COPY . .

# Build client (Vite → packages/client/dist/)
RUN cd packages/client && bun run build

# Embed client assets into server source
RUN bun run scripts/embed-client.ts

# Compile single binary for linux-x64
RUN bun build --compile packages/server/src/cli.ts \
    --outfile /app/oc \
    --target bun-linux-x64

# ── Stage 3: Minimal runtime ────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/oc /usr/local/bin/oc

EXPOSE 4000
VOLUME /data
WORKDIR /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:4000/api/health || exit 1

CMD ["oc"]
