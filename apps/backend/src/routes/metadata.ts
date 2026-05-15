import Elysia, { t } from "elysia";
import type { SQLQueryBindings } from "bun:sqlite";
import { searchKitsu, getKitsuAnime, kitsuPoster, kitsuYear } from "../services/kitsu.ts";
import { searchAniList, getAniListAnime, formatAniListAnime, getAiringSchedule } from "../services/anilist.ts";
import { jikanSearchAnime, jikanGetEpisode, jikanGetAllEpisodes } from "../services/jikan.ts";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { randomUUID } from "crypto";

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
      id: string; title: string; title_english: string | null; anilist_id: number | null;
    }, [string]>(`SELECT id, title, title_english, anilist_id FROM animes WHERE id = ?`).get(params.id);

    if (!anime) return { error: "Anime não encontrado na biblioteca" };

    let anilistData = null;
    if (anime.anilist_id) {
      anilistData = await getAniListAnime(anime.anilist_id);
    } else {
      const searchTerm = anime.title_english ?? anime.title;
      const results = await searchAniList(searchTerm, 1, 1);
      if (results.length > 0) anilistData = results[0];
    }

    if (!anilistData) return { error: "Não foi possível encontrar dados AniList" };

    const formatted = formatAniListAnime(anilistData);
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
    const anime = db.query<{ id: string; title: string; mal_id: number | null }, [string]>(
      `SELECT id, title, mal_id FROM animes WHERE id = ?`
    ).get(params.id);
    if (!anime) return { error: "Anime não encontrado" };
    if (!anime.mal_id) return { error: "Anime não possui mal_id. Enriqueça com AniList primeiro." };

    const episodes = await jikanGetAllEpisodes(anime.mal_id);
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
