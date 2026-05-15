/**
 * 9animetv.to scraper — porta do Go (internal/scraper/nineanime.go).
 * Fluxo: Search → GetEpisodes (AJAX) → GetServers (AJAX) → GetSource → GetStreamInfo
 */

import * as cheerio from "cheerio";

const BASE = "https://9animetv.to";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface NineAnimeSearchResult {
  title: string;
  animeId: string;
  imageUrl: string;
  extra: string;
}

export interface NineAnimeEpisode {
  number: number;
  title: string;
  episodeId: string;
}

export interface NineAnimeServer {
  name: string;
  dataId: string;
  serverId: string;
  audioType: "sub" | "dub" | "raw";
}

export interface NineAnimeStreamInfo {
  m3u8Url: string;
  referer: string;
  subtitles: { label: string; file: string; kind: string }[];
  introStart: number;
  introEnd: number;
  outroStart: number;
  outroEnd: number;
}

const searchCache = new Map<string, NineAnimeSearchResult[]>();
const serverCache = new Map<string, NineAnimeServer[]>();

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `${BASE}/`,
    ...extra,
  };
}

function ajaxHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...headers(extra),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
  };
}

function isChallengePage(html: string): boolean {
  return html.includes("just a moment") || html.includes("cf-wrapper") || html.includes("cloudflare");
}

const ID_RE = /-(\d+)$/;
const RC_RE = /\/embed-2\/v2\/e-1\/([^?/]+)/;
const DOMAIN_RE = /^(https?:\/\/[^/]+)/;
const M3U8_RE = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/;
const FILE_RE = /"file"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/;

