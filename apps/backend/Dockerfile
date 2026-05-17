# ── Estágio 1: instala dependências de produção ──────────────────────────────
FROM oven/bun:1-slim AS deps
WORKDIR /app

COPY apps/backend/package.json ./package.json
RUN bun install --production --frozen-lockfile

# ── Estágio 2: runtime final ──────────────────────────────────────────────────
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Instala apenas curl + xz-utils (necessário para extrair ffmpeg estático),
# depois baixa ffmpeg e yt-dlp como binários estáticos — sem Python, sem
# centenas de shared libs de codec que o apt puxa junto com o ffmpeg.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils && \
    rm -rf /var/lib/apt/lists/* && \
    ARCH=$(dpkg --print-architecture) && \
    FFMPEG_ARCH=$([ "$ARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    YTDLP_BIN=$([ "$ARCH" = "arm64" ] && echo "yt-dlp_linux_aarch64" || echo "yt-dlp_linux") && \
    # ffmpeg estático (johnvansickle) — ~70 MB vs ~200 MB do apt
    curl -fsSL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz" \
      -o /tmp/ffmpeg.tar.xz && \
    mkdir /tmp/ff && \
    tar xJf /tmp/ffmpeg.tar.xz --strip-components=1 -C /tmp/ff && \
    mv /tmp/ff/ffmpeg /tmp/ff/ffprobe /usr/local/bin/ && \
    rm -rf /tmp/ff /tmp/ffmpeg.tar.xz && \
    # yt-dlp binário autossuficiente — sem Python
    curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_BIN}" \
      -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

COPY --from=deps /app/node_modules ./node_modules
COPY apps/backend/src ./src
COPY apps/backend/tsconfig.json ./tsconfig.json

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
