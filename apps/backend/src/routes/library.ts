import Elysia, { t } from "elysia";
import type { SQLQueryBindings } from "bun:sqlite";
import { basename, dirname, join } from "path";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { scanAnime, scanFullLibrary, renameToJellyfin, getMissingEpisodes } from "../services/scanner.ts";
import { inferSeasonInfo, isSeasonDirectoryName, sanitize, stripSeasonSuffix } from "../services/naming.ts";
import { getAniListAnime, resolveSeriesRootTitle } from "../services/anilist.ts";
import { randomUUID } from "crypto";

/** Resolve e persiste series_title para um anime via AniList (fire-and-forget). */
async function resolveAndStoreSeriesTitle(animeId: string, anilistId: number | null, fallbackTitle: string): Promise<void> {
  try {
    let seriesTitle = stripSeasonSuffix(fallbackTitle);

    if (anilistId) {
      const anilistData = await getAniListAnime(anilistId);
      if (anilistData) {
        seriesTitle = resolveSeriesRootTitle(anilistData, fallbackTitle);
      }
    }

    if (seriesTitle) {
      db.run(`UPDATE animes SET series_title = ? WHERE id = ? AND (series_title IS NULL OR series_title = '')`, [seriesTitle, animeId]);
      logger.info("library", `series_title resolved: "${seriesTitle}" for anime ${animeId}`);
    }
  } catch (err) {
    logger.warn("library", `resolveAndStoreSeriesTitle(${animeId}) failed: ${err}`);
  }
}

type AnimeRow = {
  id: string; kitsu_id: string | null; anilist_id: number | null; mal_id: number | null;
  title: string; title_romaji: string | null; title_english: string | null; title_native: string | null;
  alt_title: string | null; synopsis: string | null; poster_url: string | null; cover_url: string | null;
  genres: string; tags: string; rating: number | null; kitsu_status: string; anilist_status: string;
  subtype: string; episode_count: number; episode_length: number | null;
  downloaded_count: number; download_status: string; quality: string;
  provider: string; size_gb: number; local_path: string; year: number | null;
  season_number: number; next_release: string | null; last_download: string | null;
  ascii_art: string; source_url: string | null; watch_status: string | null; cached_at: string; updated_at: string;
};

function safeJson<T>(s: string | null, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function parseAnime(r: AnimeRow) {
  const missing = Math.max(0, r.episode_count - r.downloaded_count);
  return {
    id: r.id,
    kitsuId: r.kitsu_id,
    anilistId: r.anilist_id,
    malId: r.mal_id,
    title: r.title,
    titleRomaji: r.title_romaji,
    titleEnglish: r.title_english,
    titleNative: r.title_native,
    altTitle: r.alt_title,
    synopsis: r.synopsis,
    posterUrl: r.poster_url,
    coverUrl: r.cover_url,
    genres: safeJson<string[]>(r.genres, []),
    tags: safeJson<string[]>(r.tags, []),
    rating: r.rating,
    kitsuStatus: r.kitsu_status,
    anilistStatus: r.anilist_status,
    subtype: r.subtype,
    episodeCount: r.episode_count,
    episodeLength: r.episode_length,
    downloadedCount: r.downloaded_count,
    downloadStatus: r.download_status,
    quality: r.quality,
    provider: r.provider,
    sizeGb: r.size_gb,
    localPath: r.local_path,
    year: r.year,
    seasonNumber: r.season_number,
    nextRelease: r.next_release,
    lastDownload: r.last_download,
    asciiArt: r.ascii_art,
    sourceUrl: r.source_url,
    watchStatus: r.watch_status ?? "none",
    missingEpisodes: missing,
    progress: r.episode_count > 0 ? Math.round((r.downloaded_count / r.episode_count) * 100) : 0,
    nextEpisodeToDownload: missing > 0 ? "Episode " + (r.downloaded_count + 1) : "Complete",
    cachedAt: r.cached_at,
    updatedAt: r.updated_at,
  };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeSourceRef(value: string | null): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString();
  } catch {
    return raw.replace(/\/+$/, "");
  }
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

function normalizeAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function resolveAnimeLocalPath(baseOrAnimePath: string, preferredTitle: string, year: number | null): string {
  let trimmed = baseOrAnimePath.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";

  // Sobe níveis de "Season XX" / "Season XX Part YY" até encontrar a raiz da série.
  while (isSeasonDirectoryName(basename(trimmed))) {
    const parent = dirname(trimmed);
    if (parent === trimmed) break;
    trimmed = parent;
  }

  const expectedSeriesDir = sanitize(stripSeasonSuffix(preferredTitle));
  const baseName = basename(trimmed);
  const normalizedBase = normalizeAscii(baseName);
  const normalizedExpected = normalizeAscii(expectedSeriesDir);

  // Correspondência exata
  if (normalizedBase === normalizedExpected) {
    return trimmed;
  }

  // Pasta já existe no formato "Título (Ano)" e corresponde à série.
  if (/^.+\s*\(\d{4}\)$/.test(baseName) && normalizeAscii(sanitize(stripSeasonSuffix(baseName))) === normalizedExpected) {
    return trimmed;
  }

  // Se o caminho já aponta para uma pasta de temporada/site-específica da mesma série,
  // sobe um nível e usa a raiz canônica.
  if (normalizeAscii(sanitize(stripSeasonSuffix(baseName))) === normalizedExpected) {
    return join(dirname(trimmed), expectedSeriesDir);
  }

  // Pasta de série sem ano e o título normalizado contém o nome da pasta
  const normalizedTitle = normalizeAscii(preferredTitle);
  if (normalizedBase && normalizedTitle.startsWith(normalizedBase)) {
    return trimmed;
  }

  return join(trimmed, expectedSeriesDir);
}

function toSqlBinding(value: unknown): SQLQueryBindings {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return value as unknown as SQLQueryBindings;
  }
  return JSON.stringify(value);
}

