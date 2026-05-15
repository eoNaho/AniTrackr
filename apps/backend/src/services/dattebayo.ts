/**
 * Dattebayo BR (dattebayo-br.com) provider.
 * Fluxo: Search -> Episodes -> Stream URL (MP4 direto quando disponivel).
 */

import * as cheerio from "cheerio";
import { logger } from "../utils/logger.ts";

const BASE = "https://www.dattebayo-br.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const EP_NUM_RE = /\b(?:episodio|epis[oó]dio|ep)\s*\.?\s*(\d{1,4})\b/i;
const VID_RE = /var\s+vid\s*=\s*['"]([^'"]+)['"]/gi;

export interface DattebayoResult {
  title: string;
  url: string;
  imageUrl: string;
  episodesText: string;
  isDubbed: boolean;
}

export interface DattebayoEpisode {
  number: number;
  title: string;
  label: string;
  url: string;
  publishedAt?: string;
}

export interface DattebayoStreamInfo {
  url: string;
  quality: "sd" | "hd" | "full" | "unknown";
  referer: string;
}

function hdrs(referer = BASE): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
    Referer: referer,
    "Cache-Control": "no-cache",
  };
}

function toAbsolute(urlOrPath: string): string {
  if (!urlOrPath) return "";
  try {
    return new URL(urlOrPath, BASE).toString();
  } catch {
    return "";
  }
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function parseEpisodeNumber(label: string, fallback: number): number {
  const m = EP_NUM_RE.exec(label);
  if (m?.[1]) return parseInt(m[1], 10);

  const first = label.match(/(\d{1,4})/);
  if (first?.[1]) return parseInt(first[1], 10);

  return fallback;
}

function qualityFromUrl(url: string): "sd" | "hd" | "full" | "unknown" {
  const lower = url.toLowerCase();
  if (lower.includes("/fful/")) return "full";
  if (lower.includes("/f333/")) return "hd";
  if (lower.includes("/fiphonec/")) return "sd";
  return "unknown";
}

function qualityScore(q: DattebayoStreamInfo["quality"]): number {
  if (q === "full") return 3;
  if (q === "hd") return 2;
  if (q === "sd") return 1;
  return 0;
}

function pickByPreferred(
  list: DattebayoStreamInfo[],
  preferredQuality: "best" | "sd" | "hd" | "full"
): DattebayoStreamInfo {
  if (!list.length) throw new Error("Lista de streams vazia");

  if (preferredQuality !== "best") {
    const exact = list.find((item) => item.quality === preferredQuality);
    if (exact) return exact;
  }

  return [...list].sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality))[0];
}

function uniqueByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

async function getHtml(url: string, referer = BASE): Promise<string> {
  const resp = await fetch(url, {
    headers: hdrs(referer),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Dattebayo HTTP ${resp.status} @ ${url}`);
  return resp.text();
}

export async function dattebayoSearch(
  query: string,
  options: { page?: number; limit?: number; includeDubbed?: boolean } = {}
): Promise<DattebayoResult[]> {
  const q = normalizeText(query);
  if (!q) return [];

  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, options.limit ?? 30);
  const includeDubbed = options.includeDubbed !== false;
  const url = `${BASE}/busca?busca=${encodeURIComponent(q)}&page=${page}`;

  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const results: DattebayoResult[] = [];

  $(".ultimosAnimesHomeItem > a").each((_i, el) => {
    const href = toAbsolute($(el).attr("href") ?? "");
    if (!href) return;
    if (!href.includes("/animes/") && !href.includes("/anime-dublado/")) return;

    const title = normalizeText(
      $(el).find(".ultimosAnimesHomeItemInfosNome").first().text() ||
        $(el).attr("title") ||
        ""
    );
    if (!title) return;

    const imageUrl = toAbsolute($(el).find("img").first().attr("src") ?? "");
    const episodesText = normalizeText(
      $(el).find(".ultimosAnimesHomeItemQntEps").first().text()
    );
    const isDubbed = href.includes("/anime-dublado/") || /dublado/i.test(title);

    results.push({
      title,
      url: href,
      imageUrl,
      episodesText,
      isDubbed,
    });
  });

  const deduped = uniqueByUrl(results).filter((item) => includeDubbed || !item.isDubbed);
  const finalList = deduped.slice(0, limit);

  logger.info("dattebayo", `search "${q}": ${finalList.length} resultados`);
  return finalList;
}

export async function dattebayoEpisodes(animeUrl: string): Promise<DattebayoEpisode[]> {
  const url = toAbsolute(animeUrl);
  if (!url) return [];

  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const episodes: DattebayoEpisode[] = [];

  $(".ultimosEpisodiosHomeItem > a[href*='/videos/']").each((i, el) => {
    const epUrl = toAbsolute($(el).attr("href") ?? "");
    if (!epUrl) return;

    const title = normalizeText(
      $(el).find(".ultimosEpisodiosHomeItemInfosNome").first().text() ||
        $(el).attr("title") ||
        `Episodio ${i + 1}`
    );
    const label = normalizeText(
      $(el).find(".ultimosEpisodiosHomeItemInfosNum").first().text() || title
    );
    const publishedAt = normalizeText($(el).find(".lancaster_episodio_info_data").first().text());
    const number = parseEpisodeNumber(`${label} ${title}`, i + 1);

    episodes.push({
      number,
      title,
      label: label || `Episodio ${number}`,
      url: epUrl,
      publishedAt: publishedAt || undefined,
    });
  });

  const sorted = uniqueByUrl(episodes).sort((a, b) => a.number - b.number);
  logger.info("dattebayo", `episodes "${animeUrl}": ${sorted.length} eps`);
  return sorted;
}

export async function dattebayoStreamUrl(
  episodeUrl: string,
  preferredQuality: "best" | "sd" | "hd" | "full" = "best"
): Promise<DattebayoStreamInfo | null> {
  const url = toAbsolute(episodeUrl);
  if (!url) return null;

  const html = await getHtml(url, url);
  const $ = cheerio.load(html);
  const candidates: DattebayoStreamInfo[] = [];

  // 1) Principal fonte: scripts com var vid='...mp4'
  for (const match of html.matchAll(VID_RE)) {
    const streamUrl = toAbsolute(match[1] ?? "");
    if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) continue;
    candidates.push({
      url: streamUrl,
      quality: qualityFromUrl(streamUrl),
      referer: url,
    });
  }

  // 2) Fallback: schema.org contentURL.
  const schemaUrl = toAbsolute(
    $("meta[itemprop='contentURL']").first().attr("content") ?? ""
  );
  if (schemaUrl) {
    candidates.push({
      url: schemaUrl,
      quality: qualityFromUrl(schemaUrl),
      referer: url,
    });
  }

  // 3) Fallback extra: source tags.
  $("video source[src]").each((_i, el) => {
    const src = toAbsolute($(el).attr("src") ?? "");
    if (!src) return;
    candidates.push({
      url: src,
      quality: qualityFromUrl(src),
      referer: url,
    });
  });

  const unique = uniqueByUrl(candidates);
  if (!unique.length) {
    logger.warn("dattebayo", `stream nao encontrado para ${episodeUrl}`);
    return null;
  }

  const picked = pickByPreferred(unique, preferredQuality);
  logger.info("dattebayo", `stream ${picked.quality} @ ${picked.url.slice(0, 70)}`);
  return picked;
}
