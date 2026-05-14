import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { searchRoutes } from "./routes/search.ts";
import { metadataRoutes } from "./routes/metadata.ts";
import { downloadRoutes } from "./routes/downloads.ts";
import { libraryRoutes } from "./routes/library.ts";
import { configRoutes } from "./routes/config.ts";
import { jellyfinRoutes } from "./routes/jellyfin.ts";
import { subtitleRoutes } from "./routes/subtitles.ts";
import { logger } from "./utils/logger.ts";
import "./db/index.ts";

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

logger.info("app", `╔══════════════════════════════════════════════════╗`);
logger.info("app", `║  GoAnime Tracker Backend v2.0.1                  ║`);
logger.info("app", `║  http://localhost:${PORT}                            ║`);
logger.info("app", `╚══════════════════════════════════════════════════╝`);
logger.info("app", `Rotas:`);
logger.info("app", `  SEARCH  /api/search?q=&source=all|animefire|goyabu|allanime|kitsu`);
logger.info("app", `  SEARCH  /api/search/episodes?url=&provider=&allAnimeId=`);
logger.info("app", `  SEARCH  /api/search/stream?allAnimeId=&episode=&mode=sub&quality=best`);
logger.info("app", `  SEARCH  /api/search/providers`);
logger.info("app", `  META    /api/metadata/search?q=&source=anilist|kitsu|all`);
logger.info("app", `  META    /api/metadata/anilist/:id   /api/metadata/anilist/:id/airing`);
logger.info("app", `  META    /api/metadata/kitsu/:id`);
logger.info("app", `  META    /api/metadata/enrich/:id  (POST)`);
logger.info("app", `  LIB     /api/library  [GET/POST]   /api/library/stats/summary`);
logger.info("app", `  LIB     /api/library/:id  [GET/PATCH/DELETE]`);
logger.info("app", `  LIB     /api/library/:id/episodes  [GET/PATCH]`);
logger.info("app", `  LIB     /api/library/:id/scan  (POST)`);
logger.info("app", `  LIB     /api/library/scan/all  (POST)`);
logger.info("app", `  LIB     /api/library/:id/rename?dry=true  (POST)`);
logger.info("app", `  DL      /api/downloads  [GET]   /api/downloads/stats`);
logger.info("app", `  DL      /api/downloads/stream  (SSE — progresso em tempo real)`);
logger.info("app", `  DL      /api/queue  (POST)   /api/queue/missing  (POST)`);
logger.info("app", `  DL      /api/queue/missing-all  (POST)`);
logger.info("app", `  DL      /api/downloads/:id  (DELETE)   /api/downloads/all  (DELETE)`);
logger.info("app", `  JF      /api/jellyfin/nfo/:id  (POST)   /api/jellyfin/nfo/all  (POST)`);
logger.info("app", `  JF      /api/jellyfin/posters/:id  (POST)`);
logger.info("app", `  SUB     /api/subtitles/search?q=&season=&episode=&languages=`);
logger.info("app", `  SUB     /api/subtitles/download  (POST)`);
logger.info("app", `  SUB     /api/subtitles/auto  (POST)   /api/subtitles/auto-all  (POST)`);
logger.info("app", `  CFG     /api/config  [GET/POST]   /api/config/:key  [GET/PUT]`);

export type App = typeof app;
