# ── Estágio 1: instala dependências ──────────────────────────────────────────
FROM oven/bun:1-slim AS deps
WORKDIR /app

COPY apps/web/package.json ./package.json
RUN bun install --frozen-lockfile

# ── Estágio 2: build ──────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

COPY apps/web ./

ARG NEXT_PUBLIC_BACKEND_URL=
ARG BACKEND_INTERNAL_URL=http://localhost:3001
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN bun run build

# ── Estágio 3: runtime — só o standalone output ───────────────────────────────
# O "output: standalone" do Next.js gera .next/standalone com server.js +
# apenas os node_modules que ele realmente usa. Não precisamos copiar o
# node_modules inteiro do builder (economiza 400–600 MB).
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# node é um alias para bun nas imagens oven/bun — é o comando padrão para
# o servidor standalone do Next.js e evita ambiguidade de resolução de módulo.
CMD ["node", "server.js"]
