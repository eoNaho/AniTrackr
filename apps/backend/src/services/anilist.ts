import { logger } from "../utils/logger.ts";

const ANILIST_URL = "https://graphql.anilist.co";

export interface AniListAnime {
  id: number;
  idMal: number | null;
  title: {
    romaji: string;
    english: string | null;
    native: string | null;
  };
  description: string | null;
  genres: string[];
  tags: { name: string; category: string }[];
  coverImage: { large: string; extraLarge: string; medium: string };
  bannerImage: string | null;
  averageScore: number | null;
  meanScore: number | null;
  status: "FINISHED" | "RELEASING" | "NOT_YET_RELEASED" | "CANCELLED" | "HIATUS";
  episodes: number | null;
  duration: number | null;
  format: string;
  season: string | null;
  seasonYear: number | null;
  startDate: { year: number | null; month: number | null; day: number | null };
  endDate: { year: number | null; month: number | null; day: number | null };
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  popularity: number;
  favourites: number;
  studios: { nodes: { id: number; name: string; isAnimationStudio: boolean }[] };
  relations: {
    edges: {
      relationType: string;
      node: { id: number; title: { romaji: string; english: string | null }; format: string };
    }[];
  };
  trailer: { id: string; site: string } | null;
  isAdult: boolean;
}

export interface AniListEpisode {
  id: number;
  episodeNumber: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  description: string | null;
  thumbnail: string | null;
  airDate: string | null;
  length: number | null;
}

const SEARCH_QUERY = `
query ($query: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(search: $query, type: ANIME) {
      id idMal
      title { romaji english native }
      description(asHtml: false)
      genres
      tags { name category }
      coverImage { large extraLarge medium }
      bannerImage
      averageScore meanScore
      status episodes duration format
      season seasonYear
      startDate { year month day }
      endDate { year month day }
      nextAiringEpisode { episode airingAt }
      popularity favourites
      studios { nodes { id name isAnimationStudio } }
      trailer { id site }
      isAdult
    }
  }
}`;

const DETAIL_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id idMal
    title { romaji english native }
    description(asHtml: false)
    genres
    tags { name category }
    coverImage { large extraLarge medium }
    bannerImage
    averageScore meanScore
    status episodes duration format
    season seasonYear
    startDate { year month day }
    endDate { year month day }
    nextAiringEpisode { episode airingAt }
    popularity favourites
    studios { nodes { id name isAnimationStudio } }
    relations {
      edges {
        relationType
        node { id title { romaji english } format }
      }
    }
    trailer { id site }
    isAdult
  }
}`;

const EPISODE_QUERY = `
query ($mediaId: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    airingSchedules(mediaId: $mediaId, sort: EPISODE) {
      id
      episode
      airingAt
      media { duration }
    }
  }
}`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      logger.warn("anilist", `GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
    }
    return json.data ?? null;
  } catch (err) {
    logger.error("anilist", `gql failed: ${err}`);
    return null;
  }
}

export async function searchAniList(
  query: string,
  page = 1,
  perPage = 10
): Promise<AniListAnime[]> {
  const data = await gql<{ Page: { media: AniListAnime[] } }>(SEARCH_QUERY, {
    query,
    page,
    perPage,
  });
  return data?.Page?.media ?? [];
}

export async function getAniListAnime(id: number): Promise<AniListAnime | null> {
  const data = await gql<{ Media: AniListAnime }>(DETAIL_QUERY, { id });
  return data?.Media ?? null;
}

export async function getAiringSchedule(
  mediaId: number,
  page = 1
): Promise<{ episode: number; airingAt: number; duration: number | null }[]> {
  const data = await gql<{
    Page: { airingSchedules: { id: number; episode: number; airingAt: number; media: { duration: number | null } }[] };
  }>(EPISODE_QUERY, { mediaId, page });
  return (data?.Page?.airingSchedules ?? []).map((s) => ({
    episode: s.episode,
    airingAt: s.airingAt,
    duration: s.media?.duration ?? null,
  }));
}

export function formatAniListAnime(a: AniListAnime) {
  return {
    anilistId: a.id,
    malId: a.idMal,
    title: a.title.english ?? a.title.romaji,
    titleRomaji: a.title.romaji,
    titleEnglish: a.title.english,
    titleNative: a.title.native,
    synopsis: a.description?.replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim() ?? null,
    posterUrl: a.coverImage.extraLarge ?? a.coverImage.large ?? a.coverImage.medium,
    bannerUrl: a.bannerImage,
    rating: a.averageScore != null ? a.averageScore / 10 : null,
    meanScore: a.meanScore != null ? a.meanScore / 10 : null,
    status: a.status,
    episodeCount: a.episodes,
    episodeLength: a.duration,
    format: a.format,
    season: a.season,
    year: a.seasonYear ?? a.startDate.year,
    startDate: a.startDate,
    genres: a.genres,
    tags: a.tags.slice(0, 10).map((t) => t.name),
    studios: a.studios.nodes.filter((s) => s.isAnimationStudio).map((s) => s.name),
    nextAiringEpisode: a.nextAiringEpisode,
    popularity: a.popularity,
    trailer: a.trailer,
    isAdult: a.isAdult,
    relations: a.relations?.edges?.map((e) => ({
      type: e.relationType,
      id: e.node.id,
      title: e.node.title.english ?? e.node.title.romaji,
      format: e.node.format,
    })) ?? [],
  };
}
