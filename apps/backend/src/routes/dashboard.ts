import Elysia from "elysia";
import db from "../db/index.ts";

export const dashboardRoutes = new Elysia({ prefix: "/dashboard" })
  .get("/", () => {
    const recentlyDownloaded = db.query<{
      id: string; title: string; poster_url: string | null;
      episode_count: number; downloaded_count: number; last_download: string | null;
    }, []>(`
      SELECT id, title, poster_url, episode_count, downloaded_count, last_download
      FROM animes
      WHERE last_download > datetime('now', '-7 days')
      ORDER BY last_download DESC
      LIMIT 10
    `).all();

    const inProgress = db.query<{
      id: string; title: string; poster_url: string | null;
      downloaded_count: number; episode_count: number; download_status: string;
    }, []>(`
      SELECT id, title, poster_url, downloaded_count, episode_count, download_status
      FROM animes
      WHERE download_status = 'Partial'
      ORDER BY last_download DESC
      LIMIT 10
    `).all();

    const missingEpisodes = db.query<{
      id: string; title: string; poster_url: string | null;
      episode_count: number; downloaded_count: number; missing_count: number;
    }, []>(`
      SELECT id, title, poster_url, episode_count, downloaded_count,
             (episode_count - downloaded_count) as missing_count
      FROM animes
      WHERE is_tracked = 1
        AND episode_count > downloaded_count
        AND downloaded_count > 0
      ORDER BY missing_count DESC
      LIMIT 10
    `).all();

    const completed = db.query<{
      id: string; title: string; poster_url: string | null;
      episode_count: number; downloaded_count: number;
    }, []>(`
      SELECT id, title, poster_url, episode_count, downloaded_count
      FROM animes
      WHERE download_status = 'Complete'
      ORDER BY last_download DESC
      LIMIT 10
    `).all();

    return { recentlyDownloaded, inProgress, missingEpisodes, completed };
  });
