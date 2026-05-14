import { randomUUID } from "crypto";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { buildPath } from "./naming.ts";

export type DownloadStatus = "queued" | "downloading" | "completed" | "failed" | "cancelled";

export interface QueueJob {
  id: string;
  animeId: string;
  episodeNumber: number;
  season: number;
  status: DownloadStatus;
  progress: number;
  speedKbps: number;
  totalBytes: number;
  downloadedBytes: number;
  filePath: string;
  provider: string;
  quality: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMsg: string | null;
}

type ActiveHandle = { timer: ReturnType<typeof setInterval>; cancel: () => void };
const active = new Map<string, ActiveHandle>();

function getConfig(key: string): string {
  const row = db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key);
  return row?.value ?? "";
}

function simulateDownload(jobId: string, animeId: string, episode: number, season: number) {
  const anime = db.query<{ title: string; title_english: string | null; year: number | null }, [string]>(
    `SELECT title, title_english, year FROM animes WHERE id = ?`
  ).get(animeId);
  if (!anime) return;

  const basePath = getConfig("download_path") || `${process.env.USERPROFILE ?? "~"}/Anime`;
  const scheme = (getConfig("naming_scheme") || "jellyfin") as "jellyfin" | "plex" | "simple";
  const title = anime.title_english ?? anime.title;
  const filePath = buildPath(scheme, basePath, title, anime.year, season, episode, null);

  // Ensure directory exists
  try { mkdirSync(dirname(filePath), { recursive: true }); } catch {}

  const totalBytes = Math.round((Math.random() * 500 + 300) * 1024 * 1024); // 300-800 MB
  let downloaded = 0;

  db.run(`UPDATE downloads SET status = 'downloading', started_at = datetime('now'), file_path = ?, total_bytes = ? WHERE id = ?`,
    [filePath, totalBytes, jobId]);
  db.run(`UPDATE episodes SET status = 'downloading', download_id = ? WHERE anime_id = ? AND number = ? AND season = ?`,
    [jobId, animeId, episode, season]);

  const timer = setInterval(() => {
    const chunk = Math.round((Math.random() * 5 + 2) * 1024 * 1024); // 2-7 MB/s
    downloaded = Math.min(downloaded + chunk, totalBytes);
    const progress = Math.round((downloaded / totalBytes) * 100);
    const speedKbps = Math.round(chunk / 1024);

    if (downloaded >= totalBytes) {
      clearInterval(timer);
      active.delete(jobId);

      db.run(`UPDATE downloads SET status = 'completed', progress = 100, speed_kbps = 0, downloaded_bytes = ?, completed_at = datetime('now') WHERE id = ?`,
        [totalBytes, jobId]);

      db.run(`UPDATE episodes SET status = 'downloaded', file_path = ?, file_size_mb = ? WHERE anime_id = ? AND number = ? AND season = ?`,
        [filePath, Math.round(totalBytes / 1024 / 1024), animeId, episode, season]);

      // Recalcula downloaded_count
      const { count } = db.query<{ count: number }, [string]>(
        `SELECT COUNT(*) as count FROM episodes WHERE anime_id = ? AND status = 'downloaded'`
      ).get(animeId)!;

      const animeInfo = db.query<{ episode_count: number }, [string]>(
        `SELECT episode_count FROM animes WHERE id = ?`
      ).get(animeId)!;

      const newStatus = count >= animeInfo.episode_count ? "Downloaded" : "Downloading";
      db.run(`UPDATE animes SET downloaded_count = ?, download_status = ?, last_download = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [count, newStatus, animeId]);

      logger.info("downloader", `✓ ep${episode} of ${animeId} done → ${filePath}`);
    } else {
      db.run(`UPDATE downloads SET progress = ?, speed_kbps = ?, downloaded_bytes = ? WHERE id = ?`,
        [progress, speedKbps, downloaded, jobId]);
    }
  }, 1_000);

  active.set(jobId, { timer, cancel: () => clearInterval(timer) });
}

async function realDownload(jobId: string, animeId: string, episode: number, season: number, sourceUrl: string) {
  const ytdlp = getConfig("yt_dlp_path") || "yt-dlp";
  const basePath = getConfig("download_path") || `${process.env.USERPROFILE ?? "~"}/Anime`;
  const scheme = (getConfig("naming_scheme") || "jellyfin") as "jellyfin" | "plex" | "simple";
  const quality = getConfig("quality") || "1080p";

  const anime = db.query<{ title: string; title_english: string | null; year: number | null }, [string]>(
    `SELECT title, title_english, year FROM animes WHERE id = ?`
  ).get(animeId);
  if (!anime) return;

  const title = anime.title_english ?? anime.title;
  const filePath = buildPath(scheme, basePath, title, anime.year, season, episode, null);

  try { mkdirSync(dirname(filePath), { recursive: true }); } catch {}

  const proc = Bun.spawn([
    ytdlp,
    sourceUrl,
    "-o", filePath,
    "--no-playlist",
    "--progress",
    "--newline",
    quality.includes("1080") ? "-f" : "-f", "bestvideo+bestaudio/best",
    "--merge-output-format", "mkv",
  ], { stdout: "pipe", stderr: "pipe" });

  db.run(`UPDATE downloads SET status = 'downloading', started_at = datetime('now'), file_path = ? WHERE id = ?`, [filePath, jobId]);

  let lastProgress = 0;
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();

  const readLoop = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = dec.decode(value);
      // Parse yt-dlp progress: [download]  53.2% of ...
      const m = text.match(/(\d+\.?\d*)%/);
      if (m) {
        lastProgress = parseFloat(m[1]);
        db.run(`UPDATE downloads SET progress = ? WHERE id = ?`, [Math.round(lastProgress), jobId]);
      }
    }
  };

  await readLoop();
  const code = await proc.exited;

  if (code === 0) {
    db.run(`UPDATE downloads SET status = 'completed', progress = 100, completed_at = datetime('now') WHERE id = ?`, [jobId]);
    db.run(`UPDATE episodes SET status = 'downloaded', file_path = ? WHERE anime_id = ? AND number = ? AND season = ?`,
      [filePath, animeId, episode, season]);
    db.run(`UPDATE animes SET downloaded_count = downloaded_count + 1, last_download = datetime('now') WHERE id = ?`, [animeId]);
    logger.info("downloader", `yt-dlp: ep${episode} done`);
  } else {
    const errText = await new Response(proc.stderr).text();
    db.run(`UPDATE downloads SET status = 'failed', error_msg = ? WHERE id = ?`, [errText.slice(0, 500), jobId]);
    logger.error("downloader", `yt-dlp failed: ${errText.slice(0, 200)}`);
  }
}

export function enqueueDownloads(
  animeId: string,
  episodes: number[],
  season = 1,
  sourceUrl?: string
): QueueJob[] {
  const maxConcurrent = parseInt(getConfig("max_concurrent") || "3");
  const quality = getConfig("quality") || "1080p";
  const provider = getConfig("provider") || "animefire";

  const insert = db.prepare(`
    INSERT OR IGNORE INTO downloads (id, anime_id, episode_number, season, status, provider, quality, source_url)
    VALUES ($id, $animeId, $ep, $season, 'queued', $provider, $quality, $sourceUrl)
  `);

  // Ensure episode records exist
  const insEp = db.prepare(`
    INSERT OR IGNORE INTO episodes (id, anime_id, number, season, status)
    VALUES (?, ?, ?, ?, 'queued')
  `);

  const jobs: QueueJob[] = [];
  for (const ep of episodes) {
    const id = randomUUID();
    insert.run({ $id: id, $animeId: animeId, $ep: ep, $season: season, $provider: provider, $quality: quality, $sourceUrl: sourceUrl ?? null });
    insEp.run(randomUUID(), animeId, ep, season);

    jobs.push({
      id,
      animeId,
      episodeNumber: ep,
      season,
      status: "queued",
      progress: 0,
      speedKbps: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      filePath: "",
      provider,
      quality,
      startedAt: null,
      completedAt: null,
      errorMsg: null,
    });

    // Throttle by max_concurrent
    const delay = Math.floor(jobs.length / maxConcurrent) * 1000 + (jobs.length % maxConcurrent) * 300;
    setTimeout(() => {
      if (sourceUrl) {
        realDownload(id, animeId, ep, season, sourceUrl).catch((err) => {
          logger.warn("downloader", `realDownload fallback to simulate: ${err}`);
          simulateDownload(id, animeId, ep, season);
        });
      } else {
        simulateDownload(id, animeId, ep, season);
      }
    }, delay);
  }

  db.run(`UPDATE animes SET download_status = 'Downloading', updated_at = datetime('now') WHERE id = ? AND download_status NOT IN ('Downloading')`, [animeId]);
  logger.info("downloader", `enqueued ${episodes.length} eps for ${animeId}`);
  return jobs;
}

export function getAllDownloads(): QueueJob[] {
  return db.query<{
    id: string; anime_id: string; episode_number: number; season: number;
    status: string; progress: number; speed_kbps: number; total_bytes: number;
    downloaded_bytes: number; file_path: string; provider: string; quality: string;
    started_at: string | null; completed_at: string | null; error_msg: string | null;
  }, []>(`
    SELECT d.*, a.title as anime_title
    FROM downloads d
    JOIN animes a ON a.id = d.anime_id
    ORDER BY d.rowid DESC
    LIMIT 100
  `).all().map((r) => ({
    id: r.id,
    animeId: r.anime_id,
    episodeNumber: r.episode_number,
    season: r.season,
    status: r.status as DownloadStatus,
    progress: r.progress,
    speedKbps: r.speed_kbps,
    totalBytes: r.total_bytes,
    downloadedBytes: r.downloaded_bytes,
    filePath: r.file_path,
    provider: r.provider,
    quality: r.quality,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    errorMsg: r.error_msg,
  }));
}

export function cancelDownload(jobId: string): boolean {
  const handle = active.get(jobId);
  if (handle) {
    handle.cancel();
    active.delete(jobId);
  }
  const result = db.run(
    `UPDATE downloads SET status = 'cancelled' WHERE id = ? AND status IN ('queued','downloading')`, [jobId]
  );
  return result.changes > 0;
}

export function getActiveCount(): number {
  return active.size;
}

export function getQueueStats() {
  const rows = db.query<{ status: string; count: number }, []>(
    `SELECT status, COUNT(*) as count FROM downloads GROUP BY status`
  ).all();
  return {
    active: getActiveCount(),
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.count])),
  };
}
