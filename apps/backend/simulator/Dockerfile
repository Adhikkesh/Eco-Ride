# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS build

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Skip husky git hooks in Docker
ENV HUSKY=0

WORKDIR /build

# Copy monorepo root config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy workspace packages needed by simulator
COPY packages/shared/package.json packages/shared/
COPY packages/typescript-config/ packages/typescript-config/

# Copy simulator package.json
COPY apps/backend/simulator/package.json apps/backend/simulator/

# Install all dependencies (monorepo-aware)
RUN pnpm install --frozen-lockfile

# Copy source code for shared package
COPY packages/shared/src/ packages/shared/src/
COPY packages/shared/tsconfig.json packages/shared/

# Copy simulator source code
COPY apps/backend/simulator/src/ apps/backend/simulator/src/
COPY apps/backend/simulator/tsconfig.json apps/backend/simulator/

# Build shared package first, then simulator
RUN pnpm --filter @repo/shared build && \
    pnpm --filter simulator build

# ── Stage 2: Production ────────────────────────────────────
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy monorepo root config for pnpm workspace resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy workspace package manifests
COPY packages/shared/package.json packages/shared/
COPY packages/typescript-config/package.json packages/typescript-config/

# Copy simulator package.json
COPY apps/backend/simulator/package.json apps/backend/simulator/

# Install production dependencies only (--ignore-scripts skips husky prepare)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built output from build stage
COPY --from=build /build/apps/backend/simulator/dist/ apps/backend/simulator/dist/
COPY --from=build /build/packages/shared/dist/ packages/shared/dist/

# Set working directory to simulator
WORKDIR /app/apps/backend/simulator

# Start the simulator
CMD ["node", "dist/index.js"]
