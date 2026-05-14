FROM oven/bun:1-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg yt-dlp ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY apps/backend/package.json ./package.json
RUN bun install --production

COPY apps/backend/src ./src
COPY apps/backend/tsconfig.json ./tsconfig.json

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
