/**
 * Rotas de torrent: busca Nyaa.si + controle qBittorrent.
 */

import { Elysia, t } from "elysia";
import { randomUUID } from "crypto";
import { searchNyaa } from "../services/nyaa.ts";
import { searchAniRena } from "../services/anirena.ts";
import {
  qbtConnect, qbtIsEnabled, qbtAddMagnet, qbtAddTorrentUrl,
  qbtGetTorrents, qbtGetTorrent, qbtPause, qbtResume, qbtDelete,
  qbtGetCategories, mapQBState,
} from "../services/qbittorrent.ts";
import { getAllHealth, resetProvider } from "../services/circuit-breaker.ts";
import { generateSingleEpisodeNfoAsync } from "../services/jellyfin.ts";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";

function getConfig(key: string): string {
  return db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key)?.value ?? "";
}

// Monitora torrents ativos e atualiza a tabela downloads
const monitoredHashes = new Map<string, { jobId: string; animeId: string; episode: number; season: number }>();

let _monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startTorrentMonitor() {
  if (_monitorInterval) clearInterval(_monitorInterval);
  _monitorInterval = setInterval(async () => {
    if (!monitoredHashes.size) return;
    const hashes = [...monitoredHashes.keys()];
    const torrents = await qbtGetTorrents(hashes).catch(() => []);

    for (const torrent of torrents) {
      const meta = monitoredHashes.get(torrent.hash);
      if (!meta) continue;

      const status = mapQBState(torrent.state);
      const progress = Math.round(torrent.progress * 100);
      const speedKbps = Math.round(torrent.dlspeed / 1024);
      const downloadedBytes = torrent.downloaded ?? 0;
      const totalBytes = torrent.size ?? 0;
      const filePath = torrent.content_path ?? torrent.save_path ?? "";

      if (status === "completed") {
        db.run(
          `UPDATE downloads
           SET status='completed', progress=100, speed_kbps=0,
               downloaded_bytes=?, total_bytes=?, file_path=?,
               completed_at=datetime('now'), next_retry_at=NULL
           WHERE id=?`,
          [totalBytes, totalBytes, filePath, meta.jobId]
        );
        db.run(
          `UPDATE episodes SET status='downloaded', file_path=?, file_size_mb=?
           WHERE anime_id=? AND number=? AND season=?`,
          [filePath, Math.round(totalBytes / 1024 / 1024), meta.animeId, meta.episode, meta.season]
        );
        db.run(`UPDATE animes SET last_download=datetime('now') WHERE id=?`, [meta.animeId]);
        monitoredHashes.delete(torrent.hash);
        logger.info("torrent-monitor", JSON.stringify({ event: "completed", hash: torrent.hash, jobId: meta.jobId }));
        // Gera NFO e busca metadados Jikan de forma assíncrona
        if (filePath) void generateSingleEpisodeNfoAsync(meta.animeId, meta.episode, meta.season, filePath);
      } else if (status === "failed") {
        db.run(
          `UPDATE downloads SET status='failed', error_msg='qBittorrent reportou erro', speed_kbps=0 WHERE id=?`,
          [meta.jobId]
        );
        db.run(
          `UPDATE episodes SET status='missing' WHERE anime_id=? AND number=? AND season=?`,
          [meta.animeId, meta.episode, meta.season]
        );
        monitoredHashes.delete(torrent.hash);
      } else {
        db.run(
          `UPDATE downloads SET status='downloading', progress=?, speed_kbps=?, downloaded_bytes=?, total_bytes=?, file_path=?
           WHERE id=?`,
          [progress, speedKbps, downloadedBytes, totalBytes, filePath, meta.jobId]
        );
        db.run(
          `UPDATE episodes SET status='downloading', download_id=? WHERE anime_id=? AND number=? AND season=?`,
          [meta.jobId, meta.animeId, meta.episode, meta.season]
        );
      }
    }
  }, 5_000);
}

