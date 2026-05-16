import Elysia from "elysia";
import { getAllHealth } from "../services/circuit-breaker.ts";
import { qbtIsEnabled, qbtConnect } from "../services/qbittorrent.ts";
import db from "../db/index.ts";
import { existsSync } from "fs";

function getConfig(key: string): string {
  return db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key)?.value ?? "";
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

    const downloadPath = getConfig("download_path");
    const downloadPathValid = downloadPath ? existsSync(downloadPath) : false;

    return {
      providers: { all: providers, open: openProviders },
      recentFailures,
      qbittorrent: {
        enabled: qbtEnabled,
        connected: qbtStatus?.ok === true,
        version: qbtStatus?.version ?? null,
      },
      downloadPath: { path: downloadPath, accessible: downloadPathValid },
      summary: {
        providersDown: openProviders.length,
        recentFailures: recentFailures.length,
        hasIssues: openProviders.length > 0 || !downloadPathValid || (qbtEnabled && qbtStatus?.ok !== true),
      },
    };
  });
