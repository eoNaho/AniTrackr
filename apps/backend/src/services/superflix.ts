/**
 * SuperFlix (superflixapi.online) — provider PT-BR de filmes/séries/animes.
 * Fluxo: Search → PlayerPage → ExtractTokens → Bootstrap → GetSourceURL
 */

import * as cheerio from "cheerio";
import { logger } from "../utils/logger.ts";

const BASE = "https://superflixapi.online";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface SuperFlixMedia {
  title: string;
  year: string;
  type: string;
  sfType: "filme" | "serie";
  tmdbId: string;
  imdbId: string;
  imageUrl: string;
  linkUrl: string;
}

export interface SuperFlixEpisode {
  number: number;
  title: string;
  airDate: string;
}

export interface SuperFlixStreamInfo {
  url: string;
  referer: string;
  title: string;
  subtitles: { lang: string; url: string }[];
}

interface Tokens {
  csrf: string;
  pageToken: string;
  contentId: string;
  contentType: string;
  title: string;
}

interface Server {
  id: string | number;
  name: string;
}

const CSRF_RE = /var CSRF_TOKEN\s*=\s*"([^"]+)"/;
const PAGE_TOKEN_RE = /var PAGE_TOKEN\s*=\s*"([^"]+)"/;
const CONTENT_ID_RE = /var INITIAL_CONTENT_ID\s*=\s*(\d+)/;
const CONTENT_TYPE_RE = /var CONTENT_TYPE\s*=\s*"([^"]+)"/;
const TITLE_RE = /<title>(?:Player \| )?(.+?)<\/title>/;
const ALL_EPISODES_RE = /var ALL_EPISODES\s*=\s*(\{.+?\});/s;
const SUBTITLE_RE = /var playerjsSubtitle\s*=\s*"(.+?)";/;
const SUB_PART_RE = /\[(.+?)\](https?:\/\/.+)/;

function hdrs(referer?: string): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
    "Referer": referer ?? BASE + "/",
  };
}

