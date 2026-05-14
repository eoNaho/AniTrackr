FROM oven/bun:1-slim AS deps
WORKDIR /app

COPY apps/web/package.json ./package.json
RUN bun install

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

FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
EXPOSE 3000

COPY --from=builder /app ./

CMD ["bun", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
