import Elysia from "elysia";
import { getAllHealth } from "../services/circuit-breaker.ts";
import { qbtIsEnabled, qbtConnect } from "../services/qbittorrent.ts";
import { getStatus as getJellyfinStatus } from "../services/jellyfin-connector.ts";
import db from "../db/index.ts";
import { existsSync } from "fs";

function getConfig(key: string): string {
  return db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key)?.value ?? "";
}

function isCommandAvailable(command: string): boolean {
  const value = command.trim();
  if (!value) return false;

  if (value.includes("/") || value.includes("\\")) {
    return existsSync(value);
  }

  try {
    return Bun.which(value) != null;
  } catch {
    return false;
  }
}

export const diagnosticsRoutes = new Elysia({ prefix: "/diagnostics" })
  .get("/", async () => {
    const providers = getAllHealth();
    const openProviders = Object.entries(providers)
      .filter(([, h]) => h.state === "open")
      .map(([name, h]) => ({ name, ...h }));

    const recentFailures = db.query<{
      anime_id: string; episode_number: number;
      error_msg: string | null; last_error_code: string | null;
    }, []>(`
      SELECT anime_id, episode_number, error_msg, last_error_code
      FROM downloads
      WHERE status = 'failed'
        AND completed_at > datetime('now', '-1 day')
      ORDER BY completed_at DESC
      LIMIT 20
    `).all();

    const qbtEnabled = await qbtIsEnabled();
    const qbtStatus = qbtEnabled ? await qbtConnect().catch(() => null) : null;
    const jellyfinStatus = getJellyfinStatus();

    const downloadPath = getConfig("download_path");
    const downloadPathValid = downloadPath ? existsSync(downloadPath) : false;
    const ytDlpPath = getConfig("yt_dlp_path") || "yt-dlp";
    const ffmpegPath = getConfig("ffmpeg_path") || "ffmpeg";
    const simulationEnabled = getConfig("allow_simulated_downloads") === "true";
    const ytDlpAvailable = isCommandAvailable(ytDlpPath);
    const ffmpegAvailable = isCommandAvailable(ffmpegPath);
    const realDownloadsReady = downloadPathValid && ytDlpAvailable && ffmpegAvailable;

    return {
      providers: { all: providers, open: openProviders },
      recentFailures,
      qbittorrent: {
        enabled: qbtEnabled,
        connected: qbtStatus?.ok === true,
        version: qbtStatus?.version ?? null,
      },
      downloadPath: { path: downloadPath, accessible: downloadPathValid },
      runtime: {
        simulationEnabled,
        ytDlpPath,
        ytDlpAvailable,
        ffmpegPath,
        ffmpegAvailable,
        realDownloadsReady,
      },
      jellyfin: {
        enabled: jellyfinStatus.enabled,
        configured: jellyfinStatus.configured,
        autoRefresh: jellyfinStatus.autoRefresh,
        pendingRefreshes: jellyfinStatus.pendingRefreshes,
        lastError: jellyfinStatus.lastError,
        lastTestAt: jellyfinStatus.lastTestAt,
        lastRefreshAt: jellyfinStatus.lastRefreshAt,
      },
      summary: {
        providersDown: openProviders.length,
        recentFailures: recentFailures.length,
        hasIssues:
          openProviders.length > 0 ||
          !downloadPathValid ||
          !ytDlpAvailable ||
          !ffmpegAvailable ||
          (qbtEnabled && qbtStatus?.ok !== true) ||
          (jellyfinStatus.enabled && !jellyfinStatus.configured),
      },
    };
  });
