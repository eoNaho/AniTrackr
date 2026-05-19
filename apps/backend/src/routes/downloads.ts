import Elysia, { t } from "elysia";
import {
  enqueueDownloads,
  getAllDownloads,
  cancelDownload,
  getQueueStats,
  getActiveCount,
  retryDownload,
  retryFailedDownloads,
  getDownloaderHealth,
} from "../services/downloader.ts";
import db from "../db/index.ts";
import { getMissingEpisodes } from "../services/scanner.ts";
import { getEpisodesWithFallback, type Provider } from "../services/provider-chain.ts";
import { logger } from "../utils/logger.ts";

type SSEClient = { send: (event: string, payload: unknown) => void; close: () => void };
const sseClients = new Set<SSEClient>();

function toSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function removeClient(client: SSEClient) {
  sseClients.delete(client);
  try {
    client.close();
  } catch {
    // noop
  }
}

export function broadcastDownloadUpdate(payload: unknown) {
  for (const client of sseClients) {
    try {
      client.send("downloads", payload);
    } catch {
      removeClient(client);
    }
  }
}

setInterval(() => {
  if (sseClients.size === 0) return;
  // getAllDownloads() lê do banco — inclui downloads torrent E yt-dlp
  const jobs = getAllDownloads().filter((j) => j.status === "downloading" || j.status === "queued" || j.status === "retry_wait");
  if (jobs.length === 0) return;
  broadcastDownloadUpdate({ type: "progress", jobs, activeCount: getActiveCount(), ts: Date.now() });
}, 1_000);

setInterval(() => {
  if (sseClients.size === 0) return;
  for (const client of sseClients) {
    try {
      client.send("ping", { type: "ping", ts: Date.now() });
    } catch {
      removeClient(client);
    }
  }
}, 15_000);

