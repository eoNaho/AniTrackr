/**
 * Jikan v4 API (MyAnimeList unofficial).
 * Enriquece episódios com título, sinopse, filler, recap.
 */

export interface JikanEpisode {
  number: number;
  title: string;
  titleRomaji: string;
  titleJapanese: string;
  aired: string;
  durationSec: number;
  isFiller: boolean;
  isRecap: boolean;
  synopsis: string;
}

export interface JikanAnime {
  malId: number;
  title: string;
  titleEnglish: string;
  episodes: number;
  status: string;
  score: number;
  year: number | null;
  imageUrl: string;
}

const BASE = "https://api.jikan.moe/v4";
const RATE_LIMIT_MS = 400; // Jikan permite ~3 req/s; 400ms é seguro
let lastRequestAt = 0;

async function jikanFetch<T>(path: string): Promise<T | null> {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  try {
    const resp = await fetch(`${BASE}${path}`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      return jikanFetch<T>(path);
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    return data as T;
  } catch {
    return null;
  }
}

export async function jikanSearchAnime(query: string): Promise<JikanAnime[]> {
  const data = await jikanFetch<{ data: any[] }>(`/anime?q=${encodeURIComponent(query)}&limit=10`);
  if (!data?.data) return [];

  return data.data.map((a) => ({
    malId: a.mal_id,
    title: a.title,
    titleEnglish: a.title_english ?? "",
    episodes: a.episodes ?? 0,
    status: a.status ?? "",
    score: a.score ?? 0,
    year: a.year ?? null,
    imageUrl: a.images?.jpg?.large_image_url ?? "",
  }));
}

export async function jikanGetEpisode(malId: number, episodeNo: number): Promise<JikanEpisode | null> {
  const data = await jikanFetch<{ data: any }>(`/anime/${malId}/episodes/${episodeNo}`);
  if (!data?.data) return null;

  const ep = data.data;
  return {
    number: ep.mal_id ?? episodeNo,
    title: ep.title ?? "",
    titleRomaji: ep.title_romanji ?? "",
    titleJapanese: ep.title_japanese ?? "",
    aired: ep.aired ?? "",
    durationSec: (ep.duration ?? 0) * 60,
    isFiller: ep.filler ?? false,
    isRecap: ep.recap ?? false,
    synopsis: ep.synopsis ?? "",
  };
}

function parseEpisodeRow(ep: any): JikanEpisode {
  return {
    number: ep.mal_id,
    title: ep.title ?? "",
    titleRomaji: ep.title_romanji ?? "",
    titleJapanese: ep.title_japanese ?? "",
    aired: ep.aired ?? "",
    durationSec: 0,
    isFiller: ep.filler ?? false,
    isRecap: ep.recap ?? false,
    synopsis: ep.synopsis ?? "",
  };
}

export async function jikanGetEpisodes(
  malId: number,
  page = 1
): Promise<{ episodes: JikanEpisode[]; hasNextPage: boolean; lastPage: number }> {
  const data = await jikanFetch<{ data: any[]; pagination: any }>(
    `/anime/${malId}/episodes?page=${page}`
  );
  if (!data?.data) return { episodes: [], hasNextPage: false, lastPage: 1 };

  return {
    episodes: data.data.map(parseEpisodeRow),
    hasNextPage: data.pagination?.has_next_page ?? false,
    lastPage: data.pagination?.last_visible_page ?? 1,
  };
}

export async function jikanGetAllEpisodes(malId: number): Promise<JikanEpisode[]> {
  // Busca a primeira página para descobrir o total de páginas
  const first = await jikanGetEpisodes(malId, 1);
  if (!first.episodes.length) return [];
  if (first.lastPage <= 1) return first.episodes;

  // Busca páginas restantes com stagger de 450ms para respeitar 3 req/s do Jikan
  const remainingPages = Array.from({ length: first.lastPage - 1 }, (_, i) => i + 2);
  const rest = await Promise.all(
    remainingPages.map(async (page, idx) => {
      await new Promise((r) => setTimeout(r, idx * 450));
      return jikanGetEpisodes(malId, page);
    })
  );

  return [first.episodes, ...rest.map((r) => r.episodes)].flat();
}

export async function jikanGetAnimeById(malId: number): Promise<JikanAnime | null> {
  const data = await jikanFetch<{ data: any }>(`/anime/${malId}`);
  if (!data?.data) return null;

  const a = data.data;
  return {
    malId: a.mal_id,
    title: a.title,
    titleEnglish: a.title_english ?? "",
    episodes: a.episodes ?? 0,
    status: a.status ?? "",
    score: a.score ?? 0,
    year: a.year ?? null,
    imageUrl: a.images?.jpg?.large_image_url ?? "",
  };
}
