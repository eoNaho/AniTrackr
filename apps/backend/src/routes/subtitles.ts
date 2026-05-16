import Elysia, { t } from "elysia";
import { existsSync } from "fs";
import { searchSubtitles, getDownloadLink, fetchAndSaveSubtitle } from "../services/opensubtitles.ts";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";

export const subtitleRoutes = new Elysia({ prefix: "/subtitles" })

  // GET /api/subtitles/search?q=&season=&episode=&languages=pt-BR,en
  .get("/search", async ({ query }) => {
    const { q, season, episode, languages } = query;
    if (!q) return { error: "q é obrigatório" };

    const langs = languages?.split(",").map((l) => l.trim()).filter(Boolean) ?? ["pt-BR", "en"];
    logger.info("subtitles", `search q="${q}" s=${season ?? "-"} e=${episode ?? "-"} langs=${langs.join(",")}`);

    const result = await searchSubtitles({
      query: q,
      season: season ? parseInt(season) : undefined,
      episode: episode ? parseInt(episode) : undefined,
      languages: langs,
    });

    return {
      total: result.totalCount,
      results: result.results.map((r) => ({
        id: r.id,
        language: r.attributes.language,
        release: r.attributes.release,
        downloadCount: r.attributes.downloadCount,
        fromTrusted: r.attributes.fromTrusted,
        hearingImpaired: r.attributes.hearingImpaired,
        ratings: r.attributes.ratings,
        uploadDate: r.attributes.uploadDate,
        fileId: r.attributes.files[0]?.fileId,
        fileName: r.attributes.files[0]?.fileName,
        featureDetails: r.attributes.featureDetails,
      })),
    };
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      season: t.Optional(t.String()),
      episode: t.Optional(t.String()),
      languages: t.Optional(t.String()),
    }),
  })

  // POST /api/subtitles/download — baixa legenda por fileId para um episódio específico
  .post("/download", async ({ body }) => {
    const { fileId, animeId, episodeNumber, language } = body;

    // Busca o path do episódio no banco
    const ep = db.query<{ file_path: string | null }, [string, number]>(
      `SELECT file_path FROM episodes WHERE anime_id = ? AND number = ?`
    ).get(animeId, episodeNumber);

    if (!ep?.file_path) {
      return { error: "Episódio não encontrado ou sem arquivo local" };
    }

    const dlInfo = await getDownloadLink(fileId);
    if (!dlInfo) return { error: "Não foi possível obter link de download" };

    const { fetchAndSaveSubtitle: _unused, ...__ } = await import("../services/opensubtitles.ts");
    const { downloadSubtitle } = await import("../services/opensubtitles.ts");
    const srtPath = await downloadSubtitle(dlInfo.link, ep.file_path, language ?? "pt-BR", dlInfo.fileName);

    if (!srtPath) return { error: "Falha ao baixar legenda" };
    logger.info("subtitles", `saved to ${srtPath}`);
    return { ok: true, path: srtPath, remaining: dlInfo.remaining };
  }, {
    body: t.Object({
      fileId: t.Number(),
      animeId: t.String(),
      episodeNumber: t.Number(),
      language: t.Optional(t.String()),
    }),
  })

  // POST /api/subtitles/auto — busca e baixa automaticamente para um episódio
  .post("/auto", async ({ body }) => {
    const { animeId, episodeNumber, languages } = body;

    const anime = db.query<{ title: string; title_english: string | null }, [string]>(
      `SELECT title, title_english FROM animes WHERE id = ?`
    ).get(animeId);

    const ep = db.query<{ file_path: string | null; season: number }, [string, number]>(
      `SELECT file_path, season FROM episodes WHERE anime_id = ? AND number = ?`
    ).get(animeId, episodeNumber);

    if (!anime || !ep?.file_path) {
      return { error: "Anime/episódio não encontrado ou sem arquivo local" };
    }

    const query = anime.title_english ?? anime.title;
    const langs = languages ?? ["pt-BR", "pt", "en"];

    const path = await fetchAndSaveSubtitle({
      query,
      season: ep.season,
      episode: episodeNumber,
      videoFilePath: ep.file_path,
      languages: langs,
    });

    if (!path) return { error: "Legenda não encontrada para este episódio" };
    return { ok: true, path, language: langs[0] };
  }, {
    body: t.Object({
      animeId: t.String(),
      episodeNumber: t.Number(),
      languages: t.Optional(t.Array(t.String())),
    }),
  })

  // GET /api/subtitles/missing — episódios baixados sem arquivo de legenda
  .get("/missing", () => {
    const episodes = db.query<{
      anime_id: string; anime_title: string; episode_number: number;
      season: number; file_path: string;
    }, []>(`
      SELECT e.anime_id, a.title as anime_title, e.number as episode_number,
             e.season, e.file_path
      FROM episodes e
      JOIN animes a ON a.id = e.anime_id
      WHERE e.status = 'downloaded'
        AND e.file_path IS NOT NULL
        AND e.file_path != ''
    `).all();

    const missing = episodes.filter((ep) => {
      const base = ep.file_path.replace(/\.[^.]+$/, "");
      return !existsSync(`${base}.srt`) && !existsSync(`${base}.pt.srt`) && !existsSync(`${base}.pt-BR.srt`);
    });

    return { missing, total: missing.length };
  })

  // POST /api/subtitles/batch — baixa legendas faltantes em lote para um anime
  .post("/batch", async ({ body }) => {
    const { animeId, language } = body;

    const anime = db.query<{ title: string; title_english: string | null }, [string]>(
      `SELECT title, title_english FROM animes WHERE id = ?`
    ).get(animeId);
    if (!anime) return { error: "Anime não encontrado" };

    const episodes = db.query<{ number: number; season: number; file_path: string }, [string]>(`
      SELECT number, season, file_path
      FROM episodes
      WHERE anime_id = ? AND status = 'downloaded'
        AND file_path IS NOT NULL AND file_path != ''
      ORDER BY number
    `).all(animeId);

    const langs = language ? [language] : ["pt-BR", "pt", "en"];
    const query = anime.title_english ?? anime.title;
    const results: { episode: number; status: "ok" | "failed"; path?: string }[] = [];

    for (const ep of episodes) {
      if (!ep.file_path) continue;
      const path = await fetchAndSaveSubtitle({
        query,
        season: ep.season,
        episode: ep.number,
        videoFilePath: ep.file_path,
        languages: langs,
      });
      results.push({ episode: ep.number, status: path ? "ok" : "failed", path: path ?? undefined });
      await new Promise((r) => setTimeout(r, 1_000));
    }

    return {
      ok: true,
      animeId,
      total: results.length,
      downloaded: results.filter((r) => r.status === "ok").length,
      results,
    };
  }, {
    body: t.Object({
      animeId: t.String(),
      language: t.Optional(t.String()),
    }),
  })

  // POST /api/subtitles/auto-all — baixa legendas para todos eps de um anime
  .post("/auto-all", async ({ body }) => {
    const { animeId, languages } = body;
    const anime = db.query<{ title: string; title_english: string | null }, [string]>(
      `SELECT title, title_english FROM animes WHERE id = ?`
    ).get(animeId);
    if (!anime) return { error: "Anime não encontrado" };

    const episodes = db.query<{ number: number; season: number; file_path: string | null }, [string]>(
      `SELECT number, season, file_path FROM episodes WHERE anime_id = ? AND file_path IS NOT NULL AND file_path != '' ORDER BY number`
    ).all(animeId);

    const query = anime.title_english ?? anime.title;
    const langs = languages ?? ["pt-BR", "pt", "en"];
    const results: { episode: number; status: "ok" | "failed"; path?: string }[] = [];

    for (const ep of episodes) {
      if (!ep.file_path) continue;
      const path = await fetchAndSaveSubtitle({
        query,
        season: ep.season,
        episode: ep.number,
        videoFilePath: ep.file_path,
        languages: langs,
      });
      results.push({ episode: ep.number, status: path ? "ok" : "failed", path: path ?? undefined });
      // Pausa entre requests para não bater rate limit
      await new Promise((r) => setTimeout(r, 1_000));
    }

    return { ok: true, animeId, total: results.length, downloaded: results.filter((r) => r.status === "ok").length, results };
  }, {
    body: t.Object({
      animeId: t.String(),
      languages: t.Optional(t.Array(t.String())),
    }),
  });
