import Elysia, { t } from "elysia";
import db from "../db/index.ts";
import { getUpcomingAiringSchedule } from "../services/anilist.ts";
import { enqueueDownloads } from "../services/downloader.ts";
import { logger } from "../utils/logger.ts";

type CalendarEntry = {
  id: string;
  anilist_id: number | null;
  title: string;
  poster_url: string | null;
  next_release: string;
  season_number: number;
  downloaded_count: number;
  episode_count: number;
  anilist_status: string;
  watch_status: string;
  auto_download: number;
  queue_priority: number;
  is_library: boolean;
  is_tracked: boolean;
  episode_number: number | null;
  source: "library" | "discover";
  provider: string | null;
  source_url: string | null;
};

export const calendarRoutes = new Elysia({ prefix: "/calendar" })
  .get("/", async ({ query }) => {
    const range = query.range === "month" ? "month" : "week";
    const days = range === "month" ? 30 : 7;
    const nowUnix = Math.floor(Date.now() / 1000);
    const endUnix = nowUnix + days * 24 * 60 * 60;

    const libraryRows = db.query<{
      id: string;
      anilist_id: number | null;
      title: string;
      poster_url: string | null;
      season_number: number;
      downloaded_count: number;
      episode_count: number;
      anilist_status: string;
      watch_status: string | null;
      provider: string | null;
      source_url: string | null;
      auto_download: number | null;
      queue_priority: number | null;
      is_tracked: number;
    }, []>(`
      SELECT a.id, a.anilist_id, a.title, a.poster_url, a.season_number,
             a.downloaded_count, a.episode_count, a.anilist_status, a.watch_status,
             a.provider, a.source_url, COALESCE(r.auto_download, 1) AS auto_download,
             COALESCE(r.queue_priority, 0) AS queue_priority, a.is_tracked
      FROM animes a
      LEFT JOIN anime_rules r ON r.anime_id = a.id
      WHERE a.anilist_id IS NOT NULL
    `).all();

    const libraryByAniList = new Map(
      libraryRows
        .filter((row) => typeof row.anilist_id === "number")
        .map((row) => [row.anilist_id as number, row])
    );

    const rawAiring = await getUpcomingAiringSchedule(nowUnix, endUnix, 1, range === "month" ? 90 : 50);
    const seenMedia = new Set<number>();
    const airing = rawAiring.filter((entry) => {
      const media = entry.media;
      if (!media || seenMedia.has(media.id) || media.isAdult) return false;
      if (media.countryOfOrigin && media.countryOfOrigin !== "JP") return false;
      seenMedia.add(media.id);
      return true;
    });

    const priority: CalendarEntry[] = [];
    const discover: CalendarEntry[] = [];

    for (const entry of airing) {
      const library = libraryByAniList.get(entry.media.id);
      const base: CalendarEntry = {
        id: library?.id ?? `anilist:${entry.media.id}`,
        anilist_id: entry.media.id,
        title: library?.title ?? entry.media.title.english ?? entry.media.title.romaji,
        poster_url: library?.poster_url ?? entry.media.coverImage.extraLarge ?? entry.media.coverImage.large ?? entry.media.coverImage.medium,
        next_release: new Date(entry.airingAt * 1000).toISOString(),
        season_number: library?.season_number ?? 1,
        downloaded_count: library?.downloaded_count ?? 0,
        episode_count: library?.episode_count ?? entry.media.episodes ?? 0,
        anilist_status: library?.anilist_status ?? entry.media.status,
        watch_status: library?.watch_status ?? "none",
        auto_download: library?.auto_download ?? 0,
        queue_priority: library?.queue_priority ?? 0,
        is_library: Boolean(library),
        is_tracked: Boolean(library?.is_tracked),
        episode_number: entry.episode,
        source: library ? "library" : "discover",
        provider: library?.provider ?? null,
        source_url: library?.source_url ?? null,
      };

      if (library) priority.push(base);
      else discover.push(base);
    }

    priority.sort((a, b) => {
      const watchRankA = a.watch_status === "watching" ? 2 : a.downloaded_count > 0 ? 1 : 0;
      const watchRankB = b.watch_status === "watching" ? 2 : b.downloaded_count > 0 ? 1 : 0;
      if (watchRankA !== watchRankB) return watchRankB - watchRankA;
      if (a.queue_priority !== b.queue_priority) return b.queue_priority - a.queue_priority;
      return a.next_release.localeCompare(b.next_release);
    });

    discover.sort((a, b) => {
      if (a.next_release !== b.next_release) return a.next_release.localeCompare(b.next_release);
      return a.title.localeCompare(b.title);
    });

    const recentlyDetected = db.query<{
      anime_id: string; episode_number: number; season: number;
      status: string; started_at: string | null;
    }, []>(`
      SELECT anime_id, episode_number, season, status, started_at
      FROM downloads
      WHERE source = 'auto-schedule'
        AND started_at > datetime('now', '-7 days')
      ORDER BY started_at DESC
      LIMIT 50
    `).all();

    return { range, priority, discover, recentlyDetected };
  }, {
    query: t.Object({ range: t.Optional(t.String()) }),
  })

  // POST /api/calendar/silence/:animeId — silencia do radar por N dias
  .post("/silence/:animeId", ({ params, body }) => {
    const days = Math.min(30, Math.max(1, (body as { days?: number }).days ?? 7));
    const until = new Date(Date.now() + days * 86400_000).toISOString();
    const updated = db.run(`UPDATE animes SET radar_silenced_until = ? WHERE id = ?`, [until, params.animeId]);
    if (!updated.changes) return new Response(JSON.stringify({ error: "Anime não encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
    logger.info("radar", `silenciado: ${params.animeId} até ${until.slice(0, 10)}`);
    return { ok: true, silencedUntil: until };
  }, {
    params: t.Object({ animeId: t.String() }),
    body: t.Optional(t.Object({ days: t.Optional(t.Number()) })),
  })

  // POST /api/calendar/unsilence/:animeId
  .post("/unsilence/:animeId", ({ params }) => {
    db.run(`UPDATE animes SET radar_silenced_until = NULL WHERE id = ?`, [params.animeId]);
    return { ok: true };
  }, { params: t.Object({ animeId: t.String() }) })

  // POST /api/calendar/enqueue-next/:animeId — enfileira o próximo episódio pendente
  .post("/enqueue-next/:animeId", ({ params }) => {
    const anime = db.query<{
      id: string; title: string; provider: string;
      source_url: string | null; downloaded_count: number; season_number: number;
    }, [string]>(
      `SELECT id, title, provider, source_url, downloaded_count, season_number FROM animes WHERE id = ?`
    ).get(params.animeId);
    if (!anime) return new Response(JSON.stringify({ error: "Anime não encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
    if (!anime.source_url) return { error: "Anime sem source_url configurado", queued: 0 };

    // Próximo episódio = primeiro não baixado e não em fila
    const existing = new Set(
      db.query<{ episode_number: number }, [string]>(
        `SELECT DISTINCT episode_number FROM downloads WHERE anime_id = ? AND status IN ('queued','downloading','completed')`
      ).all(anime.id).map((r) => r.episode_number)
    );
    const nextEp = (anime.downloaded_count ?? 0) + 1;
    const targetEp = existing.has(nextEp) ? nextEp + 1 : nextEp;

    const jobs = enqueueDownloads(anime.id, [targetEp], anime.season_number, anime.source_url);
    logger.info("radar", `enfileirado via radar: "${anime.title}" ep ${targetEp}`);
    return { ok: true, queued: jobs.length, episode: targetEp };
  }, { params: t.Object({ animeId: t.String() }) });
