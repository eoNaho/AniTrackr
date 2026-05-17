# ── Estágio 1: deps completas para o build ───────────────────────────────────
FROM oven/bun:1-slim AS deps-build
WORKDIR /app

COPY apps/web/package.json ./package.json
RUN bun install --frozen-lockfile

# ── Estágio 2: deps de produção apenas (next + react) ────────────────────────
# Separa as devDependencies (tailwind, typescript, eslint, @types/*)
# das deps de runtime. Reduz node_modules de ~400MB para ~50MB.
FROM oven/bun:1-slim AS deps-prod
WORKDIR /app

COPY apps/web/package.json ./package.json
RUN bun install --production --frozen-lockfile

# ── Estágio 3: build ──────────────────────────────────────────────────────────
FROM deps-build AS builder
WORKDIR /app

COPY apps/web ./

ARG NEXT_PUBLIC_BACKEND_URL=
ARG BACKEND_INTERNAL_URL=http://localhost:3001
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN bun run build

# ── Estágio 4: runtime final ──────────────────────────────────────────────────
# Usa só as deps de produção + o .next compilado. Não inclui devDependencies.
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
EXPOSE 3000

COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY apps/web/package.json ./package.json
COPY apps/web/next.config.ts ./next.config.ts

CMD ["bun", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
