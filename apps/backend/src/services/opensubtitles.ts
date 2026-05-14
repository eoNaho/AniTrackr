/**
 * OpenSubtitles REST API v3
 * Docs: https://opensubtitles.stoplight.io/docs/opensubtitles-api
 *
 * Endpoints utilizados:
 *   GET /api/v1/subtitles — busca por título + season + episode
 *   GET /api/v1/download  — obter link de download (requer conta para >5/dia)
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { logger } from "../utils/logger.ts";

const BASE = "https://api.opensubtitles.com/api/v1";
const APP_NAME = "goanime-tracker";
const APP_VERSION = "2.0.1";

const API_KEY = process.env.OPENSUBTITLES_API_KEY ?? "";

function osHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Api-Key": API_KEY,
    "User-Agent": `${APP_NAME} v${APP_VERSION}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export interface SubtitleFile {
  fileId: number;
  cdNumber: number;
  fileName: string;
}

export interface SubtitleResult {
  id: string;
  type: string;
  attributes: {
    language: string;
    downloadCount: number;
    newDownloadCount: number;
    hearingImpaired: boolean;
    foreignPartsOnly: boolean;
    uploadDate: string;
    release: string;
    comments: string;
    fromTrusted: boolean;
    ratings: number;
    votes: number;
    files: SubtitleFile[];
    featureDetails: {
      featureType: string;
      title: string;
      movieName: string;
      year: number;
      imdbId: string;
      seasonNumber: number;
      episodeNumber: number;
    };
  };
}

export interface SubSearchResult {
  totalCount: number;
  totalPages: number;
  results: SubtitleResult[];
}

/** Busca legendas por título, temporada e episódio */
export async function searchSubtitles(params: {
  query: string;
  season?: number;
  episode?: number;
  languages?: string[];    // "pt-BR", "en", etc.
  imdbId?: string;
  tmdbId?: number;
}): Promise<SubSearchResult> {
  if (!API_KEY) {
    logger.warn("opensubtitles", "OPENSUBTITLES_API_KEY não configurada — usando busca pública limitada");
  }

  const searchParams = new URLSearchParams();
  searchParams.set("query", params.query);
  if (params.season) searchParams.set("season_number", String(params.season));
  if (params.episode) searchParams.set("episode_number", String(params.episode));
  if (params.languages?.length) searchParams.set("languages", params.languages.join(","));
  if (params.imdbId) searchParams.set("imdb_id", params.imdbId.replace(/^tt/, ""));
  if (params.tmdbId) searchParams.set("tmdb_id", String(params.tmdbId));
  searchParams.set("order_by", "download_count");
  searchParams.set("order_direction", "desc");

  try {
    const url = `${BASE}/subtitles?${searchParams}`;
    logger.debug("opensubtitles", `search → ${url}`);
    const res = await fetch(url, {
      headers: osHeaders(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      total_count: number;
      total_pages: number;
      data: SubtitleResult[];
    };

    return {
      totalCount: json.total_count,
      totalPages: json.total_pages,
      results: json.data ?? [],
    };
  } catch (err) {
    logger.error("opensubtitles", `search failed: ${err}`);
    return { totalCount: 0, totalPages: 0, results: [] };
  }
}

/** Obtém o link de download para uma legenda (fileId) */
export async function getDownloadLink(
  fileId: number,
  token?: string
): Promise<{ link: string; fileName: string; remaining: number } | null> {
  try {
    const res = await fetch(`${BASE}/download`, {
      method: "POST",
      headers: osHeaders(token),
      body: JSON.stringify({ file_id: fileId, sub_format: "srt" }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.warn("opensubtitles", `getDownloadLink HTTP ${res.status}: ${body.slice(0, 100)}`);
      return null;
    }

    const json = (await res.json()) as {
      link: string;
      file_name: string;
      remaining: number;
    };

    return { link: json.link, fileName: json.file_name, remaining: json.remaining };
  } catch (err) {
    logger.error("opensubtitles", `getDownloadLink failed: ${err}`);
    return null;
  }
}

/** Baixa o arquivo de legenda para o disco ao lado do vídeo */
export async function downloadSubtitle(
  downloadLink: string,
  videoFilePath: string,
  language = "pt-BR",
  fileName?: string
): Promise<string | null> {
  try {
    const res = await fetch(downloadLink, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const content = await res.text();
    const ext = fileName?.endsWith(".ass") ? ".ass" : ".srt";
    const langCode = language.replace("-", "_");
    // Convenção Jellyfin: Video.pt-BR.srt ou Video.en.srt
    const srtPath = videoFilePath.replace(/\.(mkv|mp4|avi|m4v|webm)$/i, `.${langCode}${ext}`);

    mkdirSync(dirname(srtPath), { recursive: true });
    writeFileSync(srtPath, content, "utf-8");
    logger.info("opensubtitles", `Subtitle saved → ${srtPath}`);
    return srtPath;
  } catch (err) {
    logger.error("opensubtitles", `downloadSubtitle failed: ${err}`);
    return null;
  }
}

/** Busca + download em um passo só — retorna o path do .srt ou null */
export async function fetchAndSaveSubtitle(params: {
  query: string;
  season?: number;
  episode?: number;
  videoFilePath: string;
  languages?: string[];
  token?: string;
}): Promise<string | null> {
  const { results } = await searchSubtitles({
    query: params.query,
    season: params.season,
    episode: params.episode,
    languages: params.languages ?? ["pt-BR", "pt", "en"],
  });

  if (!results.length) {
    logger.warn("opensubtitles", `no results for "${params.query}" ep${params.episode}`);
    return null;
  }

  // Prefere pt-BR, trusted, mais downloads
  const sorted = results.sort((a, b) => {
    const langScore = (lang: string) =>
      lang.startsWith("pt") ? 2 : lang === "en" ? 1 : 0;
    const la = langScore(a.attributes.language);
    const lb = langScore(b.attributes.language);
    if (la !== lb) return lb - la;
    if (a.attributes.fromTrusted !== b.attributes.fromTrusted)
      return a.attributes.fromTrusted ? -1 : 1;
    return b.attributes.downloadCount - a.attributes.downloadCount;
  });

  const best = sorted[0];
  if (!best.attributes.files.length) return null;

  const fileId = best.attributes.files[0].fileId;
  const dlInfo = await getDownloadLink(fileId, params.token);
  if (!dlInfo) return null;

  return downloadSubtitle(dlInfo.link, params.videoFilePath, best.attributes.language, dlInfo.fileName);
}
