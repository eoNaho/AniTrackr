/**
 * Provider fallback chain: AnimeFire → Goyabu → AllAnime → 9Anime
 * Integra circuit breaker para saúde de providers.
 */

import { animefireSearch, goyabuSearch, animefireEpisodes, goyabuEpisodes, type ScrapeResult, type Episode } from "./scraper.ts";
import { searchAllAnime, getAllAnimeEpisodes, getAllAnimeStreamUrl } from "./allanime.ts";
import { nineAnimeSearch, nineAnimeEpisodes, nineAnimeStreamUrl } from "./nineanime.ts";
import { animeDriveSearch, animeDriveEpisodes, animeDriveStreamUrl } from "./animedrive.ts";
import { superFlixSearch } from "./superflix.ts";
import { dattebayoSearch, dattebayoEpisodes, dattebayoStreamUrl } from "./dattebayo.ts";
import { recordSuccess, recordFailure, isAvailable } from "./circuit-breaker.ts";
import { logger } from "../utils/logger.ts";

export type Provider = "animefire" | "goyabu" | "allanime" | "nineanime" | "animedrive" | "superflix" | "dattebayo" | "all";

export interface UnifiedSearchResult extends ScrapeResult {
  provider: Provider;
  allAnimeId?: string;
  nineAnimeId?: string;
}

function mapAnimeDriveEpisodeToEpisode(ep: {
  number: number;
  title: string;
  url: string;
}): Episode {
  return {
    number: ep.number,
    label: ep.title?.trim() || `Episódio ${ep.number}`,
    url: ep.url,
  };
}

async function withCircuitBreaker<T>(
  provider: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  if (!isAvailable(provider)) {
    logger.warn("circuit-breaker", `Provider '${provider}' está OPEN — pulando`);
    return fallback;
  }
  try {
    const result = await fn();
    recordSuccess(provider);
    return result;
  } catch (err) {
    recordFailure(provider);
    logger.warn("provider-chain", `${provider} falhou: ${err}`);
    return fallback;
  }
}

export async function searchAllProviders(
  query: string,
  providers: Provider[] = ["animefire", "goyabu", "allanime"]
): Promise<UnifiedSearchResult[]> {
  const tasks: Promise<UnifiedSearchResult[]>[] = [];

  if (providers.includes("animefire") || providers.includes("all")) {
    tasks.push(
      withCircuitBreaker("animefire",
        () => animefireSearch(query).then((rs) => rs.map((r) => ({ ...r, provider: "animefire" as Provider }))),
        []
      )
    );
  }
  if (providers.includes("goyabu") || providers.includes("all")) {
    tasks.push(
      withCircuitBreaker("goyabu",
        () => goyabuSearch(query).then((rs) => rs.map((r) => ({ ...r, provider: "goyabu" as Provider }))),
        []
      )
    );
  }
  if (providers.includes("allanime") || providers.includes("all")) {
    tasks.push(
      withCircuitBreaker("allanime",
        () => searchAllAnime(query).then((rs) =>
          rs.map((r) => ({
            title: r.englishName ?? r.name,
            url: r.id,
            imageUrl: r.imageUrl,
            provider: "allanime" as Provider,
            allAnimeId: r.id,
          }))
        ),
        []
      )
    );
  }
  if (providers.includes("nineanime") || providers.includes("all")) {
    tasks.push(
      withCircuitBreaker("nineanime",
        () => nineAnimeSearch(query).then((rs) =>
          rs.map((r) => ({
            title: r.title,
            url: r.animeId,
            imageUrl: r.imageUrl,
            provider: "nineanime" as Provider,
            nineAnimeId: r.animeId,
          }))
        ),
        []
      )
    );
  }
  if (providers.includes("animedrive") || providers.includes("all")) {
    tasks.push(
      withCircuitBreaker("animedrive",
        () => animeDriveSearch(query).then((rs) =>
          rs.map((r) => ({
            title: r.title,
            url: r.url,
            imageUrl: r.imageUrl,
            provider: "animedrive" as Provider,
          }))
        ),
        []
      )
    );
  }
  if (providers.includes("superflix") || providers.includes("all")) {
    tasks.push(
      withCircuitBreaker("superflix",
        () => superFlixSearch(query).then((rs) =>
          rs.map((r) => ({
            title: r.title,
            url: r.linkUrl || "",
            imageUrl: r.imageUrl,
            provider: "superflix" as Provider,
          }))
        ),
        []
      )
    );
  }
  if (providers.includes("dattebayo") || providers.includes("all")) {
    tasks.push(
      withCircuitBreaker("dattebayo",
        () => dattebayoSearch(query).then((rs) =>
          rs.map((r) => ({
            title: r.title,
            url: r.url,
            imageUrl: r.imageUrl,
            provider: "dattebayo" as Provider,
          }))
        ),
        []
      )
    );
  }

  const settled = await Promise.allSettled(tasks);
  const results: UnifiedSearchResult[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") results.push(...r.value);
  }
  return results;
}

