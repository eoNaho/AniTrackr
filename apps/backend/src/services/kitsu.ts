import { logger } from "../utils/logger.ts";

const BASE = "https://kitsu.io/api/edge";

export interface KitsuAnime {
  id: string;
  type: string;
  attributes: {
    canonicalTitle: string;
    titles: Record<string, string>;
    synopsis: string | null;
    posterImage: { small: string; medium: string; large: string; original: string } | null;
    coverImage: { small: string; large: string; original: string } | null;
    averageRating: string | null;
    ratingRank: number | null;
    status: "current" | "finished" | "tba" | "unreleased" | "upcoming";
    episodeCount: number | null;
    episodeLength: number | null;
    startDate: string | null;
    endDate: string | null;
    subtype: string;
    ageRatingGuide: string | null;
    categories?: string[];
  };
}

export interface KitsuSearchResult {
  data: KitsuAnime[];
  meta: { count: number };
}

const headers = {
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
};

export async function searchKitsu(query: string, limit = 10): Promise<KitsuAnime[]> {
  try {
    const url = `${BASE}/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=${limit}&fields[anime]=canonicalTitle,titles,synopsis,posterImage,averageRating,status,episodeCount,startDate,subtype`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Kitsu HTTP ${res.status}`);
    const json = (await res.json()) as KitsuSearchResult;
    return json.data ?? [];
  } catch (err) {
    logger.error("kitsu", `searchKitsu failed: ${err}`);
    return [];
  }
}

export async function getKitsuAnime(kitsuId: string): Promise<KitsuAnime | null> {
  try {
    const url = `${BASE}/anime/${kitsuId}?include=categories`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Kitsu HTTP ${res.status}`);
    const json = (await res.json()) as { data: KitsuAnime };
    return json.data ?? null;
  } catch (err) {
    logger.error("kitsu", `getKitsuAnime(${kitsuId}) failed: ${err}`);
    return null;
  }
}

export function kitsuPoster(anime: KitsuAnime): string {
  return (
    anime.attributes.posterImage?.large ??
    anime.attributes.posterImage?.medium ??
    anime.attributes.posterImage?.small ??
    ""
  );
}

export function kitsuYear(anime: KitsuAnime): number | null {
  const d = anime.attributes.startDate;
  if (!d) return null;
  const y = parseInt(d.split("-")[0]);
  return isNaN(y) ? null : y;
}
