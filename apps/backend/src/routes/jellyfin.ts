import Elysia, { t } from "elysia";
import { generateNfo, generateNfoAll, downloadPosters } from "../services/jellyfin.ts";
import { testConnection, getLibraries, refreshLibrary, refreshSeries, getStatus } from "../services/jellyfin-connector.ts";
import { enqueueRefresh } from "../services/jellyfin-refresh-queue.ts";
import { logger } from "../utils/logger.ts";
import db from "../db/index.ts";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

function jsonError(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getConfig(key: string): string {
  return db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key)?.value ?? "";
}

// ── Readiness check ───────────────────────────────────────────────────────────

type AnimeReadiness = {
  id: string;
  title: string;
  seriesPath: string;
  hasTvshowNfo: boolean;
  hasPoster: boolean;
  hasFanart: boolean;
  episodesMissingNfo: number;
};

function checkAnimeReadiness(animeId: string): AnimeReadiness | null {
  const anime = db.query<{
    id: string; title: string; title_english: string | null; local_path: string;
  }, [string]>(`SELECT id, title, title_english, local_path FROM animes WHERE id = ?`).get(animeId);
  if (!anime) return null;

  const serPath = anime.local_path || "";
  const hasTvshowNfo = !!serPath && existsSync(join(serPath, "tvshow.nfo"));
  const hasPoster = !!serPath && existsSync(join(serPath, "poster.jpg"));
  const hasFanart = !!serPath && existsSync(join(serPath, "fanart.jpg"));

  const episodes = db.query<{ file_path: string }, [string]>(
    `SELECT file_path FROM episodes WHERE anime_id = ? AND file_path IS NOT NULL AND file_path != ''`
  ).all(animeId);

  let episodesMissingNfo = 0;
  for (const ep of episodes) {
    const nfoPath = ep.file_path.replace(/\.(mkv|mp4|avi|m4v|webm)$/i, ".nfo");
    if (!existsSync(nfoPath)) episodesMissingNfo++;
  }

  return {
    id: anime.id,
    title: anime.title_english ?? anime.title,
    seriesPath: serPath,
    hasTvshowNfo,
    hasPoster,
    hasFanart,
    episodesMissingNfo,
  };
}