export async function nineAnimeSearch(query: string): Promise<NineAnimeSearchResult[]> {
  const key = query.toLowerCase().trim();
  if (searchCache.has(key)) return searchCache.get(key)!;

  const url = `${BASE}/search?keyword=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(12_000),
  });

  if (!resp.ok) throw new Error(`9anime search HTTP ${resp.status}`);
  const html = await resp.text();
  if (isChallengePage(html.toLowerCase())) throw new Error("9anime: Cloudflare challenge detectado");

  const $ = cheerio.load(html);
  const results: NineAnimeSearchResult[] = [];

  $(".film_list-wrap .flw-item").each((_i, el) => {
    const link = $(el).find("h3.film-name a, .film-name a").first();
    const title = link.text().trim();
    const href = link.attr("href") ?? "";
    const idMatch = ID_RE.exec(href);
    const animeId = idMatch ? idMatch[1] : "";
    const imgEl = $(el).find("img").first();
    const imageUrl = imgEl.attr("data-src") ?? imgEl.attr("src") ?? "";

    const extraParts: string[] = [];
    $(el).find(".tick-item, .tick-sub, .tick-dub, .tick-eps").each((_j, badge) => {
      const t = $(badge).text().trim();
      if (t) extraParts.push(t);
    });

    if (title && animeId) {
      results.push({ title, animeId, imageUrl, extra: extraParts.join(" ") });
    }
  });

  searchCache.set(key, results);
  return results;
}

export async function nineAnimeEpisodes(animeId: string): Promise<NineAnimeEpisode[]> {
  const url = `${BASE}/ajax/episode/list/${animeId}`;
  const resp = await fetch(url, {
    headers: ajaxHeaders(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) throw new Error(`9anime episodes HTTP ${resp.status}`);
  const json = await resp.json() as { status: boolean; html: string };
  if (!json.html) return [];

  const $ = cheerio.load(json.html);
  const episodes: NineAnimeEpisode[] = [];

  $("a.ep-item").each((_i, el) => {
    const epNum = parseInt($(el).attr("data-number") ?? "0");
    const epId = $(el).attr("data-id") ?? "";
    const epTitle = $(el).attr("title") ?? `Episode ${epNum}`;
    if (epId) episodes.push({ number: epNum, title: epTitle, episodeId: epId });
  });

  return episodes;
}

export async function nineAnimeServers(episodeId: string): Promise<NineAnimeServer[]> {
  const key = `srv:${episodeId}`;
  if (serverCache.has(key)) return serverCache.get(key)!;

  const url = `${BASE}/ajax/episode/servers?episodeId=${episodeId}`;
  const resp = await fetch(url, {
    headers: ajaxHeaders(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) throw new Error(`9anime servers HTTP ${resp.status}`);
  const json = await resp.json() as { status: boolean; html: string };
  if (!json.html) return [];

  const $ = cheerio.load(json.html);
  const servers: NineAnimeServer[] = [];

  $(".server-item").each((_i, el) => {
    const name = $(el).text().trim();
    const dataId = $(el).attr("data-id") ?? "";
    const serverId = $(el).attr("data-server-id") ?? "";
    const audioType = ($(el).attr("data-type") ?? "sub") as NineAnimeServer["audioType"];
    if (dataId && name) servers.push({ name, dataId, serverId, audioType });
  });

  serverCache.set(key, servers);
  return servers;
}

async function getSource(serverDataId: string): Promise<{ embedUrl: string; server: number } | null> {
  const url = `${BASE}/ajax/episode/sources?id=${serverDataId}`;
  const resp = await fetch(url, {
    headers: ajaxHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { link?: string; server?: number };
  if (!data.link) return null;
  return { embedUrl: data.link, server: data.server ?? 0 };
}

async function resolveRapidCloud(embedUrl: string): Promise<NineAnimeStreamInfo | null> {
  const m = RC_RE.exec(embedUrl);
  if (!m) return null;
  const videoId = m[1];
  const domainMatch = DOMAIN_RE.exec(embedUrl);
  const baseDomain = domainMatch ? domainMatch[1] : "https://rapid-cloud.co";

  const sourcesUrl = `${baseDomain}/embed-2/v2/e-1/getSources?id=${videoId}`;
  try {
    const resp = await fetch(sourcesUrl, {
      headers: {
        "Referer": embedUrl,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": UA,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      sources: any;
      tracks?: { label: string; file: string; kind: string; default?: boolean }[];
      intro?: { start: number; end: number };
      outro?: { start: number; end: number };
    };

    let m3u8Url = "";
    if (Array.isArray(data.sources) && data.sources[0]?.file) {
      m3u8Url = data.sources[0].file;
    } else if (typeof data.sources === "string") {
      m3u8Url = data.sources;
    }
    if (!m3u8Url) return null;

    const subtitles = (data.tracks ?? [])
      .filter((t) => t.kind === "captions" || t.kind === "subtitles")
      .map((t) => ({ label: t.label, file: t.file, kind: t.kind }));

    return {
      m3u8Url,
      referer: baseDomain + "/",
      subtitles,
      introStart: data.intro?.start ?? 0,
      introEnd: data.intro?.end ?? 0,
      outroStart: data.outro?.start ?? 0,
      outroEnd: data.outro?.end ?? 0,
    };
  } catch {
    return null;
  }
}

async function scrapeEmbedPage(embedUrl: string): Promise<NineAnimeStreamInfo | null> {
  try {
    const resp = await fetch(embedUrl, {
      headers: { "Referer": `${BASE}/`, "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const text = await resp.text();

    let m3u8Url = "";
    const m1 = M3U8_RE.exec(text);
    if (m1) m3u8Url = m1[1];
    else {
      const m2 = FILE_RE.exec(text);
      if (m2) m3u8Url = m2[1];
    }
    if (!m3u8Url) return null;

    const domainMatch = DOMAIN_RE.exec(embedUrl);
    return {
      m3u8Url,
      referer: domainMatch ? domainMatch[1] + "/" : "",
      subtitles: [],
      introStart: 0, introEnd: 0, outroStart: 0, outroEnd: 0,
    };
  } catch {
    return null;
  }
}

export async function nineAnimeStreamUrl(
  episodeId: string,
  preferAudio: "sub" | "dub" = "sub"
): Promise<NineAnimeStreamInfo | null> {
  const allServers = await nineAnimeServers(episodeId);
  if (!allServers.length) return null;

  const preferred = allServers.filter((s) => s.audioType === preferAudio);
  const toTry = preferred.length ? preferred : allServers;

  for (const server of toTry) {
    const source = await getSource(server.dataId);
    if (!source) continue;

    const fromRC = await resolveRapidCloud(source.embedUrl);
    if (fromRC) return fromRC;

    const fromPage = await scrapeEmbedPage(source.embedUrl);
    if (fromPage) return fromPage;
  }

  return null;
}

export function clearNineAnimeCache() {
  searchCache.clear();
  serverCache.clear();
}