// Restaura monitores ao reiniciar: busca downloads torrent ativos
export function restoreTorrentMonitors() {
  const rows = db.query<{
    id: string; anime_id: string; episode_number: number; season: number; torrent_hash: string;
  }, []>(
    `SELECT id, anime_id, episode_number, season, torrent_hash
     FROM downloads
     WHERE download_type='torrent' AND torrent_hash IS NOT NULL AND status IN ('queued','downloading')`
  ).all();

  for (const row of rows) {
    monitoredHashes.set(row.torrent_hash, {
      jobId: row.id,
      animeId: row.anime_id,
      episode: row.episode_number,
      season: row.season,
    });
  }
  if (rows.length) logger.info("torrent-monitor", `Retomando monitoramento de ${rows.length} torrents`);
}

export const torrentRoutes = new Elysia()

  // ── Nyaa.si ───────────────────────────────────────────────────────────────

  .get("/nyaa/search", async ({ query }) => {
    const { q, category, group, resolution, limit } = query as {
      q?: string; category?: string; group?: string; resolution?: string; limit?: string;
    };
    if (!q?.trim()) return { error: "Parametro q eh obrigatorio" };

    const preferredGroup = group || getConfig("nyaa_preferred_group");
    const preferredResolution = resolution || getConfig("nyaa_preferred_resolution");

    try {
      const results = await searchNyaa(q, {
        category: category || "1_2",
        preferredGroup: preferredGroup || undefined,
        preferredResolution: preferredResolution || undefined,
        limit: parseInt(limit ?? "30"),
      });
      return { results, total: results.length, query: q };
    } catch (err) {
      logger.error("nyaa", String(err));
      return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
    }
  })

  .get("/anirena/search", async ({ query }) => {
    const { q, page, group, resolution, limit, includeInfoHash } = query as {
      q?: string;
      page?: string;
      group?: string;
      resolution?: string;
      limit?: string;
      includeInfoHash?: string;
    };
    if (!q?.trim()) return { error: "Parâmetro q é obrigatório" };

    try {
      const results = await searchAniRena(q, {
        page: page ? parseInt(page, 10) : 1,
        preferredGroup: group?.trim() || undefined,
        preferredResolution: resolution?.trim() || undefined,
        limit: parseInt(limit ?? "30", 10),
        includeInfoHash: includeInfoHash !== "false",
      });

      return { results, total: results.length, query: q };
    } catch (err) {
      logger.error("anirena", String(err));
      return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
    }
  })

  // ── qBittorrent ───────────────────────────────────────────────────────────

  .get("/torrent/status", async () => {
    const enabled = await qbtIsEnabled();
    if (!enabled) return { enabled: false, connected: false };
    const result = await qbtConnect();
    return { enabled, ...result };
  })

  .get("/torrent/list", async () => {
    const enabled = await qbtIsEnabled();
    if (!enabled) return { enabled: false, torrents: [] };
    const torrents = await qbtGetTorrents();
    return { enabled, torrents };
  })

  .get("/torrent/:hash", async ({ params }) => {
    const torrent = await qbtGetTorrent(params.hash);
    if (!torrent) return new Response(JSON.stringify({ error: "Torrent não encontrado" }), { status: 404 });
    return torrent;
  })

  .get("/torrent/categories", async () => {
    const enabled = await qbtIsEnabled();
    if (!enabled) return { categories: [] };
    return { categories: await qbtGetCategories() };
  })

  .post("/torrent/add", async ({ body }) => {
    const { magnetLink, torrentUrl, animeId, episodeNumber, season, infoHash, provider } = body as {
      magnetLink?: string;
      torrentUrl?: string;
      animeId?: string;
      episodeNumber?: number;
      season?: number;
      infoHash?: string;
      provider?: string;
    };

    if (!magnetLink && !torrentUrl) {
      return new Response(JSON.stringify({ error: "magnetLink ou torrentUrl são obrigatórios" }), { status: 422 });
    }

    if (magnetLink && !magnetLink.startsWith("magnet:?")) {
      return new Response(JSON.stringify({ error: "magnetLink inválido — deve começar com magnet:?" }), { status: 422 });
    }
    if (torrentUrl) {
      try {
        const u = new URL(torrentUrl);
        if (!["http:", "https:"].includes(u.protocol))
          return new Response(JSON.stringify({ error: "torrentUrl deve usar protocolo http ou https" }), { status: 422 });
      } catch {
        return new Response(JSON.stringify({ error: "torrentUrl inválida" }), { status: 422 });
      }
    }

    const enabled = await qbtIsEnabled();
    if (!enabled) {
      return new Response(JSON.stringify({ error: "qBittorrent não está habilitado. Ative em config: qbittorrent_enabled=true" }), { status: 400 });
    }

    const savePath = getConfig("qbittorrent_save_path") || getConfig("download_path");
    const category = "anime";

    let result: { ok: boolean; error?: string };
    if (magnetLink) {
      result = await qbtAddMagnet(magnetLink, { savePath, category });
    } else {
      result = await qbtAddTorrentUrl(torrentUrl!, { savePath, category });
    }

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500 });
    }

    // Cria registro na tabela downloads se fornecido animeId + episódio
    let jobId: string | null = null;
    if (animeId && episodeNumber != null) {
      const ep = season ?? 1;
      jobId = randomUUID();
      const hash = infoHash ?? "";
      const providerName = provider === "anirena" ? "anirena" : "nyaa";

      db.run(
        `INSERT OR IGNORE INTO downloads
         (id, anime_id, episode_number, season, status, provider, download_type, torrent_hash, magnet_link, source_url)
         VALUES (?, ?, ?, ?, 'queued', ?, 'torrent', ?, ?, ?)`,
        [jobId, animeId, episodeNumber, ep, providerName, hash, magnetLink ?? "", torrentUrl ?? ""]
      );

      db.run(
        `INSERT OR IGNORE INTO episodes (id, anime_id, number, season, status)
         VALUES (?, ?, ?, ?, 'queued')`,
        [randomUUID(), animeId, episodeNumber, ep]
      );

      if (hash) {
        monitoredHashes.set(hash, { jobId, animeId, episode: episodeNumber, season: ep });
      }

      logger.info("torrent", JSON.stringify({ event: "added", jobId, animeId, episode: episodeNumber, hash, provider: providerName }));
    }

    return { ok: true, jobId };
  })

  .post("/torrent/:hash/pause", async ({ params }) => {
    const ok = await qbtPause(params.hash);
    if (!ok) return new Response(JSON.stringify({ error: "Falha ao pausar" }), { status: 500 });
    db.run(`UPDATE downloads SET status='paused' WHERE torrent_hash=?`, [params.hash]);
    return { ok: true };
  })

  .post("/torrent/:hash/resume", async ({ params }) => {
    const ok = await qbtResume(params.hash);
    if (!ok) return new Response(JSON.stringify({ error: "Falha ao retomar" }), { status: 500 });
    db.run(`UPDATE downloads SET status='downloading' WHERE torrent_hash=?`, [params.hash]);
    return { ok: true };
  })

  .delete("/torrent/:hash", async ({ params, query }) => {
    const deleteFiles = (query as any).deleteFiles === "true";
    const ok = await qbtDelete(params.hash, deleteFiles);
    if (!ok) return new Response(JSON.stringify({ error: "Falha ao deletar torrent" }), { status: 500 });
    db.run(`UPDATE downloads SET status='cancelled' WHERE torrent_hash=? AND status IN ('queued','downloading','paused')`, [params.hash]);
    monitoredHashes.delete(params.hash);
    return { ok: true };
  })

  // ── Provider Health (circuit breaker) ────────────────────────────────────

  .get("/providers/health", () => {
    return { providers: getAllHealth() };
  })

  .post("/providers/:name/reset", ({ params }) => {
    const VALID_PROVIDERS = new Set([
      "animefire", "goyabu", "allanime", "nineanime",
      "animedrive", "superflix", "dattebayo", "nyaa",
    ]);
    if (!VALID_PROVIDERS.has(params.name))
      return new Response(JSON.stringify({ error: "Provider inválido" }), { status: 400 });
    resetProvider(params.name);
    return { ok: true, message: `Circuit breaker de '${params.name}' resetado` };
  });
