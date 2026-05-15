import Elysia, { t } from "elysia";
import type { SQLQueryBindings } from "bun:sqlite";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { scanAnime, scanFullLibrary, renameToJellyfin, getMissingEpisodes } from "../services/scanner.ts";
import { randomUUID } from "crypto";

type AnimeRow = {
  id: string; kitsu_id: string | null; anilist_id: number | null; mal_id: number | null;
  title: string; title_romaji: string | null; title_english: string | null; title_native: string | null;
  alt_title: string | null; synopsis: string | null; poster_url: string | null; cover_url: string | null;
  genres: string; tags: string; rating: number | null; kitsu_status: string; anilist_status: string;
  subtype: string; episode_count: number; episode_length: number | null;
  downloaded_count: number; download_status: string; quality: string;
  provider: string; size_gb: number; local_path: string; year: number | null;
  season_number: number; next_release: string | null; last_download: string | null;
  ascii_art: string; source_url: string | null; cached_at: string; updated_at: string;
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
      asNullableString(titleNative),
      asNullableString(altTitle),
      asNullableString(synopsis),
      asNullableString(posterUrl),
      asNullableString(coverUrl),
      asNullableFiniteNumber(rating),
      asString(kitsuStatus, "unknown"),
      asString(anilistStatus, "unknown"),
      asString(subtype, "TV"),
      asFiniteNumber(episodeCount, 0),
      asNullableFiniteNumber(episodeLength),
      asString(quality, "1080p"),
      asString(provider, "animefire"),
      asString(localPath, ""),
      asNullableFiniteNumber(year),
      asFiniteNumber(seasonNumber, 1),
      Array.isArray(tags) ? JSON.stringify(tags) : "[]",
      Array.isArray(genres) ? JSON.stringify(genres) : "[]",
      asNullableString(sourceUrl),
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
    return { ok: true, id };
  })

  // PATCH /api/library/:id
  .patch("/:id", ({ params, body }) => {
    const allowed = [
      "download_status","downloaded_count","quality","provider","local_path",
      "size_gb","next_release","last_download","ascii_art","poster_url","synopsis",
      "episode_count","source_url","season_number",
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
  });
