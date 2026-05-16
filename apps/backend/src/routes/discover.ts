import Elysia, { t } from "elysia";
import db from "../db/index.ts";
import { browseAniList, formatAniListAnime, getAniListAnime } from "../services/anilist.ts";

function getCurrentSeasonParts() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const season =
    month <= 3 ? "WINTER"
    : month <= 6 ? "SPRING"
    : month <= 9 ? "SUMMER"
    : "FALL";
  return { season, year };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function parseGenrePool(): string[] {
  const rows = db.query<{ genres: string | null }, []>(`
    SELECT genres FROM animes
    WHERE genres IS NOT NULL AND TRIM(genres) <> ''
    ORDER BY updated_at DESC
    LIMIT 120
  `).all();

  const pool = new Set<string>();
  for (const row of rows) {
    const rawValue = (row.genres ?? "").trim();
    if (!rawValue) continue;

    try {
      const parsed = JSON.parse(rawValue) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const normalized = typeof entry === "string" ? entry.trim() : "";
          if (normalized) pool.add(normalized);
        }
        continue;
      }
    } catch {
      // fall back to csv/plain parsing below
    }

    for (const raw of rawValue.split(",")) {
      const normalized = raw.replace(/[[\]"]/g, "").trim();
      if (normalized) pool.add(normalized);
    }
  }

  return [...pool];
}

const DEFAULT_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
];

export const discoverRoutes = new Elysia({ prefix: "/discover" })
  .get("/", async ({ query }) => {
    const { basedOn } = query;
    if (!basedOn) return { error: "ParÃ¢metro basedOn Ã© obrigatÃ³rio" };

    const anime = db.query<{
      anilist_id: number | null; title: string; genres: string;
    }, [string]>(`
      SELECT anilist_id, title, genres FROM animes WHERE id = ?
    `).get(basedOn);

    if (!anime?.anilist_id) {
      return { basedOn, recommendations: [], reason: "Sem anilist_id para buscar recomendaÃ§Ãµes" };
    }

    const anilistData = await getAniListAnime(anime.anilist_id).catch(() => null);
    if (!anilistData) return { basedOn, recommendations: [] };

    const libraryAnilistIds = new Set(
      db.query<{ anilist_id: number }, []>(
        `SELECT anilist_id FROM animes WHERE anilist_id IS NOT NULL`
      ).all().map((r) => r.anilist_id)
    );

    const related = (anilistData.relations?.edges ?? [])
      .filter((edge) =>
        !libraryAnilistIds.has(edge.node.id) &&
        ["SEQUEL", "PREQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE"].includes(edge.relationType) &&
        edge.node.format !== "MUSIC" && edge.node.format !== "MANGA"
      )
      .map((edge) => ({
        anilistId: edge.node.id,
        title: edge.node.title.english ?? edge.node.title.romaji,
        titleRomaji: edge.node.title.romaji,
        relationType: edge.relationType,
        format: edge.node.format,
      }))
      .slice(0, 10);

    return { basedOn, basedOnTitle: anime.title, recommendations: related };
  }, {
    query: t.Object({ basedOn: t.Optional(t.String()) }),
  })

  .get("/random", async ({ query }) => {
    const mode = query.mode ?? "mixed";
    const limit = Math.max(1, Math.min(parseInt(query.limit ?? "6", 10) || 6, 12));
    const trackedIds = new Set(
      db.query<{ anilist_id: number }, []>(`SELECT anilist_id FROM animes WHERE anilist_id IS NOT NULL`).all().map((row) => row.anilist_id)
    );

    const libraryGenres = parseGenrePool();
    const genrePool = libraryGenres.length > 0 ? libraryGenres : DEFAULT_GENRES;
    const selectedGenre = genrePool[Math.floor(Math.random() * genrePool.length)] ?? DEFAULT_GENRES[0];
    const { season, year } = getCurrentSeasonParts();

    const strategies = {
      mixed: {
        label: "mixed",
        sort: ["POPULARITY_DESC", "SCORE_DESC"],
        statusIn: ["RELEASING", "FINISHED"] as const,
        season: null,
        seasonYear: null,
      },
      releasing: {
        label: "releasing",
        sort: ["TRENDING_DESC", "POPULARITY_DESC"],
        statusIn: ["RELEASING"] as const,
        season,
        seasonYear: year,
      },
      backlog: {
        label: "backlog",
        sort: ["POPULARITY_DESC", "START_DATE_DESC"],
        statusIn: ["FINISHED"] as const,
        season: null,
        seasonYear: null,
      },
      hidden: {
        label: "hidden",
        sort: ["SCORE_DESC", "POPULARITY_DESC"],
        statusIn: ["FINISHED", "RELEASING"] as const,
        season: null,
        seasonYear: null,
      },
    } as const;

    const selectedStrategy = strategies[mode as keyof typeof strategies] ?? strategies.mixed;
    const page = Math.max(1, Math.floor(Math.random() * 6) + 1);

    const primaryBatch = await browseAniList({
      page,
      perPage: 24,
      sort: [...selectedStrategy.sort],
      statusIn: [...selectedStrategy.statusIn],
      formatIn: ["TV", "ONA", "MOVIE"],
      genreIn: selectedGenre ? [selectedGenre] : undefined,
      season: selectedStrategy.season,
      seasonYear: selectedStrategy.seasonYear,
    });

    const batch = primaryBatch.length > 0
      ? primaryBatch
      : await browseAniList({
          page: 1,
          perPage: 24,
          sort: [...selectedStrategy.sort],
          statusIn: [...selectedStrategy.statusIn],
          formatIn: ["TV", "ONA", "MOVIE"],
          season: selectedStrategy.season,
          seasonYear: selectedStrategy.seasonYear,
        });

    const picks = shuffle(batch)
      .filter((anime) => !trackedIds.has(anime.id))
      .filter((anime) => anime.format !== "MUSIC")
      .slice(0, limit)
      .map((anime) => formatAniListAnime(anime));

    return {
      mode: selectedStrategy.label,
      genre: selectedGenre,
      page,
      total: picks.length,
      picks,
    };
  }, {
    query: t.Object({
      mode: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  });
