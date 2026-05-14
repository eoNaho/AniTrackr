/**
 * Gerador de arquivos NFO para Jellyfin/Kodi e download de posters locais.
 *
 * Estrutura gerada:
 *   <series_dir>/tvshow.nfo          — metadata da série
 *   <series_dir>/poster.jpg          — poster da série
 *   <series_dir>/fanart.jpg          — banner/cover
 *   <series_dir>/Season NN/           — pasta da temporada
 *   <series_dir>/Season NN/episode.nfo — metadata do episódio (nome igual ao mkv)
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { seriesDir, seasonDir } from "./naming.ts";

type AnimeRow = {
  id: string; title: string; title_english: string | null; title_romaji: string | null;
  title_native: string | null; synopsis: string | null; genres: string; tags: string;
  rating: number | null; anilist_id: number | null; mal_id: number | null;
  kitsu_id: string | null; year: number | null; episode_count: number;
  season_number: number; anilist_status: string; subtype: string;
  poster_url: string | null; cover_url: string | null; local_path: string;
  episode_length: number | null;
};

type EpisodeRow = {
  number: number; season: number; title: string | null;
  synopsis: string | null; aired: string | null; duration_min: number | null;
  file_path: string | null;
};

function safeJson<T>(s: string | null, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function xmlEscape(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function statusToNfo(s: string): string {
  if (s === "FINISHED" || s === "finished") return "Ended";
  if (s === "RELEASING" || s === "current") return "Continuing";
  return "Unknown";
}

/** Gera o tvshow.nfo no formato Jellyfin/Kodi */
function buildTvshowNfo(anime: AnimeRow): string {
  const title = anime.title_english ?? anime.title;
  const genres = safeJson<string[]>(anime.genres, []);
  const tags = safeJson<string[]>(anime.tags, []);

  const genreXml = genres.map((g) => `  <genre>${xmlEscape(g)}</genre>`).join("\n");
  const tagXml = tags
    .slice(0, 8)
    .map((t) => `  <tag>${xmlEscape(t)}</tag>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow>
  <title>${xmlEscape(title)}</title>
  <originaltitle>${xmlEscape(anime.title_romaji ?? anime.title)}</originaltitle>
  <sorttitle>${xmlEscape(title)}</sorttitle>
  <year>${anime.year ?? ""}</year>
  <rating>${anime.rating ?? ""}</rating>
  <plot>${xmlEscape(anime.synopsis)}</plot>
  <runtime>${anime.episode_length ?? ""}</runtime>
  <mpaa>TV-14</mpaa>
  <status>${statusToNfo(anime.anilist_status)}</status>
${genreXml}
${tagXml}
  <uniqueid type="anilist" default="true">${anime.anilist_id ?? ""}</uniqueid>
  <uniqueid type="myanimelist">${anime.mal_id ?? ""}</uniqueid>
  <uniqueid type="kitsu">${anime.kitsu_id ?? ""}</uniqueid>
</tvshow>`;
}

/** Gera o episodeXXXX.nfo */
function buildEpisodeNfo(ep: EpisodeRow, seriesTitle: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<episodedetails>
  <title>${xmlEscape(ep.title ?? "Episode " + ep.number)}</title>
  <showtitle>${xmlEscape(seriesTitle)}</showtitle>
  <season>${ep.season}</season>
  <episode>${ep.number}</episode>
  <aired>${ep.aired ?? ""}</aired>
  <runtime>${ep.duration_min ?? ""}</runtime>
  <plot>${xmlEscape(ep.synopsis)}</plot>
</episodedetails>`;
}

/** Baixa uma imagem de URL para path local */
async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, Buffer.from(buf));
    logger.info("jellyfin", `Downloaded image → ${destPath}`);
    return true;
  } catch (err) {
    logger.warn("jellyfin", `Image download failed (${url}): ${err}`);
    return false;
  }
}

export interface NfoResult {
  animeId: string;
  tvshowNfo: string;
  posterDownloaded: boolean;
  fanartDownloaded: boolean;
  episodesNfo: number;
  errors: string[];
}

/** Gera todos os NFOs e baixa imagens para um anime */
export async function generateNfo(animeId: string, downloadImages = true): Promise<NfoResult> {
  const anime = db.query<AnimeRow, [string]>(`SELECT * FROM animes WHERE id = ?`).get(animeId);
  if (!anime) throw new Error(`Anime ${animeId} não encontrado`);

  const result: NfoResult = {
    animeId,
    tvshowNfo: "",
    posterDownloaded: false,
    fanartDownloaded: false,
    episodesNfo: 0,
    errors: [],
  };

  // local_path pode incluir "Season XX" — tvshow.nfo vai na raiz da série
  const rawPath = anime.local_path || join(
    process.env.USERPROFILE ?? process.env.HOME ?? "~",
    "Anime",
    seriesDir(anime.title_english ?? anime.title, anime.year)
  );
  const serPath = rawPath.replace(/[\\/]Season\s*\d+\s*$/i, "");

  mkdirSync(serPath, { recursive: true });

  // tvshow.nfo
  const tvshowNfoPath = join(serPath, "tvshow.nfo");
  const nfoContent = buildTvshowNfo(anime);
  writeFileSync(tvshowNfoPath, nfoContent, "utf-8");
  result.tvshowNfo = tvshowNfoPath;
  logger.info("jellyfin", `tvshow.nfo → ${tvshowNfoPath}`);

  // Posters
  if (downloadImages) {
    if (anime.poster_url) {
      result.posterDownloaded = await downloadImage(
        anime.poster_url,
        join(serPath, "poster.jpg")
      );
    }
    if (anime.cover_url) {
      result.fanartDownloaded = await downloadImage(
        anime.cover_url,
        join(serPath, "fanart.jpg")
      );
    }
  }

  // Episode NFOs
  const episodes = db.query<EpisodeRow, [string]>(
    `SELECT number, season, title, synopsis, aired, duration_min, file_path
     FROM episodes WHERE anime_id = ? AND file_path IS NOT NULL AND file_path != ''
     ORDER BY season, number`
  ).all(animeId);

  const title = anime.title_english ?? anime.title;

  for (const ep of episodes) {
    const epNfoContent = buildEpisodeNfo(ep, title);
    // NFO tem o mesmo nome que o arquivo de vídeo mas extensão .nfo
    const videoPath = ep.file_path!;
    const nfoPath = videoPath.replace(/\.(mkv|mp4|avi|m4v|webm)$/i, ".nfo");

    // Garante que a pasta existe
    try {
      mkdirSync(dirname(nfoPath), { recursive: true });
      writeFileSync(nfoPath, epNfoContent, "utf-8");
      result.episodesNfo++;
    } catch (err) {
      result.errors.push(`ep${ep.number}: ${err}`);
    }
  }

  // Gera também season poster para cada temporada existente
  if (downloadImages && anime.poster_url) {
    const seasons = [...new Set(episodes.map((e) => e.season))];
    for (const s of seasons) {
      const seasonPath = join(serPath, seasonDir(s));
      mkdirSync(seasonPath, { recursive: true });
      const seasonPoster = join(seasonPath, "poster.jpg");
      if (!existsSync(seasonPoster)) {
        await downloadImage(anime.poster_url, seasonPoster);
      }
    }
  }

  return result;
}

/** Gera NFOs para todos os animes da biblioteca */
export async function generateNfoAll(downloadImages = false): Promise<{ total: number; done: number; errors: number }> {
  const animes = db.query<{ id: string }, []>(`SELECT id FROM animes WHERE is_tracked = 1`).all();
  let done = 0;
  let errors = 0;
  for (const { id } of animes) {
    try {
      await generateNfo(id, downloadImages);
      done++;
    } catch (err) {
      logger.warn("jellyfin", `generateNfo(${id}) failed: ${err}`);
      errors++;
    }
  }
  return { total: animes.length, done, errors };
}

/** Baixa poster e fanart para um anime sem gerar NFO */
export async function downloadPosters(animeId: string): Promise<{ poster: boolean; fanart: boolean }> {
  const anime = db.query<{ poster_url: string | null; cover_url: string | null; local_path: string; title: string; title_english: string | null; year: number | null }, [string]>(
    `SELECT poster_url, cover_url, local_path, title, title_english, year FROM animes WHERE id = ?`
  ).get(animeId);
  if (!anime) throw new Error(`Anime ${animeId} não encontrado`);

  const serPath = anime.local_path || join(
    process.env.USERPROFILE ?? process.env.HOME ?? "~",
    "Anime",
    seriesDir(anime.title_english ?? anime.title, anime.year)
  );

  mkdirSync(serPath, { recursive: true });

  const poster = anime.poster_url ? await downloadImage(anime.poster_url, join(serPath, "poster.jpg")) : false;
  const fanart = anime.cover_url ? await downloadImage(anime.cover_url, join(serPath, "fanart.jpg")) : false;

  return { poster, fanart };
}
