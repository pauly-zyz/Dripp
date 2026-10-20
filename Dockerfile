# Dripp off-chain services (pnpm monorepo). Targets: indexer, api, keeper, web.
#   docker compose build    (see docker-compose.yml and DEPLOY.md)
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# install dependencies with only the manifests, for layer caching
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/
COPY indexer/package.json indexer/
COPY backend/package.json backend/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY shared shared
COPY indexer indexer
COPY backend backend
COPY web web

# ---------------- indexer (Ponder) ----------------
FROM source AS indexer
WORKDIR /app/indexer
EXPOSE 42069
CMD ["sh", "-c", "exec npx ponder start --schema ${PONDER_SCHEMA:-dripp_indexer} --views-schema ${PONDER_VIEWS_SCHEMA:-dripp} --port 42069"]

# ---------------- API ----------------
FROM source AS api
WORKDIR /app/backend
EXPOSE 8080
CMD ["npx", "tsx", "src/server.ts"]

# ---------------- keeper ----------------
FROM source AS keeper
WORKDIR /app/backend
CMD ["npx", "tsx", "src/keeper/main.ts"]

# ---------------- web (Next.js) ----------------
FROM source AS web-build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CHAIN_ID=4663
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_WC_PROJECT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL NEXT_PUBLIC_WC_PROJECT_ID=$NEXT_PUBLIC_WC_PROJECT_ID
WORKDIR /app/web
RUN npx next build

FROM web-build AS web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