export const downloadRoutes = new Elysia()
  .get("/downloads/stream", () => {
    let closed = false;
    let cleanupRef: (() => void) | null = null;

    const stream = new ReadableStream<string>({
      start(ctrl) {
        const client: SSEClient = {
          send: (event, payload) => {
            if (closed) return;
            ctrl.enqueue(toSseEvent(event, payload));
          },
          close: () => {
            if (closed) return;
            closed = true;
            try {
              ctrl.close();
            } catch {
              // noop
            }
          },
        };

        cleanupRef = () => {
          if (closed) return;
          closed = true;
          sseClients.delete(client);
          logger.debug("sse", `client disconnected (total: ${sseClients.size})`);
          try {
            ctrl.close();
          } catch {
            // noop
          }
        };

        sseClients.add(client);
        logger.debug("sse", `client connected (total: ${sseClients.size})`);

        client.send("connected", { type: "connected", ts: Date.now() });
        client.send("snapshot", { type: "snapshot", jobs: getAllDownloads(), ts: Date.now() });
      },
      cancel() {
        if (cleanupRef) cleanupRef();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  })

  .get("/downloads", ({ query }) => {
    const status = query.status;
    let jobs = getAllDownloads();
    if (status) jobs = jobs.filter((j) => j.status === status);
    return { active: getActiveCount(), total: jobs.length, jobs };
  }, {
    query: t.Object({ status: t.Optional(t.String()) }),
  })

  .get("/downloads/stats", () => {
    const stats = getQueueStats();
    const recentCompleted = db.query<{
      id: string;
      anime_id: string;
      episode_number: number;
      status: string;
      completed_at: string | null;
      file_path: string;
      anime_title: string;
    }, []>(
      `SELECT d.id, d.anime_id, d.episode_number, d.status, d.completed_at, d.file_path,
              a.title as anime_title
       FROM downloads d JOIN animes a ON a.id = d.anime_id
       WHERE d.status = 'completed'
       ORDER BY d.completed_at DESC LIMIT 10`
    ).all();
    return { ...stats, recentCompleted };
  })

  .get("/downloads/health", () => getDownloaderHealth())

  .get("/downloads/analytics", () => {
    const downloadsPerDay = db.query<{ date: string; count: number; total_bytes: number }, []>(`
      SELECT
        date(completed_at) as date,
        COUNT(*) as count,
        COALESCE(SUM(total_bytes), 0) as total_bytes
      FROM downloads
      WHERE status = 'completed'
        AND completed_at IS NOT NULL
        AND completed_at > datetime('now', '-14 days')
      GROUP BY date(completed_at)
      ORDER BY date ASC
    `).all();

    const totals = db.query<{ total_bytes: number; total_count: number; avg_speed_kbps: number }, []>(`
      SELECT
        COALESCE(SUM(total_bytes), 0) as total_bytes,
        COUNT(*) as total_count,
        COALESCE(AVG(NULLIF(speed_kbps, 0)), 0) as avg_speed_kbps
      FROM downloads
      WHERE status = 'completed'
    `).get() ?? { total_bytes: 0, total_count: 0, avg_speed_kbps: 0 };

    const byProvider = db.query<{ provider: string; count: number }, []>(`
      SELECT provider, COUNT(*) as count
      FROM downloads
      WHERE status = 'completed'
      GROUP BY provider
      ORDER BY count DESC
    `).all();

    const topAnimes = db.query<{ anime_title: string; count: number }, []>(`
      SELECT a.title as anime_title, COUNT(d.id) as count
      FROM downloads d
      JOIN animes a ON a.id = d.anime_id
      WHERE d.status = 'completed'
      GROUP BY d.anime_id
      ORDER BY count DESC
      LIMIT 5
    `).all();

    // ── health ────────────────────────────────────────────────────────────────
    const health24h = db.query<{ completed: number; failed: number; total: number }, []>(`
      SELECT
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(*) as total
      FROM downloads
      WHERE started_at IS NOT NULL
        AND started_at > datetime('now', '-24 hours')
    `).get() ?? { completed: 0, failed: 0, total: 0 };

    const retryWaitCount = db.query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM downloads WHERE status = 'retry_wait'`
    ).get()?.count ?? 0;

    const topErrors = db.query<{ code: string; count: number }, []>(`
      SELECT last_error_code as code, COUNT(*) as count
      FROM downloads
      WHERE status = 'failed'
        AND last_error_code IS NOT NULL
        AND last_error_code != ''
        AND started_at > datetime('now', '-7 days')
      GROUP BY last_error_code
      ORDER BY count DESC
      LIMIT 5
    `).all();

    const failedByProvider = db.query<{ provider: string; count: number }, []>(`
      SELECT provider, COUNT(*) as count
      FROM downloads
      WHERE status = 'failed'
        AND started_at > datetime('now', '-7 days')
      GROUP BY provider
      ORDER BY count DESC
      LIMIT 5
    `).all();

    const successRate24h = health24h.total > 0
      ? Math.round((health24h.completed / health24h.total) * 100)
      : null;

    return {
      downloadsPerDay, totals, byProvider, topAnimes,
      health: { successRate24h, retryWaitCount, topErrors, failedByProvider, window24h: health24h },
    };
  })

  .post("/downloads/:id/retry", ({ params }) => {
    const ok = retryDownload(params.id);
    if (!ok) return { error: "Job nao encontrado para retry (status permitido: failed/cancelled/retry_wait)" };
    broadcastDownloadUpdate({ type: "retried", jobId: params.id, ts: Date.now() });
    logger.info("queue", `manual retry ${params.id}`);
    return { ok: true };
  }, { params: t.Object({ id: t.String() }) })

  .post("/downloads/retry-failed", ({ body }) => {
    const limit = Math.max(1, Math.min(200, body?.limit ?? 25));
    const result = retryFailedDownloads(limit);
    broadcastDownloadUpdate({ type: "retry-batch", ...result, ts: Date.now() });
    logger.info("queue", `retry-failed requested=${result.requested} retried=${result.retried}`);
    return { ok: true, ...result };
  }, {
    body: t.Optional(t.Object({ limit: t.Optional(t.Number()) })),
  })

  .post("/queue", ({ body }) => {
    const { animeId, episodes, season, sourceUrl } = body;
    if (!animeId || !episodes?.length) {
      return { error: "animeId e episodes[] sao obrigatorios" };
    }
    logger.info("queue", `request anime=${animeId} episodes=${episodes.join(",")} season=${season ?? "auto"} source=${sourceUrl ?? "-"}`);
    const anime = db.query<{ id: string; title: string; season_number: number }, [string]>(
      `SELECT id, title, season_number FROM animes WHERE id = ?`
    ).get(animeId);
    if (!anime) return { error: `Anime "${animeId}" nao encontrado` };

    const effectiveSeason = season ?? anime.season_number ?? 1;
    const jobs = enqueueDownloads(animeId, episodes, effectiveSeason, sourceUrl ?? undefined);
    broadcastDownloadUpdate({ type: "enqueued", animeId, count: jobs.length, ts: Date.now() });
    logger.info("queue", `enqueued ${jobs.length} jobs for "${anime.title}" (season=${effectiveSeason})`);
    return { ok: true, queued: jobs.length, jobs };
  }, {
    body: t.Object({
      animeId: t.String(),
      episodes: t.Array(t.Number()),
      season: t.Optional(t.Number()),
      sourceUrl: t.Optional(t.String()),
    }),
  })

  .post("/queue/missing", async ({ body }) => {
    const { animeId, season } = body;
    const missing = getMissingEpisodes(animeId);
    if (!missing.length) return { ok: true, message: "Nenhum episodio faltando", queued: 0 };

    const anime = db.query<{ id: string; provider: string; source_url: string | null; season_number: number }, [string]>(
      `SELECT id, provider, source_url, season_number FROM animes WHERE id = ?`
    ).get(animeId);
    if (!anime) return { error: "Anime nao encontrado" };

    const effectiveSeason = season ?? anime.season_number ?? 1;

    const episodeUrlByNumber = new Map<number, string>();
    if (anime.source_url) {
      try {
        const eps = await getEpisodesWithFallback(
          anime.source_url,
          (anime.provider as Provider) ?? "animefire"
        );
        for (const ep of eps) {
          episodeUrlByNumber.set(ep.number, ep.url);
        }
      } catch (err) {
        logger.warn("queue", `missing-url-resolve failed for ${animeId}: ${String(err)}`);
      }
    }

    let totalQueued = 0;
    for (const epNumber of missing) {
      const sourceUrl = episodeUrlByNumber.get(epNumber) ?? anime.source_url ?? undefined;
      const jobs = enqueueDownloads(animeId, [epNumber], effectiveSeason, sourceUrl);
      totalQueued += jobs.length;
    }

    broadcastDownloadUpdate({ type: "enqueued", animeId, count: totalQueued, missing, ts: Date.now() });
    logger.info("queue", `queued ${totalQueued} missing eps for ${animeId}`);
    return { ok: true, queued: totalQueued, missingEpisodes: missing };
  }, {
    body: t.Object({
      animeId: t.String(),
      season: t.Optional(t.Number()),
    }),
  })

  .post("/queue/missing-all", async ({ body }) => {
    const { statusFilter } = (body as { statusFilter?: string }) ?? {};
    let query = `SELECT id, title, season_number, provider, source_url FROM animes WHERE is_tracked = 1`;
    const params: string[] = [];
    if (statusFilter) {
      query += ` AND download_status = ?`;
      params.push(statusFilter);
    }
    const animes = db.query<{
      id: string;
      title: string;
      season_number: number;
      provider: string;
      source_url: string | null;
    }, string[]>(query).all(...params);

    const queued: { animeId: string; title: string; count: number }[] = [];
    let totalQueued = 0;

    // Processa em lotes de 5 para não saturar os providers
    const BATCH_SIZE = 5;
    for (let i = 0; i < animes.length; i += BATCH_SIZE) {
      const batch = animes.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (anime) => {
          const missing = getMissingEpisodes(anime.id);
          if (!missing.length) return null;

          const episodeUrlByNumber = new Map<number, string>();
          if (anime.source_url) {
            try {
              const eps = await getEpisodesWithFallback(
                anime.source_url,
                (anime.provider as Provider) ?? "animefire"
              );
              for (const ep of eps) episodeUrlByNumber.set(ep.number, ep.url);
            } catch (err) {
              logger.warn("queue", `missing-all url resolve failed for ${anime.id}: ${String(err)}`);
            }
          }

          let animeQueued = 0;
          for (const epNumber of missing) {
            const sourceUrl = episodeUrlByNumber.get(epNumber) ?? anime.source_url ?? undefined;
            const jobs = enqueueDownloads(anime.id, [epNumber], anime.season_number, sourceUrl);
            animeQueued += jobs.length;
          }
          return animeQueued > 0 ? { animeId: anime.id, title: anime.title, count: animeQueued } : null;
        })
      );

      for (const res of batchResults) {
        if (res.status === "fulfilled" && res.value) {
          queued.push(res.value);
          totalQueued += res.value.count;
        }
      }
    }

    broadcastDownloadUpdate({ type: "batch-enqueued", totalQueued, ts: Date.now() });
    logger.info("queue", `batch missing-all: queued ${totalQueued} eps across ${queued.length} animes`);
    return { ok: true, totalQueued, animes: queued };
  })

  .delete("/downloads/:id", ({ params }) => {
    const cancelled = cancelDownload(params.id);
    if (!cancelled) return { error: "Job nao encontrado ou ja finalizado" };
    broadcastDownloadUpdate({ type: "cancelled", jobId: params.id, ts: Date.now() });
    logger.info("queue", `cancelled job ${params.id}`);
    return { ok: true };
  }, { params: t.Object({ id: t.String() }) })

  .delete("/downloads/all", () => {
    const queued = db.query<{ id: string }, []>(
      `SELECT id FROM downloads WHERE status IN ('queued','downloading','retry_wait')`
    ).all();
    let cancelled = 0;
    for (const { id } of queued) {
      if (cancelDownload(id)) cancelled += 1;
    }
    logger.info("queue", `cancelled all: ${cancelled} jobs`);
    return { ok: true, cancelled };
  })

  .delete("/downloads/monitor", () => {
    const before = db.query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM downloads WHERE status IN ('completed','failed','cancelled')`
    ).get()?.count ?? 0;

    db.run(`DELETE FROM downloads WHERE status IN ('completed','failed','cancelled')`);

    const jobs = getAllDownloads();
    broadcastDownloadUpdate({ type: "snapshot", jobs, ts: Date.now() });
    logger.info("queue", `monitor cleanup: removed ${before} finalized jobs`);
    return { ok: true, removed: before, remaining: jobs.length };
  });
