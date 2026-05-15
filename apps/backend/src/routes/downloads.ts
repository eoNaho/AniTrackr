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
import { getAutoScheduleStatus, triggerAutoScheduleNow } from "../services/auto-schedule.ts";
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
  const active = getActiveCount();
  if (active === 0) return;
  const jobs = getAllDownloads().filter((j) => j.status === "downloading" || j.status === "queued" || j.status === "retry_wait");
  broadcastDownloadUpdate({ type: "progress", jobs, activeCount: active, ts: Date.now() });
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
    const anime = db.query<{ id: string; title: string }, [string]>(
      `SELECT id, title FROM animes WHERE id = ?`
    ).get(animeId);
    if (!anime) return { error: `Anime "${animeId}" nao encontrado` };

    const jobs = enqueueDownloads(animeId, episodes, season ?? 1, sourceUrl ?? undefined);
    broadcastDownloadUpdate({ type: "enqueued", animeId, count: jobs.length, ts: Date.now() });
    logger.info("queue", `enqueued ${jobs.length} jobs for "${anime.title}"`);
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

    const anime = db.query<{ id: string; provider: string; source_url: string | null }, [string]>(
      `SELECT id, provider, source_url FROM animes WHERE id = ?`
    ).get(animeId);
    if (!anime) return { error: "Anime nao encontrado" };

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
      const jobs = enqueueDownloads(animeId, [epNumber], season ?? 1, sourceUrl);
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

  // GET /api/downloads/history — dados históricos para dashboard
  .get("/downloads/history", () => {
    const byMonth = db.query<{ month: string; count: number; total_bytes: number }, []>(`
      SELECT strftime('%Y-%m', completed_at) as month,
             COUNT(*) as count,
             COALESCE(SUM(total_bytes), 0) as total_bytes
      FROM downloads
      WHERE status = 'completed' AND completed_at IS NOT NULL
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `).all();

    const byProvider = db.query<{ provider: string; completed: number; failed: number }, []>(`
      SELECT provider,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM downloads
      GROUP BY provider
      ORDER BY completed DESC
    `).all();

    const totals = db.query<{ total: number; completed: number; failed: number; total_bytes: number }, []>(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN total_bytes ELSE 0 END), 0) as total_bytes
      FROM downloads
    `).get() ?? { total: 0, completed: 0, failed: 0, total_bytes: 0 };

    return { byMonth, byProvider, totals };
  })

  // GET /api/auto-schedule/status
  .get("/auto-schedule/status", () => getAutoScheduleStatus())

  // POST /api/auto-schedule/run — força verificação imediata
  .post("/auto-schedule/run", async () => {
    await triggerAutoScheduleNow();
    return { ok: true, message: "Verificação concluída" };
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