export const libraryRoutes = new Elysia({ prefix: "/library" })

  // GET /api/library — lista animes com filtros
  .get("/", ({ query }) => {
    const { status, provider, q, sort } = query;
    let sql = `SELECT * FROM animes WHERE 1=1`;
    const params: string[] = [];
    if (status) { sql += ` AND download_status = ?`; params.push(status); }
    if (provider) { sql += ` AND provider = ?`; params.push(provider); }
    if (q) { sql += ` AND (title LIKE ? OR title_english LIKE ? OR title_romaji LIKE ?)`; const like = `%${q}%`; params.push(like, like, like); }
    const sortMap: Record<string, string> = { title: "title ASC", rating: "rating DESC", year: "year DESC", recent: "updated_at DESC", missing: "missingEpisodes DESC" };
    sql += ` ORDER BY ${sortMap[sort ?? ""] ?? "title ASC"}`;
    const rows = db.query<AnimeRow, string[]>(sql).all(...params);
    const animes = rows.map(parseAnime);
    return {
      total: animes.length,
      totalStorageGb: Math.round(animes.reduce((s, a) => s + a.sizeGb, 0) * 10) / 10,
      animes,
    };
  }, {
    query: t.Object({
      status: t.Optional(t.String()),
      provider: t.Optional(t.String()),
      q: t.Optional(t.String()),
      sort: t.Optional(t.String()),
    }),
  })

  // GET /api/library/stats/summary
  .get("/stats/summary", () => {
    const byStatus = db.query<{ download_status: string; count: number }, []>(
      `SELECT download_status, COUNT(*) as count FROM animes GROUP BY download_status`
    ).all();
    const totals = db.query<{
      total: number; total_eps: number; downloaded_eps: number; total_gb: number;
    }, []>(`
      SELECT COUNT(*) as total, SUM(episode_count) as total_eps,
             SUM(downloaded_count) as downloaded_eps, SUM(size_gb) as total_gb
      FROM animes
    `).get()!;
    const recentDl = db.query<{ title: string; last_download: string }, []>(
      `SELECT title, last_download FROM animes WHERE last_download IS NOT NULL ORDER BY updated_at DESC LIMIT 5`
    ).all();
    return {
      totalTitles: totals.total,
      totalEpisodes: totals.total_eps ?? 0,
      downloadedEpisodes: totals.downloaded_eps ?? 0,
      missingEpisodes: (totals.total_eps ?? 0) - (totals.downloaded_eps ?? 0),
      totalStorageGb: Math.round((totals.total_gb ?? 0) * 10) / 10,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.download_status, s.count])),
      recentDownloads: recentDl,
    };
  })

  // GET /api/library/:id
  .get("/:id", ({ params }) => {
    const row = db.query<AnimeRow, [string]>(`SELECT * FROM animes WHERE id = ?`).get(params.id);
    if (!row) return { error: "Anime não encontrado" };
    const anime = parseAnime(row);
    // Include episodes
    const episodes = db.query<{
      id: string; number: number; season: number; title: string | null;
      status: string; file_path: string | null; file_size_mb: number;
      watched: number; watch_progress: number;
    }, [string]>(
      `SELECT id, number, season, title, status, file_path, file_size_mb, watched, watch_progress
       FROM episodes WHERE anime_id = ? ORDER BY season, number`
    ).all(params.id);
    return { ...anime, episodes };
  }, { params: t.Object({ id: t.String() }) })

  // POST /api/library — adicionar anime
  .post("/", ({ body }) => {
    type CreateLibraryPayload = {
      kitsuId?: unknown;
      anilistId?: unknown;
      malId?: unknown;
      title?: unknown;
      titleEnglish?: unknown;
      titleRomaji?: unknown;
      titleNative?: unknown;
      altTitle?: unknown;
      synopsis?: unknown;
      posterUrl?: unknown;
      coverUrl?: unknown;
      rating?: unknown;
      kitsuStatus?: unknown;
      anilistStatus?: unknown;
      subtype?: unknown;
      episodeCount?: unknown;
      episodeLength?: unknown;
      quality?: unknown;
      provider?: unknown;
      localPath?: unknown;
      year?: unknown;
      seasonNumber?: unknown;
      tags?: unknown;
      genres?: unknown;
      sourceUrl?: unknown;
      asciiArt?: unknown;
    };
    const {
      kitsuId, anilistId, malId, title, titleEnglish, titleRomaji, titleNative,
      altTitle, synopsis, posterUrl, coverUrl, rating, kitsuStatus, anilistStatus,
      subtype, episodeCount, episodeLength, quality, provider, localPath, year,
      seasonNumber, tags, genres, sourceUrl, asciiArt,
    } = body as CreateLibraryPayload;

    const titleValue = asString(title, "").trim() || "Untitled";
    const titleEnglishValue = asNullableString(titleEnglish);
    const titleRomajiValue = asNullableString(titleRomaji);
    const titleNativeValue = asNullableString(titleNative);
    const altTitleValue = asNullableString(altTitle);
    const synopsisValue = asNullableString(synopsis);
    const posterUrlValue = asNullableString(posterUrl);
    const coverUrlValue = asNullableString(coverUrl);
    const providerValue = asString(provider, "animefire");
    const sourceUrlValue = normalizeSourceRef(asNullableString(sourceUrl));
    const kitsuIdValue = asNullableString(kitsuId);
    const anilistIdValue = asNullableFiniteNumber(anilistId);
    const malIdValue = asNullableFiniteNumber(malId);
    const episodeCountValue = asFiniteNumber(episodeCount, 0);
    const ratingValue = asNullableFiniteNumber(rating);
    const yearValue = asNullableFiniteNumber(year);
    const preferredTitleForPath = titleEnglishValue ?? titleRomajiValue ?? titleValue;
    const localPathValue = resolveAnimeLocalPath(asString(localPath, ""), preferredTitleForPath, yearValue);
    const providedSeasonNumber = asFiniteNumber(seasonNumber, 0);
    const seasonNumberValue = providedSeasonNumber > 0
      ? providedSeasonNumber
      : inferSeasonInfo(
          titleValue,
          titleEnglishValue,
          titleRomajiValue,
          altTitleValue,
        ).seasonNumber;

    let existing = null as { id: string } | null;
    if (sourceUrlValue) {
      existing = db.query<{ id: string }, [string, string]>(
        `SELECT id
         FROM animes
         WHERE provider = ? AND source_url = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      ).get(providerValue, sourceUrlValue) ?? null;
    }

    if (!existing && kitsuIdValue) {
      existing = db.query<{ id: string }, [string]>(
        `SELECT id FROM animes WHERE kitsu_id = ? ORDER BY updated_at DESC LIMIT 1`
      ).get(kitsuIdValue) ?? null;
    }

    if (!existing && anilistIdValue != null) {
      existing = db.query<{ id: string }, [number]>(
        `SELECT id FROM animes WHERE anilist_id = ? ORDER BY updated_at DESC LIMIT 1`
      ).get(anilistIdValue) ?? null;
    }

    if (!existing && malIdValue != null) {
      existing = db.query<{ id: string }, [number]>(
        `SELECT id FROM animes WHERE mal_id = ? ORDER BY updated_at DESC LIMIT 1`
      ).get(malIdValue) ?? null;
    }

    if (!existing) {
      existing = db.query<{ id: string }, [string, string, string, string]>(
        `SELECT id
         FROM animes
         WHERE (
           lower(trim(title)) = lower(trim(?))
           OR lower(trim(COALESCE(title_english, ''))) = lower(trim(?))
           OR lower(trim(COALESCE(title_romaji, ''))) = lower(trim(?))
         )
         ORDER BY CASE WHEN provider = ? THEN 1 ELSE 0 END DESC, updated_at DESC
         LIMIT 1`
      ).get(titleValue, titleValue, titleValue, providerValue) ?? null;
    }

    if (existing) {
      db.run(
        `UPDATE animes
         SET
           title = COALESCE(NULLIF(title, ''), ?),
           title_english = COALESCE(NULLIF(title_english, ''), ?),
           title_romaji = COALESCE(NULLIF(title_romaji, ''), ?),
           title_native = COALESCE(NULLIF(title_native, ''), ?),
           alt_title = COALESCE(NULLIF(alt_title, ''), ?),
           synopsis = COALESCE(NULLIF(synopsis, ''), ?),
           poster_url = COALESCE(NULLIF(poster_url, ''), ?),
           cover_url = COALESCE(NULLIF(cover_url, ''), ?),
           kitsu_id = COALESCE(kitsu_id, ?),
           anilist_id = COALESCE(anilist_id, ?),
           mal_id = COALESCE(mal_id, ?),
           rating = CASE
             WHEN (rating IS NULL OR rating = 0) AND ? IS NOT NULL THEN ?
             ELSE rating
           END,
           episode_count = CASE
             WHEN ? > episode_count THEN ?
             ELSE episode_count
           END,
            episode_length = COALESCE(episode_length, ?),
            quality = COALESCE(NULLIF(quality, ''), ?),
            local_path = CASE
              WHEN ? <> '' THEN ?
              ELSE local_path
            END,
           year = COALESCE(year, ?),
           season_number = CASE
             WHEN season_number IS NULL OR season_number <= 0 THEN ?
             WHEN ? > season_number THEN ?
             ELSE season_number
           END,
           source_url = COALESCE(NULLIF(source_url, ''), ?),
           ascii_art = COALESCE(NULLIF(ascii_art, ''), ?),
           updated_at = datetime('now')
         WHERE id = ?`,
        [
          titleValue,
          titleEnglishValue,
          titleRomajiValue,
          titleNativeValue,
          altTitleValue,
          synopsisValue,
          posterUrlValue,
          coverUrlValue,
          kitsuIdValue,
          anilistIdValue,
          malIdValue,
          ratingValue,
          ratingValue,
          episodeCountValue,
          episodeCountValue,
          asNullableFiniteNumber(episodeLength),
          asString(quality, "1080p"),
          localPathValue,
          localPathValue,
          yearValue,
          seasonNumberValue,
          seasonNumberValue,
          seasonNumberValue,
          sourceUrlValue,
          asString(asciiArt, ""),
          existing.id,
        ]
      );

      logger.info("library", `reused existing "${titleValue}" (id=${existing.id})`);
      // Resolve series_title via AniList em background (não bloqueia resposta)
      void resolveAndStoreSeriesTitle(existing.id, anilistIdValue, titleRomajiValue ?? titleValue);
      return { ok: true, id: existing.id, reused: true };
    }

    const id = randomUUID();
    const values: SQLQueryBindings[] = [
      id,
      kitsuIdValue,
      anilistIdValue,
      malIdValue,
      titleValue,
      titleEnglishValue,
      titleRomajiValue,
      titleNativeValue,
      altTitleValue,
      synopsisValue,
      posterUrlValue,
      coverUrlValue,
      ratingValue,
      asString(kitsuStatus, "unknown"),
      asString(anilistStatus, "unknown"),
      asString(subtype, "TV"),
      episodeCountValue,
      asNullableFiniteNumber(episodeLength),
      asString(quality, "1080p"),
      providerValue,
      localPathValue,
      yearValue,
      seasonNumberValue,
      Array.isArray(tags) ? JSON.stringify(tags) : "[]",
      Array.isArray(genres) ? JSON.stringify(genres) : "[]",
      sourceUrlValue,
      asString(asciiArt, ""),
    ];
    db.run(`
      INSERT INTO animes (
        id, kitsu_id, anilist_id, mal_id, title, title_english, title_romaji, title_native,
        alt_title, synopsis, poster_url, cover_url, rating, kitsu_status, anilist_status,
        subtype, episode_count, episode_length, quality, provider, local_path, year,
        season_number, tags, genres, source_url, ascii_art
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, values);
    logger.info("library", `added "${titleValue}" (id=${id})`);
    // Resolve series_title via AniList em background (não bloqueia resposta)
    void resolveAndStoreSeriesTitle(id, anilistIdValue, titleRomajiValue ?? titleValue);
    return { ok: true, id };
  })

  // PATCH /api/library/:id
  .patch("/:id", ({ params, body }) => {
    const allowed = [
      "download_status","downloaded_count","quality","provider","local_path",
      "size_gb","next_release","last_download","ascii_art","poster_url","synopsis",
      "episode_count","source_url","season_number","watch_status",
    ];
    const fields = Object.entries(body as Record<string, unknown>)
      .filter(([k]) => allowed.includes(k));
    if (!fields.length) return { error: "Nenhum campo válido" };
    const sets = fields.map(([k]) => `${k} = ?`).join(", ");
    const values: SQLQueryBindings[] = fields.map(([, v]) => toSqlBinding(v));
    values.push(params.id);
    db.run(`UPDATE animes SET ${sets}, updated_at = datetime('now') WHERE id = ?`, values);
    return { ok: true };
  }, { params: t.Object({ id: t.String() }) })

  // DELETE /api/library/:id
  .delete("/:id", ({ params }) => {
    const r = db.run(`DELETE FROM animes WHERE id = ?`, [params.id]);
    if (r.changes === 0) return { error: "Anime não encontrado" };
    logger.info("library", `deleted ${params.id}`);
    return { ok: true };
  }, { params: t.Object({ id: t.String() }) })

  // ── Episodes ──────────────────────────────────────────────────────────────

  // GET /api/library/:id/episodes
  .get("/:id/episodes", ({ params, query }) => {
    type EpisodeRow = {
      id: string; number: number; season: number; title: string | null;
      synopsis: string | null; aired: string | null; duration_min: number | null;
      is_filler: number; is_recap: number; status: string;
      file_path: string | null; file_size_mb: number; watched: number; watch_progress: number;
    };

    const seasonFilter = query.season ? parseInt(query.season, 10) : null;
    const episodes = Number.isFinite(seasonFilter)
      ? db.query<EpisodeRow, [string, number]>(
          `SELECT * FROM episodes WHERE anime_id = ? AND season = ? ORDER BY season, number`
        ).all(params.id, seasonFilter as number)
      : db.query<EpisodeRow, [string]>(
          `SELECT * FROM episodes WHERE anime_id = ? ORDER BY season, number`
        ).all(params.id);

    const missing = getMissingEpisodes(params.id);
    return { animeId: params.id, total: episodes.length, missingCount: missing.length, missing, episodes };
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ season: t.Optional(t.String()) }),
  })

  // PATCH /api/library/:id/episodes/:ep — marcar como assistido/baixado
  .patch("/:id/episodes/:ep", ({ params, body }) => {
    const { watched, watchProgress, status } = body as { watched?: number; watchProgress?: number; status?: string };
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (watched !== undefined) { sets.push("watched = ?"); vals.push(watched); }
    if (watchProgress !== undefined) { sets.push("watch_progress = ?"); vals.push(watchProgress); }
    if (status) { sets.push("status = ?"); vals.push(status); }
    if (!sets.length) return { error: "Nenhum campo para atualizar" };
    db.run(`UPDATE episodes SET ${sets.join(", ")} WHERE anime_id = ? AND number = ?`,
      [...vals, params.id, parseInt(params.ep)]);
    return { ok: true };
  }, { params: t.Object({ id: t.String(), ep: t.String() }) })

  // ── Scanner ───────────────────────────────────────────────────────────────

  // POST /api/library/:id/scan
  .post("/:id/scan", async ({ params }) => {
    try {
      const result = await scanAnime(params.id);
      return { ok: true, ...result };
    } catch (err) {
      return { error: String(err) };
    }
  }, { params: t.Object({ id: t.String() }) })

  // POST /api/library/scan/all
  .post("/scan/all", async () => {
    const result = await scanFullLibrary();
    return { ok: true, ...result };
  })

  // POST /api/library/:id/rename
  .post("/:id/rename", async ({ params, query }) => {
    const dryRun = query.dry === "true";
    try {
      const result = await renameToJellyfin(params.id, dryRun);
      return { ok: true, dryRun, ...result };
    } catch (err) {
      return { error: String(err) };
    }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ dry: t.Optional(t.String()) }),
  })

  // ── Anime Rules ───────────────────────────────────────────────────────────

  // GET /api/library/:id/rules
  .get("/:id/rules", ({ params }) => {
    const rule = db.query<{
      anime_id: string;
      preferred_provider: string | null; preferred_quality: string | null;
      preferred_download_type: string | null; preferred_language: string | null;
      auto_download: number; queue_priority: number;
      min_quality: string | null; preferred_fansub: string | null;
      download_window_start: string | null; download_window_end: string | null;
      daily_limit: number; skip_fillers: number; skip_recaps: number; notes: string | null;
    }, [string]>(`SELECT * FROM anime_rules WHERE anime_id = ?`).get(params.id);
    return rule ?? {
      anime_id: params.id, preferred_provider: null, preferred_quality: null,
      preferred_download_type: null, preferred_language: null,
      auto_download: 1, queue_priority: 0, min_quality: null, preferred_fansub: null,
      download_window_start: null, download_window_end: null,
      daily_limit: 0, skip_fillers: 0, skip_recaps: 0, notes: null,
    };
  }, { params: t.Object({ id: t.String() }) })

  // PUT /api/library/:id/rules
  .put("/:id/rules", ({ params, body }) => {
    const b = body as {
      preferredProvider?: string | null; preferredQuality?: string | null;
      preferredDownloadType?: string | null; preferredLanguage?: string | null;
      autoDownload?: number; queuePriority?: number;
      minQuality?: string | null; preferredFansub?: string | null;
      downloadWindowStart?: string | null; downloadWindowEnd?: string | null;
      dailyLimit?: number; skipFillers?: number; skipRecaps?: number; notes?: string | null;
    };
    db.run(`
      INSERT INTO anime_rules (
        anime_id, preferred_provider, preferred_quality, preferred_download_type,
        preferred_language, auto_download, queue_priority,
        min_quality, preferred_fansub, download_window_start, download_window_end,
        daily_limit, skip_fillers, skip_recaps, notes
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(anime_id) DO UPDATE SET
        preferred_provider      = excluded.preferred_provider,
        preferred_quality       = excluded.preferred_quality,
        preferred_download_type = excluded.preferred_download_type,
        preferred_language      = excluded.preferred_language,
        auto_download           = excluded.auto_download,
        queue_priority          = excluded.queue_priority,
        min_quality             = excluded.min_quality,
        preferred_fansub        = excluded.preferred_fansub,
        download_window_start   = excluded.download_window_start,
        download_window_end     = excluded.download_window_end,
        daily_limit             = excluded.daily_limit,
        skip_fillers            = excluded.skip_fillers,
        skip_recaps             = excluded.skip_recaps,
        notes                   = excluded.notes
    `, [
      params.id,
      b.preferredProvider      ?? null,
      b.preferredQuality       ?? null,
      b.preferredDownloadType  ?? null,
      b.preferredLanguage      ?? null,
      b.autoDownload           ?? 1,
      b.queuePriority          ?? 0,
      b.minQuality             ?? null,
      b.preferredFansub        ?? null,
      b.downloadWindowStart    ?? null,
      b.downloadWindowEnd      ?? null,
      b.dailyLimit             ?? 0,
      b.skipFillers            ?? 0,
      b.skipRecaps             ?? 0,
      b.notes                  ?? null,
    ]);
    return { ok: true };
  }, { params: t.Object({ id: t.String() }) })

  // DELETE /api/library/:id/rules
  .delete("/:id/rules", ({ params }) => {
    db.run(`DELETE FROM anime_rules WHERE anime_id = ?`, [params.id]);
    return { ok: true };
  }, { params: t.Object({ id: t.String() }) })

  // ── Batch Operations ──────────────────────────────────────────────────────
  // POST /api/library/batch — operações em massa
  .post("/batch", async ({ body }) => {
    const { action, animeIds } = body as { action: string; animeIds: string[]; payload?: Record<string, unknown> };
    const payload = (body as { payload?: Record<string, unknown> }).payload ?? {};
    if (!animeIds?.length) return { error: "animeIds[] obrigatório" };

    const results: { animeId: string; ok: boolean; detail?: string }[] = [];

    if (action === "queue-missing") {
      const { enqueueDownloads } = await import("../services/downloader.ts");
      const { getMissingEpisodes } = await import("../services/scanner.ts");
      for (const animeId of animeIds) {
        try {
          const anime = db.query<{ source_url: string | null; season_number: number }, [string]>(
            `SELECT source_url, season_number FROM animes WHERE id = ?`
          ).get(animeId);
          if (!anime?.source_url) { results.push({ animeId, ok: false, detail: "sem source_url" }); continue; }
          const existing = new Set(
            db.query<{ episode_number: number }, [string]>(
              `SELECT DISTINCT episode_number FROM downloads WHERE anime_id = ? AND status IN ('queued','downloading','completed')`
            ).all(animeId).map((r) => r.episode_number)
          );
          const missingEps = getMissingEpisodes(animeId).filter((ep) => !existing.has(ep));
          if (!missingEps.length) { results.push({ animeId, ok: true, detail: "nenhum faltando" }); continue; }
          const jobs = enqueueDownloads(animeId, missingEps, anime.season_number, anime.source_url ?? undefined);
          results.push({ animeId, ok: true, detail: `${jobs.length} enfileirado(s)` });
        } catch (e) { results.push({ animeId, ok: false, detail: String(e) }); }
      }
    } else if (action === "set-provider") {
      const provider = payload.provider as string | undefined;
      if (!provider) return { error: "payload.provider obrigatório" };
      for (const animeId of animeIds) {
        db.run(`UPDATE animes SET provider = ? WHERE id = ?`, [provider, animeId]);
        // Upsert rule
        db.run(`INSERT INTO anime_rules (anime_id, preferred_provider) VALUES (?,?) ON CONFLICT(anime_id) DO UPDATE SET preferred_provider = excluded.preferred_provider`, [animeId, provider]);
        results.push({ animeId, ok: true });
      }
    } else if (action === "set-monitoring") {
      const enabled = payload.enabled !== false;
      for (const animeId of animeIds) {
        db.run(`UPDATE animes SET is_tracked = ? WHERE id = ?`, [enabled ? 1 : 0, animeId]);
        results.push({ animeId, ok: true });
      }
    } else if (action === "scan") {
      const { scanAnime } = await import("../services/scanner.ts");
      for (const animeId of animeIds) {
        try {
          const res = await scanAnime(animeId);
          results.push({ animeId, ok: true, detail: `${res.foundFiles} arquivo(s)` });
        } catch (e) { results.push({ animeId, ok: false, detail: String(e) }); }
      }
    } else {
      return { error: `Ação desconhecida: ${action}` };
    }

    const succeeded = results.filter((r) => r.ok).length;
    return { ok: true, action, total: animeIds.length, succeeded, failed: animeIds.length - succeeded, results };
  }, {
    body: t.Object({
      action: t.String(),
      animeIds: t.Array(t.String()),
      payload: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  });
