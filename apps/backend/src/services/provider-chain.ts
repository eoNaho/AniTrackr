/**
 * Provider fallback chain: AnimeFire → Goyabu → AllAnime
 * Tenta cada provider em sequência até obter resultado.
 */

import { animefireSearch, goyabuSearch, animefireEpisodes, goyabuEpisodes, type ScrapeResult, type Episode } from "./scraper.ts";
import { searchAllAnime, getAllAnimeEpisodes, getAllAnimeStreamUrl } from "./allanime.ts";
import { logger } from "../utils/logger.ts";

export type Provider = "animefire" | "goyabu" | "allanime" | "all";

export interface UnifiedSearchResult extends ScrapeResult {
  provider: Provider;
  allAnimeId?: string;
}

/** Busca em todos os providers e agrega resultados */
export async function searchAllProviders(
  query: string,
  providers: Provider[] = ["animefire", "goyabu", "allanime"]
): Promise<UnifiedSearchResult[]> {
  const tasks: Promise<UnifiedSearchResult[]>[] = [];

  if (providers.includes("animefire")) {
    tasks.push(
      animefireSearch(query).then((rs) =>
        rs.map((r) => ({ ...r, provider: "animefire" as Provider }))
      ).catch(() => [])
    );
  }
  if (providers.includes("goyabu")) {
    tasks.push(
      goyabuSearch(query).then((rs) =>
        rs.map((r) => ({ ...r, provider: "goyabu" as Provider }))
      ).catch(() => [])
    );
  }
  if (providers.includes("allanime")) {
    tasks.push(
      searchAllAnime(query).then((rs) =>
        rs.map((r) => ({
          title: r.englishName ?? r.name,
          url: r.id, // AllAnime usa _id como "URL"
          imageUrl: r.imageUrl,
          provider: "allanime" as Provider,
          allAnimeId: r.id,
        }))
      ).catch(() => [])
    );
  }

  const settled = await Promise.allSettled(tasks);
  const results: UnifiedSearchResult[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") results.push(...r.value);
  }
  return results;
}

/** Obtém episódios com fallback entre providers */
export async function getEpisodesWithFallback(
  animeUrl: string,
  provider: Provider,
  allAnimeId?: string
): Promise<Episode[]> {
  // Tenta provider primário
  const primary = async (): Promise<Episode[]> => {
    if (provider === "animefire") return animefireEpisodes(animeUrl);
    if (provider === "goyabu") return goyabuEpisodes(animeUrl);
    if (provider === "allanime" && allAnimeId) {
      const nums = await getAllAnimeEpisodes(allAnimeId);
      return nums.map((n) => ({ number: n, label: `Episódio ${n}`, url: String(n) }));
    }
    return [];
  };

  try {
    const eps = await primary();
    if (eps.length > 0) return eps;
    logger.warn("provider-chain", `primary (${provider}) returned 0 episodes, trying fallbacks`);
  } catch (err) {
    logger.warn("provider-chain", `primary (${provider}) failed: ${err}`);
  }

  // Fallback chain
  const fallbackOrder: Provider[] = ["animefire", "goyabu", "allanime"].filter(
    (p) => p !== provider
  ) as Provider[];

  for (const fallback of fallbackOrder) {
    logger.info("provider-chain", `trying fallback provider: ${fallback}`);
    try {
      if (fallback === "animefire") {
        const eps = await animefireEpisodes(animeUrl);
        if (eps.length) return eps;
      } else if (fallback === "goyabu") {
        const eps = await goyabuEpisodes(animeUrl);
        if (eps.length) return eps;
      }
      // AllAnime não tem fallback por URL — precisa do ID
    } catch (err) {
      logger.warn("provider-chain", `fallback ${fallback} failed: ${err}`);
    }
  }

  return [];
}

/** Obtém stream URL com fallback entre providers */
export async function getStreamUrlWithFallback(params: {
  provider: Provider;
  episodeUrl: string;
  allAnimeId?: string;
  episodeNumber?: number;
  quality?: string;
}): Promise<{ url: string; provider: Provider; quality: string } | null> {
  const { provider, episodeUrl, allAnimeId, episodeNumber, quality = "best" } = params;

  // AllAnime primeiro se disponível
  if (allAnimeId && episodeNumber != null) {
    try {
      const stream = await getAllAnimeStreamUrl(allAnimeId, episodeNumber, "sub", quality);
      if (stream) {
        logger.info("provider-chain", `stream from allanime: ${stream.quality}`);
        return { url: stream.url, provider: "allanime", quality: stream.quality };
      }
    } catch (err) {
      logger.warn("provider-chain", `allanime stream failed: ${err}`);
    }
  }

  // Nota: AnimeFire/Goyabu exigem navegação adicional na página para extrair o stream
  // — isso é feito pelo yt-dlp no downloader real. Retornamos a URL da página.
  logger.info("provider-chain", `returning page URL for yt-dlp: ${episodeUrl}`);
  return { url: episodeUrl, provider, quality: "ytdlp" };
}

/** Informações sobre os providers disponíveis */
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
  ];
}