export const jellyfinRoutes = new Elysia({ prefix: "/jellyfin" })

  // ── Rotas existentes ──────────────────────────────────────────────────────

  // POST /api/jellyfin/nfo/:id — gera NFO para um anime
  .post("/nfo/:id", async ({ params, query }) => {
    const downloadImages = query.images !== "false";
    try {
      const result = await generateNfo(params.id, downloadImages);
      logger.info("jellyfin", `nfo generated for ${params.id}: ${result.episodesNfo} episode nfos`);
      return { ok: true, ...result };
    } catch (err) {
      return jsonError(String(err), 500);
    }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ images: t.Optional(t.String()) }),
  })

  // POST /api/jellyfin/nfo/all — gera NFO para toda a biblioteca
  .post("/nfo/all", async ({ query }) => {
    const downloadImages = query.images === "true";
    const result = await generateNfoAll(downloadImages);
    return { ok: true, ...result };
  }, {
    query: t.Object({ images: t.Optional(t.String()) }),
  })

  // POST /api/jellyfin/posters/:id — baixa poster.jpg e fanart.jpg
  .post("/posters/:id", async ({ params }) => {
    try {
      const result = await downloadPosters(params.id);
      return { ok: true, ...result };
    } catch (err) {
      return jsonError(String(err), 500);
    }
  }, { params: t.Object({ id: t.String() }) })

  // ── Novas rotas: connector ────────────────────────────────────────────────

  // POST /api/jellyfin/test — testa conexão com o servidor Jellyfin
  .post("/test", async () => {
    const result = await testConnection();
    return result;
  })

  // GET /api/jellyfin/libraries — lista bibliotecas do servidor
  .get("/libraries", async () => {
    const result = await getLibraries();
    return result;
  })

  // GET /api/jellyfin/status — status atual da integração
  .get("/status", () => {
    return getStatus();
  })

  // POST /api/jellyfin/refresh/library — refresh da biblioteca completa
  .post("/refresh/library", async ({ query }) => {
    const libraryId = query.id || undefined;
    const result = await refreshLibrary(libraryId);
    return result;
  }, {
    query: t.Object({ id: t.Optional(t.String()) }),
  })

  // POST /api/jellyfin/refresh/anime/:id — refresh de uma série específica
  .post("/refresh/anime/:id", async ({ params }) => {
    const anime = db.query<{ id: string; local_path: string; title: string }, [string]>(
      `SELECT id, local_path, title FROM animes WHERE id = ?`
    ).get(params.id);

    if (!anime) return jsonError("Anime não encontrado", 404);

    // Enfileira para processamento assíncrono com retry
    enqueueRefresh(anime.id, anime.local_path || "", "series");

    // Tenta refresh imediato também
    const result = anime.local_path
      ? await refreshSeries(anime.local_path)
      : await refreshLibrary();

    return {
      ok: result.ok,
      queued: true,
      animeId: params.id,
      refreshType: "series",
      message: result.message,
    };
  }, { params: t.Object({ id: t.String() }) })

  // POST /api/jellyfin/rebuild/:id — regera NFO/posters e enfileira refresh
  .post("/rebuild/:id", async ({ params }) => {
    try {
      const nfoResult = await generateNfo(params.id, true);

      const anime = db.query<{ local_path: string }, [string]>(
        `SELECT local_path FROM animes WHERE id = ?`
      ).get(params.id);

      if (anime?.local_path) {
        enqueueRefresh(params.id, anime.local_path, "series");
      }

      return {
        ok: true,
        nfo: { episodesNfo: nfoResult.episodesNfo, errors: nfoResult.errors },
        refreshQueued: !!anime?.local_path,
      };
    } catch (err) {
      return jsonError(String(err), 500);
    }
  }, { params: t.Object({ id: t.String() }) })

  // GET /api/jellyfin/readiness — diagnóstico de prontidão para Jellyfin
  .get("/readiness", () => {
    const namingScheme = getConfig("naming_scheme");
    const mediaPath = getConfig("media_path") || getConfig("download_path");
    const mediaPathAccessible = mediaPath ? existsSync(mediaPath) : false;

    const animes = db.query<{ id: string }, []>(
      `SELECT id FROM animes WHERE is_tracked = 1`
    ).all();

    const checks: AnimeReadiness[] = [];
    let seriesWithoutTvshowNfo = 0;
    let episodesMissingNfoTotal = 0;
    let missingPoster = 0;
    let missingFanart = 0;

    for (const { id } of animes) {
      const r = checkAnimeReadiness(id);
      if (!r) continue;
      checks.push(r);
      if (!r.hasTvshowNfo) seriesWithoutTvshowNfo++;
      if (!r.hasPoster) missingPoster++;
      if (!r.hasFanart) missingFanart++;
      episodesMissingNfoTotal += r.episodesMissingNfo;
    }

    const readyForJellyfin =
      namingScheme === "jellyfin" &&
      mediaPathAccessible &&
      seriesWithoutTvshowNfo === 0 &&
      episodesMissingNfoTotal === 0;

    return {
      enabledNamingScheme: namingScheme,
      mediaPath,
      mediaPathAccessible,
      trackedSeries: animes.length,
      seriesWithoutTvshowNfo,
      episodesMissingNfoTotal,
      missingPoster,
      missingFanart,
      readyForJellyfin,
      series: checks,
    };
  })

  // GET /api/jellyfin/readiness/:id — diagnóstico de uma série específica
  .get("/readiness/:id", ({ params }) => {
    const r = checkAnimeReadiness(params.id);
    if (!r) return jsonError("Anime não encontrado", 404);
    return { ok: true, ...r };
  }, { params: t.Object({ id: t.String() }) });
