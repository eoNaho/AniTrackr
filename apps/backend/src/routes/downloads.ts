import Elysia, { t } from "elysia";
import {
  enqueueDownloads,
  getAllDownloads,
  cancelDownload,
  getQueueStats,
  getActiveCount,
} from "../services/downloader.ts";
import db from "../db/index.ts";
import { getMissingEpisodes } from "../services/scanner.ts";
import { logger } from "../utils/logger.ts";

// ── SSE broadcast store ────────────────────────────────────────────────────
type SSEClient = { send: (data: string) => void; close: () => void };
const sseClients = new Set<SSEClient>();

export function broadcastDownloadUpdate(payload: unknown) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.send(msg); } catch { sseClients.delete(client); }
  }
}

// Tick de broadcast automático a cada 1s enquanto houver downloads ativos
setInterval(() => {
  if (sseClients.size === 0) return;
  const active = getActiveCount();
  if (active === 0) return;
  const jobs = getAllDownloads().filter((j) => j.status === "downloading" || j.status === "queued");
  broadcastDownloadUpdate({ type: "progress", jobs, activeCount: active, ts: Date.now() });
}, 1_000);

export const downloadRoutes = new Elysia()

  // ── SSE: GET /api/downloads/stream ────────────────────────────────────────
  .get("/downloads/stream", ({ set }) => {
    set.headers["Content-Type"] = "text/event-stream";
    set.headers["Cache-Control"] = "no-cache";
    set.headers["Connection"] = "keep-alive";
    set.headers["Access-Control-Allow-Origin"] = "*";

    let closed = false;
    let controller: ReadableStreamDefaultController<string> | null = null;

    const stream = new ReadableStream<string>({
      start(ctrl) {
        controller = ctrl;
        const client: SSEClient = {
          send: (data) => { if (!closed) ctrl.enqueue(data); },
          close: () => { closed = true; try { ctrl.close(); } catch {} },
        };
        sseClients.add(client);
        logger.debug("sse", `client connected (total: ${sseClients.size})`);

        // Hello event
        ctrl.enqueue(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);
        // Estado inicial
        ctrl.enqueue(`data: ${JSON.stringify({ type: "snapshot", jobs: getAllDownloads(), ts: Date.now() })}\n\n`);

        // Limpeza automática quando conexão fecha (Bun detecta pelo abort)
        const cleanup = () => {
          closed = true;
          sseClients.delete(client);
          logger.debug("sse", `client disconnected (total: ${sseClients.size})`);
        };
        setTimeout(cleanup, 30 * 60 * 1000); // timeout máximo 30min
      },
      cancel() {
        closed = true;
      },
    });

    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  })

  // ── GET /api/downloads ─────────────────────────────────────────────────────
  .get("/downloads", ({ query }) => {
    const status = query.status;
    let jobs = getAllDownloads();
    if (status) jobs = jobs.filter((j) => j.status === status);
    return { active: getActiveCount(), total: jobs.length, jobs };
  }, {
    query: t.Object({ status: t.Optional(t.String()) }),
  })

  // ── GET /api/downloads/stats ──────────────────────────────────────────────
  .get("/downloads/stats", () => {
    const stats = getQueueStats();
    const recentCompleted = db.query<{
      id: string; anime_id: string; episode_number: number; status: string;
      completed_at: string | null; file_path: string;
    }, []>(
      `SELECT d.id, d.anime_id, d.episode_number, d.status, d.completed_at, d.file_path,
              a.title as anime_title
       FROM downloads d JOIN animes a ON a.id = d.anime_id
       WHERE d.status = 'completed'
       ORDER BY d.completed_at DESC LIMIT 10`
    ).all();
    return { ...stats, recentCompleted };
  })

  // ── POST /api/queue ───────────────────────────────────────────────────────
  .post("/queue", ({ body }) => {
    const { animeId, episodes, season, sourceUrl } = body;
    if (!animeId || !episodes?.length) {
      return { error: "animeId e episodes[] são obrigatórios" };
    }
    const anime = db.query<{ id: string; title: string }, [string]>(
      `SELECT id, title FROM animes WHERE id = ?`
    ).get(animeId);
    if (!anime) return { error: `Anime "${animeId}" não encontrado` };

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

  // ── POST /api/queue/missing — baixa eps faltando de UM anime ─────────────
  .post("/queue/missing", ({ body }) => {
    const { animeId, season } = body;
    const missing = getMissingEpisodes(animeId);
    if (!missing.length) return { ok: true, message: "Nenhum episódio faltando", queued: 0 };

    const jobs = enqueueDownloads(animeId, missing, season ?? 1);
    broadcastDownloadUpdate({ type: "enqueued", animeId, count: jobs.length, missing, ts: Date.now() });
    logger.info("queue", `queued ${missing.length} missing eps for ${animeId}`);
    return { ok: true, queued: jobs.length, missingEpisodes: missing };
  }, {
    body: t.Object({
      animeId: t.String(),
      season: t.Optional(t.Number()),
    }),
  })

  // ── POST /api/queue/missing-all — baixa eps faltando de TODOS os animes ──
  .post("/queue/missing-all", ({ body }) => {
    const { statusFilter } = (body as { statusFilter?: string }) ?? {};
    let query = `SELECT id, title, season_number FROM animes WHERE is_tracked = 1`;
    const params: string[] = [];
    if (statusFilter) {
      query += ` AND download_status = ?`;
      params.push(statusFilter);
    }
    const animes = db.query<{ id: string; title: string; season_number: number }, string[]>(query).all(...params);

    const queued: { animeId: string; title: string; count: number }[] = [];
    let totalQueued = 0;

    for (const anime of animes) {
      const missing = getMissingEpisodes(anime.id);
      if (!missing.length) continue;
      enqueueDownloads(anime.id, missing, anime.season_number);
      queued.push({ animeId: anime.id, title: anime.title, count: missing.length });
      totalQueued += missing.length;
    }

    broadcastDownloadUpdate({ type: "batch-enqueued", totalQueued, ts: Date.now() });
    logger.info("queue", `batch missing-all: queued ${totalQueued} eps across ${queued.length} animes`);
    return { ok: true, totalQueued, animes: queued };
  })

  // ── DELETE /api/downloads/:id ─────────────────────────────────────────────
  .delete("/downloads/:id", ({ params }) => {
    const cancelled = cancelDownload(params.id);
    if (!cancelled) return { error: "Job não encontrado ou já finalizado" };
    broadcastDownloadUpdate({ type: "cancelled", jobId: params.id, ts: Date.now() });
    logger.info("queue", `cancelled job ${params.id}`);
    return { ok: true };
  }, { params: t.Object({ id: t.String() }) })

  // ── DELETE /api/downloads/all — cancela tudo na fila ─────────────────────
  .delete("/downloads/all", () => {
    const queued = db.query<{ id: string }, []>(
      `SELECT id FROM downloads WHERE status IN ('queued','downloading')`
    ).all();
    let cancelled = 0;
    for (const { id } of queued) {
      if (cancelDownload(id)) cancelled++;
    }
    logger.info("queue", `cancelled all: ${cancelled} jobs`);
    return { ok: true, cancelled };
  });