export async function getEpisodesWithFallback(
  animeUrl: string,
  provider: Provider,
  allAnimeId?: string,
  nineAnimeId?: string
): Promise<Episode[]> {
  const primary = async (): Promise<Episode[]> => {
    if (provider === "animefire") return animefireEpisodes(animeUrl);
    if (provider === "goyabu") return goyabuEpisodes(animeUrl);
    if (provider === "allanime" && allAnimeId) {
      const nums = await getAllAnimeEpisodes(allAnimeId);
      return nums.map((n) => ({ number: n, label: `Episódio ${n}`, url: String(n) }));
    }
    if (provider === "nineanime" && nineAnimeId) {
      const eps = await nineAnimeEpisodes(nineAnimeId);
      return eps.map((e) => ({ number: e.number, label: e.title, url: e.episodeId }));
    }
    if (provider === "animedrive") {
      const eps = await animeDriveEpisodes(animeUrl);
      return eps.map(mapAnimeDriveEpisodeToEpisode);
    }
    if (provider === "dattebayo") {
      const eps = await dattebayoEpisodes(animeUrl);
      return eps.map((e) => ({ number: e.number, label: e.label, url: e.url }));
    }
    return [];
  };

  try {
    const eps = await primary();
    if (eps.length > 0) {
      recordSuccess(provider);
      return eps;
    }
    logger.warn("provider-chain", `primary (${provider}) retornou 0 episódios, tentando fallbacks`);
  } catch (err) {
    recordFailure(provider);
    logger.warn("provider-chain", `primary (${provider}) falhou: ${err}`);
  }

  const fallbackOrder: Provider[] = ["animefire", "goyabu", "allanime", "nineanime", "animedrive", "dattebayo"].filter(
    (p) => p !== provider
  ) as Provider[];

  for (const fallback of fallbackOrder) {
    if (!isAvailable(fallback)) continue;
    logger.info("provider-chain", `tentando fallback: ${fallback}`);
    try {
      let eps: Episode[] = [];
      if (fallback === "animefire") eps = await animefireEpisodes(animeUrl);
      else if (fallback === "goyabu") eps = await goyabuEpisodes(animeUrl);
      else if (fallback === "nineanime" && nineAnimeId) {
        const rawEps = await nineAnimeEpisodes(nineAnimeId);
        eps = rawEps.map((e) => ({ number: e.number, label: e.title, url: e.episodeId }));
      } else if (fallback === "allanime") {
        // allanime requer allAnimeId — sem ele não há como buscar por URL genérica
        logger.info("provider-chain", `fallback allanime ignorado: allAnimeId não disponível para ${animeUrl}`);
      } else if (fallback === "animedrive") {
        const rawEps = await animeDriveEpisodes(animeUrl);
        eps = rawEps.map(mapAnimeDriveEpisodeToEpisode);
      } else if (fallback === "dattebayo") {
        const rawEps = await dattebayoEpisodes(animeUrl);
        eps = rawEps.map((e) => ({ number: e.number, label: e.label, url: e.url }));
      }
      if (eps.length) {
        recordSuccess(fallback);
        return eps;
      }
    } catch (err) {
      recordFailure(fallback);
      logger.warn("provider-chain", `fallback ${fallback} falhou: ${err}`);
    }
  }

  return [];
}