function normalizeTitle(s: string): string {
  return s.trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

function normalizeSfImageUrl(url: string): string {
  if (!url) return "";
  const idx = url.indexOf("https://image.tmdb.org/t/p/");
  if (idx > 0) {
    return url.slice(idx)
      .replace("/w342/", "/w500/")
      .replace("/w185/", "/w500/")
      .replace("/w154/", "/w500/");
  }
  return url;
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function superFlixSearch(query: string): Promise<SuperFlixMedia[]> {
  const normalized = normalizeTitle(query);
  const url = `${BASE}/pesquisar?s=${encodeURIComponent(normalized)}`;

  const resp = await fetch(url, { headers: hdrs(), signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`SuperFlix search HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);
  const results: SuperFlixMedia[] = [];
  const seen = new Set<string>();

  $("div.group\\/card, [class*='group/card'], .card-item, .card").each((_i, card) => {
    let title = "";
    let imageUrl = "";

    const img = $(card).find("img").first();
    if (img.length) {
      title = img.attr("alt")?.trim() ?? "";
      imageUrl = img.attr("src") ?? img.attr("data-src") ?? "";
      if (!imageUrl || imageUrl.startsWith("data:")) {
        const srcset = img.attr("srcset") ?? "";
        const parts = srcset.split(",")[0]?.trim().split(/\s+/);
        imageUrl = parts?.[0] ?? "";
      }
    }
    if (!title) title = $(card).find("h3").first().text().trim();
    if (!title) return;

    let tmdbId = "";
    let imdbId = "";
    let linkUrl = "";

    $(card).find("button").each((_j, btn) => {
      const msg = $(btn).attr("data-msg") ?? "";
      const val = $(btn).attr("data-copy") ?? "";
      if (msg.includes("TMDB")) tmdbId = val;
      else if (msg.includes("IMDB")) imdbId = val;
      else if (msg.includes("Link")) linkUrl = val;
    });

    let tipo = "";
    let year = "";
    $(card).find("div.mt-3 span, .card-meta span").each((_j, span) => {
      const text = $(span).text().trim();
      if (!text) return;
      if (/^[12]\d{3}$/.test(text)) { year = text; return; }
      tipo = text;
    });

    if (!tipo && !year) {
      const meta = $(card).find("div.mt-3, .card-meta").first().text().trim();
      const parts = meta.split("|").map((s) => s.trim());
      tipo = parts[parts.length - 1] ?? "";
      year = parts[1] ?? "";
    }

    const sfType: "filme" | "serie" = linkUrl.includes("/filme/") ? "filme" : "serie";
    if (!tipo) tipo = sfType === "filme" ? "Filme" : "Série";

    const key = tmdbId || title;
    if (seen.has(key)) return;
    seen.add(key);

    results.push({
      title,
      year,
      type: tipo,
      sfType,
      tmdbId,
      imdbId,
      imageUrl: normalizeSfImageUrl(imageUrl),
      linkUrl,
    });
  });

  logger.info("superflix", `search "${query}": ${results.length} resultados`);
  return results;
}

// ── Player page + tokens ──────────────────────────────────────────────────────

async function getPlayerPage(path: string): Promise<string> {
  const url = path.startsWith("http") ? path : BASE + path;
  const resp = await fetch(url, {
    headers: {
      ...hdrs(BASE + "/"),
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`SuperFlix player page HTTP ${resp.status}`);
  return resp.text();
}

function extractTokens(html: string): Tokens {
  return {
    csrf: CSRF_RE.exec(html)?.[1] ?? "",
    pageToken: PAGE_TOKEN_RE.exec(html)?.[1] ?? "",
    contentId: CONTENT_ID_RE.exec(html)?.[1] ?? "",
    contentType: CONTENT_TYPE_RE.exec(html)?.[1] ?? "",
    title: TITLE_RE.exec(html)?.[1] ?? "",
  };
}

function extractSubtitles(html: string): { lang: string; url: string }[] {
  const m = SUBTITLE_RE.exec(html);
  if (!m) return [];
  const subs: { lang: string; url: string }[] = [];
  for (const part of m[1].split(",")) {
    const pm = SUB_PART_RE.exec(part.trim());
    if (pm) subs.push({ lang: pm[1], url: pm[2] });
  }
  return subs;
}

export function extractSuperFlixEpisodes(html: string): Record<string, SuperFlixEpisode[]> {
  const m = ALL_EPISODES_RE.exec(html);
  if (!m) return {};
  try {
    const raw = JSON.parse(m[1]) as Record<string, { epi_num: string | number; title: string; air_date: string }[]>;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out: Record<string, SuperFlixEpisode[]> = {};
    for (const [season, eps] of Object.entries(raw)) {
      out[season] = eps
        .filter((ep) => {
          if (!ep.air_date || ep.air_date === "null") return false;
          return new Date(ep.air_date) <= today;
        })
        .map((ep) => ({
          number: Number(ep.epi_num),
          title: ep.title ?? "",
          airDate: ep.air_date,
        }));
    }
    return out;
  } catch {
    return {};
  }
}

// ── Bootstrap + GetSourceURL ──────────────────────────────────────────────────

async function bootstrap(tokens: Tokens): Promise<Server[]> {
  const form = new URLSearchParams({
    contentid: tokens.contentId,
    type: tokens.contentType,
    _token: tokens.csrf,
    page_token: tokens.pageToken,
    pageToken: tokens.pageToken,
  });

  const resp = await fetch(`${BASE}/player/bootstrap`, {
    method: "POST",
    headers: {
      ...hdrs(BASE + "/"),
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Page-Token": tokens.pageToken,
      "X-Requested-With": "XMLHttpRequest",
      "Origin": BASE,
    },
    body: form.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`SuperFlix bootstrap HTTP ${resp.status}`);

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("SuperFlix bootstrap: resposta não é JSON");
  }

  const data = await resp.json() as { data?: { options?: Server[] } };
  return data.data?.options ?? [];
}

async function getSourceUrl(videoId: string, tokens: Tokens): Promise<string> {
  const form = new URLSearchParams({
    video_id: videoId,
    page_token: tokens.pageToken,
    host: "",
    _token: tokens.csrf,
  });

  const resp = await fetch(`${BASE}/player/source`, {
    method: "POST",
    headers: {
      ...hdrs(BASE + "/"),
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Page-Token": tokens.pageToken,
      "X-Requested-With": "XMLHttpRequest",
      "Origin": BASE,
    },
    body: form.toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });

  // SuperFlix redireciona para o stream real
  if (resp.status === 302 || resp.status === 301) {
    const location = resp.headers.get("location") ?? "";
    if (location) return location;
  }

  const data = await resp.json() as { url?: string; stream?: string; data?: { url?: string } };
  return data.url ?? data.stream ?? data.data?.url ?? "";
}

// ── GetStreamUrl (ponto de entrada) ──────────────────────────────────────────

export async function superFlixStreamUrl(params: {
  mediaType: "filme" | "serie";
  mediaId: string;
  season?: string;
  episode?: string;
}): Promise<SuperFlixStreamInfo | null> {
  let path = `/${params.mediaType}/${params.mediaId}`;
  if (params.season) path += `/${params.season}`;
  if (params.episode) path += `/${params.episode}`;

  const html = await getPlayerPage(path);
  const tokens = extractTokens(html);

  if (!tokens.csrf || !tokens.pageToken || !tokens.contentId) {
    logger.warn("superflix", "tokens não encontrados na página do player");
    return null;
  }

  const subtitles = extractSubtitles(html);
  const servers = await bootstrap(tokens);

  if (!servers.length) {
    logger.warn("superflix", "nenhum servidor retornado pelo bootstrap");
    return null;
  }

  for (const server of servers) {
    const videoId = String(server.id);
    try {
      const streamUrl = await getSourceUrl(videoId, tokens);
      if (streamUrl) {
        logger.info("superflix", `stream via servidor "${server.name}": ${streamUrl.slice(0, 60)}`);
        return {
          url: streamUrl,
          referer: BASE + "/",
          title: tokens.title,
          subtitles,
        };
      }
    } catch (err) {
      logger.warn("superflix", `servidor "${server.name}" falhou: ${err}`);
    }
  }

  return null;
}

// ── Busca de episódios de série ───────────────────────────────────────────────

export async function superFlixGetEpisodes(mediaId: string, season: number): Promise<SuperFlixEpisode[]> {
  const path = `/serie/${mediaId}/${season}/1`;
  const html = await getPlayerPage(path);
  const all = extractSuperFlixEpisodes(html);
  return all[String(season)] ?? [];
}
