import { logger } from "../utils/logger.ts";

const ANILIST_URL = "https://graphql.anilist.co";

function normalizeAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function stripSeriesSuffixLocal(title: string): string {
  return title
    .replace(/\s*:?\s*\d{1,2}(?:st|nd|rd|th)?\s+season\b.*/i, "")
    .replace(/\s*:?\s*season\s+\d{1,2}\b.*/i, "")
    .replace(/\s*:\s*(?:the\s+)?final\s+season\b.*/i, "")
    .replace(/\s*:\s*(?:ichi|ni|san|yon|shi|go|roku|nana|shichi|hachi|kyu|ku|juu)\s+no\s+(?:shou|en|kai)\b.*/i, "")
    .replace(/\s*[-:]?\s*part\s+[\divxlc]+\s*$/i, "")
    .replace(/\s+(?:ii|iii|iv|vi{0,3}|ix|xi{0,3}|xii|xiii|xiv|xv)\s*$/i, "")
    .trim();
}

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

export interface AniListAiringEntry {
  airingAt: number;
  episode: number;
  media: {
    id: number;
    idMal: number | null;
    title: {
      romaji: string;
      english: string | null;
      native: string | null;
    };
    coverImage: { large: string; extraLarge: string; medium: string };
    status: AniListAnime["status"];
    episodes: number | null;
    format: string;
    popularity: number;
    isAdult: boolean;
    countryOfOrigin: string | null;
    nextAiringEpisode: { episode: number; airingAt: number } | null;
  };
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

const UPCOMING_AIRING_QUERY = `
query ($from: Int, $to: Int, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    airingSchedules(
      airingAt_greater: $from
      airingAt_lesser: $to
      sort: TIME
    ) {
      episode
      airingAt
      media {
        id
        idMal
        title { romaji english native }
        coverImage { large extraLarge medium }
        status
        episodes
        format
        popularity
        isAdult
        countryOfOrigin
        nextAiringEpisode { episode airingAt }
      }
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

export async function getUpcomingAiringSchedule(
  fromUnix: number,
  toUnix: number,
  page = 1,
  perPage = 50
): Promise<AniListAiringEntry[]> {
  const data = await gql<{
    Page: { airingSchedules: AniListAiringEntry[] };
  }>(UPCOMING_AIRING_QUERY, {
    from: fromUnix,
    to: toUnix,
    page,
    perPage,
  });
  return data?.Page?.airingSchedules ?? [];
}

/**
 * Resolve o título raiz da série a partir das relações AniList.
 *
 * Estratégia (sem chamadas extras à API):
 * 1. Percorre os PREQUELs TV já incluídos nas relações do item buscado.
 *    O prequel mais antigo disponível tende a ter o título mais limpo.
 * 2. Prefere o title.romaji para manter a mesma família de nomes usada pelos
 *    providers/scrapers e evitar drift entre "Fire Force" e
 *    "Enen no Shouboutai". Se não houver romaji, cai para english.
 * 3. Se não houver prequel, usa o título do próprio item após strip.
 */
export function resolveSeriesRootTitle(a: AniListAnime, preferredTitleHint?: string | null): string {
  const tvFormats = new Set(["TV", "TV_SHORT"]);
  const hint = preferredTitleHint ? normalizeAscii(stripSeriesSuffixLocal(preferredTitleHint)) : "";

  const candidates: Array<{ family: "romaji" | "english"; value: string }> = [];

  const prequels = (a.relations?.edges ?? [])
    .filter((e) => e.relationType === "PREQUEL" && tvFormats.has(e.node.format))
    .flatMap((e) => [
      e.node.title.romaji ? { family: "romaji" as const, value: e.node.title.romaji } : null,
      e.node.title.english ? { family: "english" as const, value: e.node.title.english } : null,
    ])
    .filter(Boolean) as Array<{ family: "romaji" | "english"; value: string }>;

  candidates.push(...prequels);
  if (a.title.romaji) candidates.push({ family: "romaji", value: a.title.romaji });
  if (a.title.english) candidates.push({ family: "english", value: a.title.english });

  let preferredFamily: "romaji" | "english" | null = null;
  if (hint) {
    preferredFamily = candidates.find((candidate) => normalizeAscii(stripSeriesSuffixLocal(candidate.value)) === hint)?.family ?? null;
  }

  const orderedCandidates = preferredFamily
    ? [
        ...candidates.filter((candidate) => candidate.family === preferredFamily),
        ...candidates.filter((candidate) => candidate.family !== preferredFamily),
      ]
    : candidates;

  for (const candidate of orderedCandidates) {
    const stripped = stripSeriesSuffixLocal(candidate.value);

    if (stripped.length > 0) {
      return stripped;
    }
  }

  return stripSeriesSuffixLocal(preferredTitleHint ?? a.title.romaji ?? a.title.english ?? "");
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
