import Elysia, { t } from "elysia";
import { animefireSearch, goyabuSearch, animefireEpisodes, goyabuEpisodes } from "../services/scraper.ts";
import { searchAllAnime, getAllAnimeEpisodes, getAllAnimeStreamUrl } from "../services/allanime.ts";
import { searchAllProviders, getEpisodesWithFallback, getProviderInfo, type Provider } from "../services/provider-chain.ts";
import { searchKitsu } from "../services/kitsu.ts";
import { logger } from "../utils/logger.ts";

export const searchRoutes = new Elysia({ prefix: "/search" })

  // GET /api/search?q=&source=kitsu|animefire|goyabu|allanime|nineanime|animedrive|superflix|dattebayo|all
  .get("/", async ({ query }) => {
    const q = query.q?.trim();
    if (!q || q.length < 2) return { error: "Query muito curta" };

    const source = query.source ?? "all";
    logger.info("search", `q="${q}" source="${source}"`);

    if (source === "kitsu") {
      const hits = await searchKitsu(q, 20);
      return {
        source: "kitsu",
        results: hits.map((a) => ({
          id: a.id,
          title: a.attributes.canonicalTitle,
          altTitle: a.attributes.titles.en ?? a.attributes.titles.en_jp ?? null,
          synopsis: a.attributes.synopsis,
          posterUrl: a.attributes.posterImage?.large ?? a.attributes.posterImage?.medium ?? null,
          rating: a.attributes.averageRating ? parseFloat(a.attributes.averageRating) / 10 : null,
          status: a.attributes.status,
          episodeCount: a.attributes.episodeCount,
          year: a.attributes.startDate ? parseInt(a.attributes.startDate.split("-")[0]) : null,
          subtype: a.attributes.subtype,
        })),
      };
    }

    if (source === "animefire") {
      return { source: "animefire", results: await animefireSearch(q) };
    }
    if (source === "goyabu") {
      return { source: "goyabu", results: await goyabuSearch(q) };
    }
    if (source === "allanime") {
      const hits = await searchAllAnime(q);
      return {
        source: "allanime",
        results: hits.map((r) => ({
          id: r.id,
          title: r.englishName ?? r.name,
          titleOriginal: r.name,
          episodeCount: r.episodeCount,
          imageUrl: r.imageUrl ?? null,
          provider: "allanime",
        })),
      };
    }
    if (source === "dattebayo") {
      const results = await searchAllProviders(q, ["dattebayo"]);
      return { source: "dattebayo", total: results.length, results };
    }
    if (source === "nineanime") {
      const results = await searchAllProviders(q, ["nineanime"]);
      return { source: "nineanime", total: results.length, results };
    }
    if (source === "animedrive") {
      const results = await searchAllProviders(q, ["animedrive"]);
      return { source: "animedrive", total: results.length, results };
    }
    if (source === "superflix") {
      const results = await searchAllProviders(q, ["superflix"]);
      return { source: "superflix", total: results.length, results };
    }

    // "all" — todos os providers em paralelo
    const results = await searchAllProviders(q, ["animefire", "goyabu", "allanime", "nineanime", "animedrive", "superflix", "dattebayo"]);
    return { source: "all", total: results.length, results };
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      source: t.Optional(t.String()),
    }),
  })

  // GET /api/search/episodes?url=&provider=&allAnimeId=
  .get("/episodes", async ({ query }) => {
    const url = query.url?.trim();
    const provider = (query.provider?.trim() ?? "animefire") as Provider;
    const allAnimeId = query.allAnimeId?.trim();

    if (!url && !allAnimeId) return { error: "url ou allAnimeId é obrigatório" };

    logger.info("search", `episodes provider=${provider} url=${url ?? allAnimeId}`);

    if (provider === "allanime" && allAnimeId) {
      const nums = await getAllAnimeEpisodes(allAnimeId);
      return {
        provider: "allanime",
        animeId: allAnimeId,
        total: nums.length,
        episodes: nums.map((n) => ({ number: n, label: `Episódio ${n}`, url: String(n) })),
      };
    }

    const episodes = await getEpisodesWithFallback(url!, provider, allAnimeId);
    return { provider, url, total: episodes.length, episodes };
  }, {
    query: t.Object({
      url: t.Optional(t.String()),
      provider: t.Optional(t.String()),
      allAnimeId: t.Optional(t.String()),
    }),
  })

  // GET /api/search/stream?allAnimeId=&episode=&mode=sub|dub&quality=best
  .get("/stream", async ({ query }) => {
    const { allAnimeId, episode, mode, quality } = query;
    if (!allAnimeId || !episode) return { error: "allAnimeId e episode são obrigatórios" };

    logger.info("search", `stream allAnimeId=${allAnimeId} ep=${episode} mode=${mode ?? "sub"}`);
    const stream = await getAllAnimeStreamUrl(
      allAnimeId,
      episode,
      (mode as "sub" | "dub") ?? "sub",
      quality ?? "best"
    );
    if (!stream) return { error: "Stream não encontrado" };
    return { ok: true, ...stream };
  }, {
    query: t.Object({
      allAnimeId: t.Optional(t.String()),
      episode: t.Optional(t.String()),
      mode: t.Optional(t.String()),
      quality: t.Optional(t.String()),
    }),
  })

  // GET /api/search/providers — lista providers disponíveis
  .get("/providers", () => ({
    providers: getProviderInfo(),
  }));
