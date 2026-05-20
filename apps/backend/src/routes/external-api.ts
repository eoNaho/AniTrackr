/**
 * API Pública da Instância — /api/v1
 * Autenticação: Authorization: Bearer <api_key>  ou  X-API-Key: <api_key>
 */

import Elysia, { t } from "elysia";
import { authGuard, logAudit, ALL_SCOPES } from "../middleware/api-auth.ts";
import { searchAllProviders, getEpisodesWithFallback, getProviderInfo, type Provider } from "../services/provider-chain.ts";
import { enqueueDownloads, getAllDownloads } from "../services/downloader.ts";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { CURRENT_VERSION } from "./update.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function fail(error: string, message: string) {
  return { ok: false as const, error, message };
}

// ── routes ────────────────────────────────────────────────────────────────────

export const externalApiRoutes = new Elysia({ prefix: "/v1" })

  // ── GET /api/v1/health — público, sem auth ──────────────────────────────────
  .get("/health", () =>
    ok({
      status: "ok",
      version: CURRENT_VERSION,
      timestamp: new Date().toISOString(),
      scopes: [...ALL_SCOPES],
    })
  )

  // ── GET /api/v1/search?q=&source= ──────────────────────────────────────────
  .get("/search", async ({ request, set, query }) => {
    const { err, ctx } = authGuard(request, set, "search:read");
    if (err) return err;

    const q = query.q?.trim();
    if (!q || q.length < 2) {
      set.status = 422;
      return fail("validation_error", "q must be at least 2 characters");
    }

    const source = query.source ?? "all";
    const VALID_PROVIDERS: Provider[] = ["animefire", "goyabu", "allanime", "nineanime", "animedrive", "superflix", "dattebayo"];
    const providers: Provider[] =
      source !== "all" && VALID_PROVIDERS.includes(source as Provider)
        ? [source as Provider]
        : ["animefire", "goyabu", "allanime"];

    const t0 = performance.now();
    try {
      const { results, providerStats } = await searchAllProviders(q, providers);
      const dur = performance.now() - t0;
      logAudit(ctx!.keyId, "/api/v1/search", "GET", 200, dur);
      logger.info("external-api", `search q="${q}" source=${source} results=${results.length} key=${ctx!.keyId}`);
      return ok({ results, total: results.length, providerStats, source });
    } catch (e) {
      logAudit(ctx!.keyId, "/api/v1/search", "GET", 500, performance.now() - t0, "search_error");
      set.status = 500;
      return fail("search_error", String(e));
    }
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      source: t.Optional(t.String()),
    }),
  })

  // ── GET /api/v1/search/episodes?animeId=&season= ───────────────────────────
  .get("/search/episodes", async ({ request, set, query }) => {
    const { err, ctx } = authGuard(request, set, "search:read");
    if (err) return err;

    const animeId = query.animeId?.trim();
    if (!animeId) {
      set.status = 422;
      return fail("validation_error", "animeId is required");
    }

    const anime = db.query<{ id: string; title: string; title_english: string | null; source_url: string | null }, [string]>(
      `SELECT id, title, title_english, source_url FROM animes WHERE id = ?`
    ).get(animeId);

    if (!anime) {
      set.status = 404;
      return fail("not_found", "Anime not found in library — add it first via the web UI");
    }

    const season = Math.max(1, parseInt(query.season ?? "1", 10) || 1);
    const t0 = performance.now();
    try {
      const searchTitle = anime.title_english ?? anime.title;
      const episodes = await getEpisodesWithFallback(searchTitle, season, anime.source_url ?? undefined);
      logAudit(ctx!.keyId, "/api/v1/search/episodes", "GET", 200, performance.now() - t0);
      return ok({ animeId, title: anime.title, season, episodes, total: episodes.length });
    } catch (e) {
      logAudit(ctx!.keyId, "/api/v1/search/episodes", "GET", 500, performance.now() - t0, "episodes_error");
      set.status = 500;
      return fail("episodes_error", String(e));
    }
  }, {
    query: t.Object({
      animeId: t.Optional(t.String()),
      season: t.Optional(t.String()),
    }),
  })

  // ── GET /api/v1/library?page=&limit= ───────────────────────────────────────
  .get("/library", ({ request, set, query }) => {
    const { err, ctx } = authGuard(request, set, "library:read");
    if (err) return err;

    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
    const offset = (page - 1) * limit;

    const total = db.query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM animes WHERE is_tracked = 1`
    ).get()?.count ?? 0;

    const animes = db.query<{
      id: string; title: string; title_english: string | null; poster_url: string | null;
      episode_count: number | null; downloaded_count: number; download_status: string | null;
      rating: number | null; year: number | null; anilist_status: string | null;
    }, [number, number]>(
      `SELECT id, title, title_english, poster_url, episode_count, downloaded_count,
              download_status, rating, year, anilist_status
       FROM animes WHERE is_tracked = 1 ORDER BY title LIMIT ? OFFSET ?`
    ).all(limit, offset);

    logAudit(ctx!.keyId, "/api/v1/library", "GET", 200, 0);
    return ok({ animes, total, page, limit, pages: Math.ceil(total / limit) });
  }, {
    query: t.Object({
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  // ── GET /api/v1/library/:id ─────────────────────────────────────────────────
  .get("/library/:id", ({ request, set, params }) => {
    const { err, ctx } = authGuard(request, set, "library:read");
    if (err) return err;

    const anime = db.query<{
      id: string; title: string; title_english: string | null; synopsis: string | null;
      poster_url: string | null; episode_count: number | null; downloaded_count: number;
      download_status: string | null; rating: number | null; year: number | null;
      genres: string | null; anilist_status: string | null; anilist_id: number | null;
    }, [string]>(
      `SELECT id, title, title_english, synopsis, poster_url, episode_count, downloaded_count,
              download_status, rating, year, genres, anilist_status, anilist_id
       FROM animes WHERE id = ?`
    ).get(params.id);

    if (!anime) {
      set.status = 404;
      return fail("not_found", "Anime not found");
    }

    const episodes = db.query<{
      number: number; season: number; title: string | null; status: string;
      file_path: string | null; watched: number; aired: string | null;
    }, [string]>(
      `SELECT number, season, title, status, file_path, watched, aired
       FROM episodes WHERE anime_id = ? ORDER BY season, number`
    ).all(params.id);

    logAudit(ctx!.keyId, "/api/v1/library/:id", "GET", 200, 0);
    return ok({
      ...anime,
      genres: anime.genres ? (() => { try { return JSON.parse(anime.genres!); } catch { return []; } })() : [],
      episodes,
    });
  }, {
    params: t.Object({ id: t.String() }),
  })

  // ── GET /api/v1/downloads?status= ──────────────────────────────────────────
  .get("/downloads", ({ request, set, query }) => {
    const { err, ctx } = authGuard(request, set, "downloads:read");
    if (err) return err;

    const all = getAllDownloads();
    const statusFilter = query.status;
    const jobs = (statusFilter ? all.filter((j) => j.status === statusFilter) : all).map((j) => ({
      id: j.id,
      animeId: j.animeId,
      animeTitle: j.animeTitle,
      episode: j.episodeNumber,
      season: j.season,
      status: j.status,
      progress: j.progress,
      speedKbps: j.speedKbps,
      provider: j.provider,
      errorMsg: j.errorMsg,
      errorCode: j.lastErrorCode,
      attemptCount: j.attemptCount,
      maxAttempts: j.maxAttempts,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
    }));

    logAudit(ctx!.keyId, "/api/v1/downloads", "GET", 200, 0);
    return ok({ jobs, total: jobs.length });
  }, {
    query: t.Object({ status: t.Optional(t.String()) }),
  })

  // ── POST /api/v1/queue ──────────────────────────────────────────────────────
  .post("/queue", ({ request, set, body, headers }) => {
    const { err, ctx } = authGuard(request, set, "queue:write");
    if (err) return err;

    const { animeId, episodes, season, sourceUrl } = body;

    if (!episodes.length || episodes.length > 100) {
      set.status = 422;
      return fail("validation_error", "episodes must be a non-empty array with at most 100 items");
    }

    const anime = db.query<{ id: string; title: string }, [string]>(
      `SELECT id, title FROM animes WHERE id = ?`
    ).get(animeId);

    if (!anime) {
      set.status = 404;
      return fail("not_found", "Anime not in library. Add it via the web UI first.");
    }

    // Idempotência: se Idempotency-Key for enviada, verifica downloads recentes (últimos 60s)
    const idempKey = headers["idempotency-key"] as string | undefined;
    if (idempKey) {
      const placeholders = episodes.map(() => "?").join(",");
      const stmt = db.prepare(
        `SELECT id FROM downloads
         WHERE anime_id = ? AND enqueued_at > datetime('now', '-60 seconds')
           AND episode_number IN (${placeholders})
         LIMIT 1`
      );
      const recent = stmt.get(animeId, ...episodes) as { id: string } | null;
      if (recent) {
        return { ok: true, message: "idempotent — already queued recently", queued: 0, jobs: [] };
      }
    }

    const t0 = performance.now();
    const jobs = enqueueDownloads(animeId, episodes, season ?? 1, sourceUrl);
    logAudit(ctx!.keyId, "/api/v1/queue", "POST", 200, performance.now() - t0);
    logger.info("external-api", `queued ${jobs.length} eps for "${anime.title}" via key ${ctx!.keyId}`);

    return {
      ok: true,
      message: "queued",
      queued: jobs.length,
      jobs: jobs.map((j) => ({
        id: j.id,
        episode: j.episodeNumber,
        season: j.season,
        status: j.status,
      })),
    };
  }, {
    body: t.Object({
      animeId: t.String(),
      episodes: t.Array(t.Number()),
      season: t.Optional(t.Number()),
      sourceUrl: t.Optional(t.String()),
    }),
    headers: t.Object({ "idempotency-key": t.Optional(t.String()) }, { additionalProperties: true }),
  })

  // ── GET /api/v1/providers ───────────────────────────────────────────────────
  .get("/providers", ({ request, set }) => {
    const { err, ctx } = authGuard(request, set, "search:read");
    if (err) return err;
    logAudit(ctx!.keyId, "/api/v1/providers", "GET", 200, 0);
    return ok({ providers: getProviderInfo() });
  });
