/**
 * AnimeDrive (animesdrive.online) — provider PT-BR.
 * Site WordPress/DooPlay com API dooplayer v2.
 * Fluxo: Search → GetEpisodes → GetVideoOptions → ResolveStream
 */

import * as cheerio from "cheerio";
import { logger } from "../utils/logger.ts";

const BASE = "https://animesdrive.online";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

export interface AnimeDriveResult {
  title: string;
  url: string;
  imageUrl: string;
  isDubbed: boolean;
}

export interface AnimeDriveEpisode {
  number: number;
  title: string;
  url: string;
}

export interface AnimeDriveStreamInfo {
  url: string;
  type: "mp4" | "hls" | "iframe";
  referer: string;
  quality: string;
}

const SOURCE_RE = /source=([^&"'\s]+)/;
const EP_NUM_RE = /episodio[s]?[-_]?(\d+)/i;
const DIGIT_RE = /(\d+)/;
const PREFERRED_DOMAINS = ["tityos.feralhosting.com", "feralhosting.com", "archive.org"];
const PROBLEMATIC_DOMAINS = ["aniplay.online", "animeshd.cloud", "animes.strp2p.com"];

function hdrs(referer?: string): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
    "Referer": referer ?? BASE,
  };
}

function resolveUrl(ref: string): string {
  if (ref.startsWith("http")) return ref;
  if (ref.startsWith("/")) return BASE + ref;
  return BASE + "/" + ref;
}

function isPreferred(url: string): boolean {
  const l = url.toLowerCase();
  return PREFERRED_DOMAINS.some((d) => l.includes(d));
}

function isProblematic(url: string): boolean {
  const l = url.toLowerCase();
  return PROBLEMATIC_DOMAINS.some((d) => l.includes(d));
}

