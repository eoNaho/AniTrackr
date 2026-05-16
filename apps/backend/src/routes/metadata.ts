import Elysia, { t } from "elysia";
import type { SQLQueryBindings } from "bun:sqlite";
import { searchKitsu, getKitsuAnime, kitsuPoster, kitsuYear } from "../services/kitsu.ts";
import { searchAniList, getAniListAnime, formatAniListAnime, getAiringSchedule, resolveSeriesRootTitle } from "../services/anilist.ts";
import { jikanSearchAnime, jikanGetEpisode, jikanGetAllEpisodes } from "../services/jikan.ts";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { randomUUID } from "crypto";
import { stripSeasonSuffix } from "../services/naming.ts";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asNullableFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanSearchCandidate(value: string): string {
  return stripSeasonSuffix(value)
    .replace(/\((?:dublado|legendado|dub|sub)\)/gi, " ")
    .replace(/\b(?:dublado|legendado|dub|sub)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueCandidates(...values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const value of values) {
    if (!value?.trim()) continue;
    for (const candidate of [value.trim(), cleanSearchCandidate(value)]) {
      if (!candidate) continue;
      const key = normalizeAscii(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates;
}

async function resolveAniListForAnime(input: {
  title: string;
  titleEnglish: string | null;
  titleRomaji?: string | null;
  seriesTitle?: string | null;
}): Promise<Awaited<ReturnType<typeof getAniListAnime>> | Awaited<ReturnType<typeof searchAniList>>[number] | null> {
  const candidates = uniqueCandidates(
    input.titleEnglish,
    input.titleRomaji,
    input.seriesTitle,
    input.title,
  );

  for (const candidate of candidates) {
    const results = await searchAniList(candidate, 1, 5);
    if (!results.length) continue;

    const preferred = results.find((result) => {
      const haystack = normalizeAscii(
        [result.title.romaji, result.title.english, result.title.native].filter(Boolean).join(" ")
      );
      const needle = normalizeAscii(cleanSearchCandidate(candidate));
      return haystack.includes(needle);
    });

    return preferred ?? results[0];
  }

  return null;
}

async function resolveMalIdForAnime(input: {
  title: string;
  titleEnglish: string | null;
  titleRomaji?: string | null;
  seriesTitle?: string | null;
}): Promise<number | null> {
  const candidates = uniqueCandidates(
    input.titleEnglish,
    input.titleRomaji,
    input.seriesTitle,
    input.title,
  );

  for (const candidate of candidates) {
    const results = await jikanSearchAnime(candidate);
    if (!results.length) continue;

    const preferred = results.find((result) => {
      const haystack = normalizeAscii([result.title, result.titleEnglish].filter(Boolean).join(" "));
      const needle = normalizeAscii(cleanSearchCandidate(candidate));
      return haystack.includes(needle);
    });

    const match = preferred ?? results[0];
    if (match?.malId) return match.malId;
  }

  return null;
}

export const metadataRoutes = new Elysia({ prefix: "/metadata" })

  // GET /api/metadata/search?q=...&source=kitsu|anilist|all
  .get("/search", async ({ query }) => {
    const q = query.q?.trim();
    if (!q) return { error: "q é obrigatório" };
    const source = query.source ?? "anilist";
    logger.info("metadata", `search "${q}" source=${source}`);

    if (source === "kitsu") {
      const hits = await searchKitsu(q, 10);
      return {
        source: "kitsu",
        results: hits.map((a) => ({
          kitsuId: a.id,
          title: a.attributes.canonicalTitle,
          altTitle: a.attributes.titles.en ?? a.attributes.titles.en_jp ?? null,
          synopsis: a.attributes.synopsis,
          posterUrl: kitsuPoster(a),
          rating: a.attributes.averageRating ? parseFloat(a.attributes.averageRating) / 10 : null,
          status: a.attributes.status,
          episodeCount: a.attributes.episodeCount,
          year: kitsuYear(a),
          subtype: a.attributes.subtype,
        })),
      };
    }

    if (source === "all") {
      const [kitsuHits, anilistHits] = await Promise.allSettled([
        searchKitsu(q, 5),
        searchAniList(q, 1, 10),
      ]);
      return {
        source: "all",
        kitsu: kitsuHits.status === "fulfilled" ? kitsuHits.value.map((a) => ({
          kitsuId: a.id, title: a.attributes.canonicalTitle,
          posterUrl: kitsuPoster(a), rating: a.attributes.averageRating ? parseFloat(a.attributes.averageRating) / 10 : null,
        })) : [],
        anilist: anilistHits.status === "fulfilled" ? anilistHits.value.map(formatAniListAnime) : [],
      };
    }

    // Default: AniList
    const hits = await searchAniList(q, 1, 15);
    return { source: "anilist", results: hits.map(formatAniListAnime) };
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      source: t.Optional(t.String()),
    }),
  })

  // GET /api/metadata/anilist/:id
  .get("/anilist/:id", async ({ params }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) return { error: "ID inválido" };
    logger.info("metadata", `AniList fetch id=${id}`);
    const anime = await getAniListAnime(id);
    if (!anime) return { error: "Não encontrado no AniList" };
    return formatAniListAnime(anime);
  }, { params: t.Object({ id: t.String() }) })

  // GET /api/metadata/anilist/:id/airing
  .get("/anilist/:id/airing", async ({ params }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) return { error: "ID inválido" };
    const schedule = await getAiringSchedule(id);
    return { mediaId: id, schedule };
  }, { params: t.Object({ id: t.String() }) })

  // GET /api/metadata/kitsu/:id
  .get("/kitsu/:kitsuId", async ({ params }) => {
    logger.info("metadata", `Kitsu fetch id=${params.kitsuId}`);
    const anime = await getKitsuAnime(params.kitsuId);
    if (!anime) return { error: "Não encontrado no Kitsu" };
    const a = anime.attributes;
    return {
      kitsuId: anime.id,
      title: a.canonicalTitle,
      altTitle: a.titles.en ?? a.titles.en_jp ?? null,
      synopsis: a.synopsis,
      posterUrl: kitsuPoster(anime),
      coverUrl: a.coverImage?.large ?? a.coverImage?.original ?? null,
      rating: a.averageRating ? parseFloat(a.averageRating) / 10 : null,
      status: a.status,
      episodeCount: a.episodeCount,
      episodeLength: a.episodeLength,
      year: kitsuYear(anime),
      subtype: a.subtype,
      ageRating: a.ageRatingGuide,
      startDate: a.startDate,
      endDate: a.endDate,
    };
  }, { params: t.Object({ kitsuId: t.String() }) })

  // POST /api/metadata/enrich/:id — enriquece anime da biblioteca com dados AniList
  .post("/enrich/:id", async ({ params }) => {
    const anime = db.query<{
      id: string;
      title: string;
      title_english: string | null;
      title_romaji: string | null;
      series_title: string | null;
      anilist_id: number | null;
    }, [string]>(`SELECT id, title, title_english, title_romaji, series_title, anilist_id FROM animes WHERE id = ?`).get(params.id);

    if (!anime) return jsonError("Anime não encontrado na biblioteca", 404);

    let anilistData = null;
    if (anime.anilist_id) {
      anilistData = await getAniListAnime(anime.anilist_id);
    } else {
      anilistData = await resolveAniListForAnime({
        title: anime.title,
        titleEnglish: anime.title_english,
        titleRomaji: anime.title_romaji,
        seriesTitle: anime.series_title,
      });
    }

    if (!anilistData) return jsonError("Não foi possível encontrar dados AniList", 404);

    const formatted = formatAniListAnime(anilistData);
    const resolvedSeriesTitle = resolveSeriesRootTitle(anilistData, anime.title);
    db.run(`
      UPDATE animes SET
        anilist_id = ?,
        mal_id = ?,
        title_romaji = ?,
        title_english = COALESCE(title_english, ?),
        title_native = ?,
        synopsis = COALESCE(NULLIF(synopsis, ''), ?),
        poster_url = COALESCE(NULLIF(poster_url, ''), ?),
        cover_url = COALESCE(NULLIF(cover_url, ''), ?),
        genres = ?,
        tags = ?,
        rating = COALESCE(NULLIF(rating, 0), ?),
        anilist_status = ?,
        episode_count = COALESCE(NULLIF(episode_count, 0), ?),
        episode_length = COALESCE(NULLIF(episode_length, 0), ?),
        next_release = ?,
        series_title = COALESCE(NULLIF(series_title, ''), ?),
        year = COALESCE(NULLIF(year, 0), ?),
        updated_at = datetime('now')
      WHERE id = ?
    `, [
      formatted.anilistId,
      formatted.malId ?? null,
      formatted.titleRomaji,
      formatted.titleEnglish ?? null,
      formatted.titleNative ?? null,
      formatted.synopsis ?? null,
      formatted.posterUrl ?? null,
      formatted.bannerUrl ?? null,
      JSON.stringify(formatted.genres),
      JSON.stringify(formatted.tags),
      formatted.rating ?? null,
      formatted.status,
      formatted.episodeCount ?? null,
      formatted.episodeLength ?? null,
      formatted.nextAiringEpisode?.airingAt
        ? new Date(formatted.nextAiringEpisode.airingAt * 1000).toISOString()
        : null,
      resolvedSeriesTitle,
      formatted.year ?? null,
      anime.id,
    ]);

    logger.info("metadata", `enriched "${anime.title}" with AniList id=${formatted.anilistId}`);
    return { ok: true, anilistId: formatted.anilistId, title: formatted.title };
  }, { params: t.Object({ id: t.String() }) })

  // GET /api/metadata/jikan/search?q=
  .get("/jikan/search", async ({ query }) => {
    const q = (query as any).q?.trim();
    if (!q) return { error: "q é obrigatório" };
    const results = await jikanSearchAnime(q);
    return { results };
  })

  // GET /api/metadata/jikan/:malId/episodes
  .get("/jikan/:malId/episodes", async ({ params }) => {
    const malId = parseInt(params.malId);
    if (isNaN(malId)) return { error: "malId inválido" };
    const episodes = await jikanGetAllEpisodes(malId);
    return { malId, total: episodes.length, episodes };
  }, { params: t.Object({ malId: t.String() }) })

  // GET /api/metadata/jikan/:malId/episode/:ep
  .get("/jikan/:malId/episode/:ep", async ({ params }) => {
    const malId = parseInt(params.malId);
    const ep = parseInt(params.ep);
    if (isNaN(malId) || isNaN(ep)) return { error: "parâmetros inválidos" };
    const episode = await jikanGetEpisode(malId, ep);
    if (!episode) return { error: "Episódio não encontrado no Jikan" };
    return episode;
  }, { params: t.Object({ malId: t.String(), ep: t.String() }) })

  // POST /api/metadata/jikan/enrich/:id — sincroniza episódios da biblioteca com dados Jikan
  .post("/jikan/enrich/:id", async ({ params }) => {
    const anime = db.query<{
      id: string;
      title: string;
      title_english: string | null;
      title_romaji: string | null;
      series_title: string | null;
      mal_id: number | null;
    }, [string]>(
      `SELECT id, title, title_english, title_romaji, series_title, mal_id FROM animes WHERE id = ?`
    ).get(params.id);
    if (!anime) return jsonError("Anime não encontrado", 404);

    let malId = anime.mal_id;
    if (!malId) {
      malId = await resolveMalIdForAnime({
        title: anime.title,
        titleEnglish: anime.title_english,
        titleRomaji: anime.title_romaji,
        seriesTitle: anime.series_title,
      });
      if (malId) {
        db.run(`UPDATE animes SET mal_id = ?, updated_at = datetime('now') WHERE id = ?`, [malId, anime.id]);
      }
    }
    if (!malId) return jsonError("Anime não possui mal_id e não foi possível resolvê-lo automaticamente.", 422);

    const episodes = await jikanGetAllEpisodes(malId);
    if (!episodes.length) return { ok: true, enriched: 0, message: "Nenhum episódio retornado pelo Jikan" };

    const update = db.prepare(
      `UPDATE episodes
       SET title=COALESCE(NULLIF(title,''),?), synopsis=COALESCE(NULLIF(synopsis,''),?),
           aired=COALESCE(NULLIF(aired,''),?), is_filler=?, is_recap=?
       WHERE anime_id=? AND number=?`
    );

    let enriched = 0;
    for (const ep of episodes) {
      const res = update.run(
        ep.title || null, ep.synopsis || null, ep.aired || null,
        ep.isFiller ? 1 : 0, ep.isRecap ? 1 : 0,
        anime.id, ep.number
      );
      if (res.changes > 0) enriched++;
    }

    logger.info("metadata", `jikan enrich "${anime.title}": ${enriched}/${episodes.length} episódios`);
    return { ok: true, enriched, total: episodes.length };
  }, { params: t.Object({ id: t.String() }) })

  // POST /api/metadata/resolve-series-titles — re-resolve series_title para todos os animes da biblioteca
  .post("/resolve-series-titles", async () => {
    const animes = db.query<{ id: string; title: string; title_english: string | null; anilist_id: number | null }, []>(
      `SELECT id, title, title_english, anilist_id FROM animes WHERE is_tracked = 1 ORDER BY updated_at DESC`
    ).all();

    let resolved = 0;
    let failed = 0;

    for (const anime of animes) {
      try {
        let seriesTitle: string | null = null;

        if (anime.anilist_id) {
          const anilistData = await getAniListAnime(anime.anilist_id);
          if (anilistData) {
            seriesTitle = resolveSeriesRootTitle(anilistData, anime.title);
          }
        }

        if (!seriesTitle) {
          const { stripSeasonSuffix } = await import("../services/naming.ts");
          seriesTitle = stripSeasonSuffix(anime.title);
        }

        if (seriesTitle) {
          db.run(`UPDATE animes SET series_title = ? WHERE id = ?`, [seriesTitle, anime.id]);
          resolved++;
        }
      } catch {
        failed++;
      }
    }

    logger.info("metadata", `resolve-series-titles: ${resolved} resolved, ${failed} failed`);
    return { ok: true, total: animes.length, resolved, failed };
  })

  // POST /api/metadata/save — salva anime novo direto dos dados de busca
  .post("/save", ({ body }) => {
    const {
      kitsuId, anilistId, malId, title, titleEnglish, titleRomaji,
      synopsis, posterUrl, rating, status, episodeCount, year, tags, genres,
      provider, sourceUrl, subtype,
    } = body as {
      kitsuId?: unknown;
      anilistId?: unknown;
      malId?: unknown;
      title?: unknown;
      titleEnglish?: unknown;
      titleRomaji?: unknown;
      synopsis?: unknown;
      posterUrl?: unknown;
      rating?: unknown;
      status?: unknown;
      episodeCount?: unknown;
      year?: unknown;
      tags?: unknown;
      genres?: unknown;
      provider?: unknown;
      sourceUrl?: unknown;
      subtype?: unknown;
    };

    const id = randomUUID();
    const titleValue = asString(title, "").trim() || "Untitled";
    const values: SQLQueryBindings[] = [
      id,
      asNullableString(kitsuId),
      asNullableFiniteNumber(anilistId),
      asNullableFiniteNumber(malId),
      titleValue,
      asNullableString(titleEnglish),
      asNullableString(titleRomaji),
      asNullableString(synopsis),
      asNullableString(posterUrl),
      asNullableFiniteNumber(rating),
      asString(status, "unknown"),
      asString(status, "unknown"),
      asFiniteNumber(episodeCount, 0),
      asNullableFiniteNumber(year),
      Array.isArray(tags) ? JSON.stringify(tags) : "[]",
      Array.isArray(genres) ? JSON.stringify(genres) : "[]",
      asString(provider, "animefire"),
      asNullableString(sourceUrl),
      asString(subtype, "TV"),
    ];
    const result = db.run(`
      INSERT INTO animes (
        id, kitsu_id, anilist_id, mal_id, title, title_english, title_romaji,
        synopsis, poster_url, rating, kitsu_status, anilist_status,
        episode_count, year, tags, genres, provider, source_url, subtype
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `, values);

    if (result.changes === 0) {
      const existing = db.query<{ id: string }, [string]>(
        `SELECT id FROM animes WHERE title = ? ORDER BY cached_at DESC LIMIT 1`
      ).get(titleValue);
      logger.info("metadata", `duplicate save "${titleValue}" — retornando id existente`);
      return { ok: true, id: existing?.id ?? id, existed: true };
    }

    logger.info("metadata", `saved "${titleValue}"`);
    return { ok: true, id };
  });
