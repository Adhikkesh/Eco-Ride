# ── Stage 1: Dependencies ───────────────────────────────────
FROM node:20-alpine AS deps

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /build

# Copy monorepo root config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy workspace packages
COPY packages/typescript-config/ packages/typescript-config/

# Copy web package.json
COPY apps/web/package.json apps/web/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ──────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

ENV HUSKY=0

WORKDIR /build

# Copy everything from deps
COPY --from=deps /build ./

# Copy web source code
COPY apps/web/ apps/web/
COPY packages/typescript-config/ packages/typescript-config/

# Pass NEXT_PUBLIC_* env vars as build args (they're baked at build time)
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_DATABASE_URL
ARG NEXT_MEASUREMENT_ID
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

# Build Next.js (standalone output)
RUN pnpm --filter web build

# ── Stage 3: Production ────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy standalone output
COPY --from=builder /build/apps/web/.next/standalone ./
COPY --from=builder /build/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /build/apps/web/public ./apps/web/public

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