export async function getStreamUrlWithFallback(params: {
  provider: Provider;
  episodeUrl: string;
  allAnimeId?: string;
  episodeNumber?: number;
  quality?: string;
  nineAnimeEpisodeId?: string;
  preferSub?: boolean;
}): Promise<{ url: string; provider: Provider; quality: string; referer?: string } | null> {
  const { provider, episodeUrl, allAnimeId, episodeNumber, quality = "best", nineAnimeEpisodeId, preferSub = true } = params;

  // AllAnime primeiro se disponível
  if (allAnimeId && episodeNumber != null && isAvailable("allanime")) {
    try {
      const stream = await getAllAnimeStreamUrl(allAnimeId, episodeNumber, preferSub ? "sub" : "dub", quality);
      if (stream) {
        recordSuccess("allanime");
        return { url: stream.url, provider: "allanime", quality: stream.quality };
      }
    } catch (err) {
      recordFailure("allanime");
      logger.warn("provider-chain", `allanime stream falhou: ${err}`);
    }
  }

  // 9Anime se disponível
  if (nineAnimeEpisodeId && isAvailable("nineanime")) {
    try {
      const stream = await nineAnimeStreamUrl(nineAnimeEpisodeId, preferSub ? "sub" : "dub");
      if (stream) {
        recordSuccess("nineanime");
        return { url: stream.m3u8Url, provider: "nineanime", quality: "hls", referer: stream.referer };
      }
    } catch (err) {
      recordFailure("nineanime");
      logger.warn("provider-chain", `nineanime stream falhou: ${err}`);
    }
  }

  // AnimeDrive se a episodeUrl for do AnimeDrive
  if (provider === "animedrive" && episodeUrl && isAvailable("animedrive")) {
    try {
      const stream = await animeDriveStreamUrl(episodeUrl);
      if (stream) {
        recordSuccess("animedrive");
        return { url: stream.url, provider: "animedrive", quality: stream.quality, referer: stream.referer };
      }
    } catch (err) {
      recordFailure("animedrive");
      logger.warn("provider-chain", `animedrive stream falhou: ${err}`);
    }
  }

  if (provider === "dattebayo" && episodeUrl && isAvailable("dattebayo")) {
    try {
      const stream = await dattebayoStreamUrl(episodeUrl, quality === "best" ? "best" : "hd");
      if (stream) {
        recordSuccess("dattebayo");
        return { url: stream.url, provider: "dattebayo", quality: stream.quality, referer: stream.referer };
      }
    } catch (err) {
      recordFailure("dattebayo");
      logger.warn("provider-chain", `dattebayo stream falhou: ${err}`);
    }
  }

  // Retorna URL de página para yt-dlp processar (AnimeFire/Goyabu)
  logger.info("provider-chain", `retornando URL de página para yt-dlp: ${episodeUrl}`);
  return { url: episodeUrl, provider, quality: "ytdlp" };
}

export function getProviderInfo() {
  return [
    {
      id: "animefire",
      name: "AnimeFire",
      url: "https://animefire.plus",
      language: "pt-BR",
      active: true,
      description: "Principal fonte PT-BR. Scraping HTML direto.",
    },
    {
      id: "goyabu",
      name: "Goyabu",
      url: "https://goyabu.io",
      language: "pt-BR",
      active: true,
      description: "Fonte PT-BR alternativa. WordPress REST API + fallback HTML.",
    },
    {
      id: "allanime",
      name: "AllAnime",
      url: "https://allmanga.to",
      language: "en",
      active: true,
      description: "Melhor fonte EN. GraphQL + AES-256-CTR. Suporte sub/dub.",
    },
    {
      id: "nineanime",
      name: "9Anime",
      url: "https://9animetv.to",
      language: "en",
      active: true,
      description: "Fonte EN alternativa. AJAX + Rapid-Cloud. Sub/Dub.",
    },
    {
      id: "animedrive",
      name: "AnimeDrive",
      url: "https://animesdrive.online",
      language: "pt-BR",
      active: true,
      description: "Fonte PT-BR alternativa. WordPress DooPlay + MP4/HLS direto.",
    },
    {
      id: "superflix",
      name: "SuperFlix",
      url: "https://superflixapi.online",
      language: "pt-BR",
      active: true,
      description: "Filmes, séries e animes PT-BR. CSRF tokens + bootstrap API.",
    },
    {
      id: "dattebayo",
      name: "Dattebayo BR",
      url: "https://www.dattebayo-br.com",
      language: "pt-BR",
      active: true,
      description: "Fonte PT-BR com busca, episodios e MP4 direto na pagina do episodio.",
    },
    {
      id: "nyaa",
      name: "Nyaa.si (Torrent)",
      url: "https://nyaa.si",
      language: "multi",
      active: true,
      description: "Buscador de torrents. Requer qBittorrent configurado.",
    },
  ];
}