function decodeSource(embedUrl: string): string | null {
  const m = SOURCE_RE.exec(embedUrl);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function animeDriveSearch(query: string): Promise<AnimeDriveResult[]> {
  const normalized = query.trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  const url = `${BASE}/?s=${encodeURIComponent(normalized)}`;

  const resp = await fetch(url, { headers: hdrs(), signal: AbortSignal.timeout(12_000) });
  if (!resp.ok) throw new Error(`AnimeDrive search HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);
  const results: AnimeDriveResult[] = [];

  const selectors = [
    "div.result-item article",
    "article.w_item_a",
    "article.item",
    "div.search-page .item",
  ];

  for (const sel of selectors) {
    $(sel).each((_i, el) => {
      let title = "";
      let href = "";

      const titleLink = $(el).find("div.title a, div.details .title a").first();
      if (titleLink.length) {
        title = titleLink.text().trim();
        href = titleLink.attr("href") ?? "";
      }

      if (!href) {
        const a = $(el).find("a").first();
        href = a.attr("href") ?? "";
        title = $(el).find("h3, h2, .data h3").first().text().trim()
          || (a.attr("title")?.trim() ?? "");
      }

      if (!href || !href.includes("/anime/") || !title) return;

      const img = $(el).find("img").first();
      const imageUrl = img.attr("data-src") ?? img.attr("src") ?? "";

      results.push({
        title,
        url: resolveUrl(href),
        imageUrl,
        isDubbed: /dublado/i.test(title),
      });
    });
    if (results.length) break;
  }

  logger.info("animedrive", `search "${query}": ${results.length} resultados`);
  return results;
}

// ── Episodes ─────────────────────────────────────────────────────────────────

export async function animeDriveEpisodes(animeUrl: string): Promise<AnimeDriveEpisode[]> {
  const url = resolveUrl(animeUrl);
  const resp = await fetch(url, { headers: hdrs(), signal: AbortSignal.timeout(12_000) });
  if (!resp.ok) throw new Error(`AnimeDrive episodes HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);
  const episodes: AnimeDriveEpisode[] = [];

  const epSel = "#seasons .episodios li a, .episodios li a, ul.episodios a, .se-a a, #episodes a, .episodelist a";
  $(epSel).each((_i, el) => {
    const epUrl = $(el).attr("href") ?? "";
    if (!epUrl || !epUrl.includes("episodio")) return;

    const epTitle = $(el).text().trim();
    let num = 0;
    const m1 = EP_NUM_RE.exec(epUrl);
    if (m1) num = parseInt(m1[1]);
    else {
      const m2 = DIGIT_RE.exec(epTitle);
      if (m2) num = parseInt(m2[1]);
    }

    episodes.push({ number: num, title: epTitle || `Episódio ${num}`, url: resolveUrl(epUrl) });
  });

  // ordena por número
  episodes.sort((a, b) => a.number - b.number);
  logger.info("animedrive", `episodes "${animeUrl}": ${episodes.length} eps`);
  return episodes;
}

// ── Video Options (dooplayer API) ─────────────────────────────────────────────

interface VideoOption {
  label: string;
  postId: string;
  type: string;
  nume: string;
}

async function getVideoOptions(episodeUrl: string): Promise<VideoOption[]> {
  const url = resolveUrl(episodeUrl);
  const resp = await fetch(url, { headers: hdrs(), signal: AbortSignal.timeout(12_000) });
  if (!resp.ok) return [];
  const html = await resp.text();
  const $ = cheerio.load(html);
  const opts: VideoOption[] = [];

  const sel = ".dooplay_player_option, [class*='player_option'], [data-post][data-nume]";
  $(sel).each((i, el) => {
    const postId = $(el).attr("data-post") ?? "";
    if (!postId) return;
    const type = $(el).attr("data-type") ?? "tv";
    const nume = $(el).attr("data-nume") ?? String(i + 1);
    const label = $(el).find(".title, span").first().text().trim() || $(el).text().trim() || `Server ${i + 1}`;
    opts.push({ label, postId, type, nume });
  });

  return opts;
}

async function dooplayer(postId: string, type: string, nume: string, referer: string): Promise<{ embedUrl: string; type: string } | null> {
  const url = `${BASE}/wp-json/dooplayer/v2/${postId}/${type}/${nume}`;
  try {
    const resp = await fetch(url, {
      headers: { ...hdrs(referer), "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { embed_url?: string; type?: string };
    if (!data.embed_url) return null;
    return { embedUrl: data.embed_url, type: data.type ?? "" };
  } catch {
    return null;
  }
}

function embedToStream(embedUrl: string): AnimeDriveStreamInfo | null {
  // MP4 direto
  if (embedUrl.endsWith(".mp4") || /\.mp4[?#]/.test(embedUrl)) {
    return { url: embedUrl, type: "mp4", referer: BASE, quality: "sd" };
  }
  // HLS direto
  if (embedUrl.includes(".m3u8")) {
    return { url: embedUrl, type: "hls", referer: BASE, quality: "hls" };
  }
  // source= param (padrão dooplayer)
  const src = decodeSource(embedUrl);
  if (src) {
    const type = src.includes(".m3u8") ? "hls" : "mp4";
    return { url: src, type, referer: BASE, quality: type === "hls" ? "hls" : "sd" };
  }
  return null;
}

// ── GetStreamUrl (ponto de entrada) ─────────────────────────────────────────

export async function animeDriveStreamUrl(episodeUrl: string): Promise<AnimeDriveStreamInfo | null> {
  const epPageUrl = resolveUrl(episodeUrl);
  const opts = await getVideoOptions(epPageUrl);

  if (!opts.length) {
    logger.warn("animedrive", `nenhuma opção encontrada para ${episodeUrl}`);
    return null;
  }

  // Resolve todas as opções e coleta candidatos
  interface Candidate { info: AnimeDriveStreamInfo; preferred: boolean; problematic: boolean }
  const candidates: Candidate[] = [];

  for (const opt of opts) {
    const result = await dooplayer(opt.postId, opt.type, opt.nume, epPageUrl);
    if (!result) continue;
    const stream = embedToStream(result.embedUrl);
    if (stream) {
      candidates.push({
        info: stream,
        preferred: isPreferred(stream.url),
        problematic: isProblematic(stream.url),
      });
      logger.info("animedrive", `candidato: ${stream.type} @ ${stream.url.slice(0, 60)}`);
    }
  }

  if (!candidates.length) return null;

  // Ordena: preferido primeiro, problemático por último
  candidates.sort((a, b) => {
    if (a.preferred && !b.preferred) return -1;
    if (!a.preferred && b.preferred) return 1;
    if (a.problematic && !b.problematic) return 1;
    if (!a.problematic && b.problematic) return -1;
    return 0;
  });

  return candidates[0].info;
}
