import Elysia from "elysia";
import db from "../db/index.ts";
import { existsSync } from "fs";

export const integrityRoutes = new Elysia({ prefix: "/integrity" })
  .get("/", () => {
    const episodesWithPath = db.query<{
      id: string; anime_id: string; number: number; file_path: string;
    }, []>(`
      SELECT id, anime_id, number, file_path
      FROM episodes
      WHERE file_path IS NOT NULL AND file_path != '' AND status = 'downloaded'
    `).all();

    const orphanedFiles = episodesWithPath.filter((ep) => !existsSync(ep.file_path));

    const duplicates = db.query<{
      anime_id: string; number: number; season: number; count: number;
    }, []>(`
      SELECT anime_id, number, season, COUNT(*) as count
      FROM episodes
      GROUP BY anime_id, number, season
      HAVING count > 1
    `).all();

    const noPoster = db.query<{ id: string; title: string }, []>(`
      SELECT id, title FROM animes
      WHERE poster_url IS NULL OR poster_url = ''
      LIMIT 50
    `).all();

    const noSynopsis = db.query<{ id: string; title: string }, []>(`
      SELECT id, title FROM animes
      WHERE synopsis IS NULL OR synopsis = ''
      LIMIT 50
    `).all();

    const totalIssues = orphanedFiles.length + duplicates.length + noPoster.length;

    return {
      orphanedFiles: { count: orphanedFiles.length, items: orphanedFiles.slice(0, 50) },
      duplicateEpisodes: { count: duplicates.length, items: duplicates },
      missingMetadata: {
        noPoster: { count: noPoster.length, items: noPoster },
        noSynopsis: { count: noSynopsis.length, items: noSynopsis },
      },
      summary: {
        totalIssues,
        hasIssues: totalIssues > 0,
      },
    };
  });
