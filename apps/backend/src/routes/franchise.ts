import Elysia, { t } from "elysia";
import db from "../db/index.ts";

export const franchiseRoutes = new Elysia({ prefix: "/franchise" })
  .get("/", () => {
    const franchises = db.query<{
      series_title: string; season_count: number; total_eps: number;
      downloaded_count: number;
    }, []>(`
      SELECT COALESCE(NULLIF(series_title, ''), title) as series_title,
             COUNT(DISTINCT season_number) as season_count,
             SUM(episode_count) as total_eps,
             SUM(downloaded_count) as downloaded_count
      FROM animes
      GROUP BY COALESCE(NULLIF(series_title, ''), title)
      ORDER BY series_title ASC
    `).all();
    return { franchises };
  })

  .get("/:seriesTitle", ({ params }) => {
    const { seriesTitle } = params;

    const entries = db.query<{
      id: string; title: string; season_number: number;
      poster_url: string | null; episode_count: number;
      downloaded_count: number; download_status: string;
      anilist_status: string; year: number | null;
      watch_status: string;
    }, [string, string]>(`
      SELECT id, title, season_number, poster_url, episode_count,
             downloaded_count, download_status, anilist_status, year, watch_status
      FROM animes
      WHERE series_title = ? OR title = ?
      ORDER BY season_number ASC, year ASC
    `).all(seriesTitle, seriesTitle);

    return { seriesTitle, entries, totalSeasons: entries.length };
  }, {
    params: t.Object({ seriesTitle: t.String() }),
  });
