import { randomUUID } from "crypto";
import { dirname, basename } from "path";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { refreshSeries, refreshLibrary } from "./jellyfin-connector.ts";

export type RefreshType = "series" | "library";

type PendingRefresh = {
  id: string;
  anime_id: string;
  series_path: string;
  refresh_type: RefreshType;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
};

export function enqueueRefresh(animeId: string, seriesPath: string, refreshType: RefreshType = "series"): void {
  const existing = db.query<{ id: string }, [string]>(
    `SELECT id FROM pending_jellyfin_refreshes
     WHERE anime_id = ? AND status IN ('pending', 'processing')`
  ).get(animeId);

  if (existing) {
    logger.info("jellyfin_refresh", `Refresh já enfileirado para anime ${animeId}, ignorando`);
    return;
  }

  db.run(
    `INSERT INTO pending_jellyfin_refreshes (id, anime_id, series_path, refresh_type, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [randomUUID(), animeId, seriesPath, refreshType]
  );
  logger.info("jellyfin_refresh", `Refresh ${refreshType} enfileirado para anime ${animeId}`);
}

async function processOne(row: PendingRefresh): Promise<void> {
  db.run(
    `UPDATE pending_jellyfin_refreshes SET status = 'processing', updated_at = datetime('now') WHERE id = ?`,
    [row.id]
  );

  const result = row.refresh_type === "series" && row.series_path
    ? await refreshSeries(row.series_path)
    : await refreshLibrary();

  if (result.ok) {
    db.run(
      `UPDATE pending_jellyfin_refreshes SET status = 'done', updated_at = datetime('now') WHERE id = ?`,
      [row.id]
    );
    logger.info("jellyfin_refresh", `Refresh concluído para anime ${row.anime_id}`);
  } else {
    const attempts = row.attempt_count + 1;
    if (attempts >= 3) {
      db.run(
        `UPDATE pending_jellyfin_refreshes
         SET status = 'failed', attempt_count = ?, last_error = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [attempts, result.message, row.id]
      );
      logger.warn("jellyfin_refresh", `Refresh falhou permanentemente para anime ${row.anime_id}: ${result.message}`);
    } else {
      const delaySec = Math.min(60 * Math.pow(2, attempts), 600);
      const nextRetry = new Date(Date.now() + delaySec * 1000).toISOString();
      db.run(
        `UPDATE pending_jellyfin_refreshes
         SET status = 'pending', attempt_count = ?, last_error = ?, next_retry_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [attempts, result.message, nextRetry, row.id]
      );
      logger.warn("jellyfin_refresh", `Retry ${attempts} agendado para anime ${row.anime_id} às ${nextRetry}`);
    }
  }
}

export async function processRefreshQueue(): Promise<void> {
  const now = new Date().toISOString();
  const rows = db.query<PendingRefresh, [string]>(
    `SELECT * FROM pending_jellyfin_refreshes
     WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at ASC LIMIT 5`
  ).all(now);

  for (const row of rows) {
    try {
      await processOne(row);
    } catch (err) {
      logger.error("jellyfin_refresh", `processOne error for ${row.id}: ${err}`);
    }
  }
}

export function scheduleJellyfinRefresh(animeId: string, filePath: string): void {
  const jellyfinEnabled =
    db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get("jellyfin_enabled")?.value === "true";
  const autoRefresh =
    db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get("jellyfin_auto_refresh")?.value === "true";

  if (!jellyfinEnabled || !autoRefresh) return;

  // Deriva o caminho da série a partir do filePath (sobe de Season XX → série raiz)
  let serPath = dirname(filePath);
  if (/^season\s+\d+/i.test(basename(serPath))) {
    serPath = dirname(serPath);
  }

  enqueueRefresh(animeId, serPath, "series");
}

let _interval: ReturnType<typeof setInterval> | null = null;

export function startRefreshQueue(): void {
  if (_interval) return;
  _interval = setInterval(() => void processRefreshQueue(), 30_000);
  logger.info("jellyfin_refresh", "Fila de refresh Jellyfin iniciada (intervalo 30s)");
}
