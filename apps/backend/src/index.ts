import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { searchRoutes } from "./routes/search.ts";
import { metadataRoutes } from "./routes/metadata.ts";
import { downloadRoutes } from "./routes/downloads.ts";
import { libraryRoutes } from "./routes/library.ts";
import { configRoutes } from "./routes/config.ts";
import { jellyfinRoutes } from "./routes/jellyfin.ts";
import { subtitleRoutes } from "./routes/subtitles.ts";
import { torrentRoutes, startTorrentMonitor, restoreTorrentMonitors } from "./routes/torrent.ts";
import { logger } from "./utils/logger.ts";
import { DB_FILE, DATA_ROOT } from "./db/index.ts";

const PORT = parseInt(process.env.PORT ?? "3001");

const app = new Elysia()
  .use(cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }))

  .get("/health", () => ({
    status: "ok",
    service: "goanime-tracker",
    version: "2.0.1",
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    env: {
      hasOpenSubtitlesKey: !!process.env.OPENSUBTITLES_API_KEY,
    },
  }))

  .group("/api", (app) =>
    app
      .use(searchRoutes)
      .use(metadataRoutes)
      .use(downloadRoutes)
      .use(libraryRoutes)
      .use(configRoutes)
      .use(jellyfinRoutes)
      .use(subtitleRoutes)
      .use(torrentRoutes)
  )

  .onError(({ code, error, request }) => {
    const path = new URL(request.url).pathname;
    if (code === "NOT_FOUND") {
      return new Response(JSON.stringify({ error: "Rota não encontrada", path }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }
    if (code === "VALIDATION") {
      return new Response(JSON.stringify({ error: "Validação falhou", details: error.message }), {
        status: 422, headers: { "Content-Type": "application/json" },
      });
    }
    logger.error("app", `[${code}] ${path}: ${error}`);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  })

  .listen(PORT);

// Inicia monitoramento de torrents ativos
restoreTorrentMonitors();
startTorrentMonitor();

logger.info("app", `╔══════════════════════════════════════════════════╗`);
logger.info("app", `║  GoAnime Tracker Backend v2.1.0                  ║`);
logger.info("app", `║  http://localhost:${PORT}                            ║`);
logger.info("app", `╚══════════════════════════════════════════════════╝`);
logger.info("app", `DB FILE: ${DB_FILE}`);
logger.info("app", `DATA ROOT: ${DATA_ROOT}`);
logger.info("app", `Rotas:`);
logger.info("app", `  SEARCH  /api/search?q=&source=all|animefire|goyabu|allanime|nineanime|animedrive|superflix|dattebayo|kitsu`);
logger.info("app", `  SEARCH  /api/search/episodes   /api/search/stream   /api/search/providers`);
logger.info("app", `  META    /api/metadata/search   /api/metadata/enrich/:id`);
logger.info("app", `  META    /api/metadata/jikan/search   /api/metadata/jikan/:malId/episodes`);
logger.info("app", `  META    /api/metadata/jikan/enrich/:id  (POST — filler/recap detection)`);
logger.info("app", `  LIB     /api/library  [GET/POST]   /api/library/:id  [GET/PATCH/DELETE]`);
logger.info("app", `  DL      /api/downloads  [GET/SSE]   /api/queue  [POST]`);
logger.info("app", `  NYAA    /api/nyaa/search?q=&category=&group=&resolution=`);
logger.info("app", `  TORRENT /api/torrent/status   /api/torrent/list   /api/torrent/add  (POST)`);
logger.info("app", `  TORRENT /api/torrent/:hash/pause|resume   DELETE /api/torrent/:hash`);
logger.info("app", `  HEALTH  /api/providers/health   POST /api/providers/:name/reset`);
logger.info("app", `  JF      /api/jellyfin/nfo/:id   /api/jellyfin/posters/:id`);
logger.info("app", `  SUB     /api/subtitles/search   /api/subtitles/auto`);
logger.info("app", `  CFG     /api/config  [GET/POST]   /api/config/:key  [GET/PUT]`);

export type App = typeof app;
