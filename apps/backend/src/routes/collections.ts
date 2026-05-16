import Elysia from "elysia";
import db from "../db/index.ts";

export const collectionsRoutes = new Elysia({ prefix: "/collections" })
  .get("/", () => {
    const releasing = db.query<{
      id: string; title: string; poster_url: string | null;
      next_release: string | null; downloaded_count: number; episode_count: number;
    }, []>(`
      SELECT id, title, poster_url, next_release, downloaded_count, episode_count
      FROM animes
      WHERE is_tracked = 1 AND anilist_status IN ('RELEASING', 'releasing')
      ORDER BY next_release ASC
    `).all();

    const complete = db.query<{
      id: string; title: string; poster_url: string | null;
      downloaded_count: number; episode_count: number; last_download: string | null;
    }, []>(`
      SELECT id, title, poster_url, downloaded_count, episode_count, last_download
      FROM animes
      WHERE download_status = 'Complete'
      ORDER BY last_download DESC
    `).all();

    const withRecentFailures = db.query<{
      id: string; title: string; poster_url: string | null;
    }, []>(`
      SELECT DISTINCT a.id, a.title, a.poster_url
      FROM animes a
      JOIN downloads d ON d.anime_id = a.id
      WHERE d.status = 'failed'
        AND d.completed_at > datetime('now', '-24 hours')
    `).all();

    const unwatched = db.query<{
      id: string; title: string; poster_url: string | null; downloaded_count: number;
    }, []>(`
      SELECT a.id, a.title, a.poster_url, a.downloaded_count
      FROM animes a
      WHERE a.downloaded_count > 0
        AND NOT EXISTS (
          SELECT 1 FROM episodes e
          WHERE e.anime_id = a.id AND e.watched = 1
        )
      ORDER BY a.last_download DESC
    `).all();

    const incompleteMetadata = db.query<{ id: string; title: string }, []>(`
      SELECT id, title
      FROM animes
      WHERE poster_url IS NULL OR poster_url = ''
         OR synopsis IS NULL OR synopsis = ''
      ORDER BY title
    `).all();

    const paused = db.query<{
      id: string; title: string; poster_url: string | null; watch_status: string;
    }, []>(`
      SELECT id, title, poster_url, watch_status
      FROM animes
      WHERE watch_status = 'paused'
    `).all();

    return { releasing, complete, withRecentFailures, unwatched, incompleteMetadata, paused };
  });
