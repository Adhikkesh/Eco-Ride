# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS build

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Skip husky git hooks in Docker
ENV HUSKY=0

WORKDIR /build

# Copy monorepo root config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy workspace packages needed by server
COPY packages/shared/package.json packages/shared/
COPY packages/typescript-config/ packages/typescript-config/

# Copy server package.json
COPY apps/backend/server/package.json apps/backend/server/

# Install all dependencies (monorepo-aware)
RUN pnpm install --frozen-lockfile

# Copy source code for shared package
COPY packages/shared/src/ packages/shared/src/
COPY packages/shared/tsconfig.json packages/shared/

# Copy server source code
COPY apps/backend/server/src/ apps/backend/server/src/
COPY apps/backend/server/tsconfig.json apps/backend/server/

# Build shared package first, then server
RUN pnpm --filter @repo/shared build && \
    pnpm --filter server build

# ── Stage 2: Production ────────────────────────────────────
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy monorepo root config for pnpm workspace resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy workspace package manifests
COPY packages/shared/package.json packages/shared/
COPY packages/typescript-config/package.json packages/typescript-config/

# Copy server package.json
COPY apps/backend/server/package.json apps/backend/server/

# Install production dependencies only (--ignore-scripts skips husky prepare)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built output from build stage
COPY --from=build /build/apps/backend/server/dist/ apps/backend/server/dist/
COPY --from=build /build/packages/shared/dist/ packages/shared/dist/

# Set working directory to server
WORKDIR /app/apps/backend/server

# Expose the server port
EXPOSE 3001

# Start the server
CMD ["node", "dist/index.js"]
