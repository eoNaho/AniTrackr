import * as cheerio from "cheerio";
import { logger } from "../utils/logger.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BASE_ANIMEFIRE = "https://animefire.plus";
const BASE_GOYABU = "https://goyabu.io";

export interface ScrapeResult {
  title: string;
  url: string;
  imageUrl?: string;
  provider: string;
}

export interface Episode {
  number: number;
  label: string;
  url: string;
}

async function get(url: string, referer: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
      Referer: referer,
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.text();
}

function resolveUrl(base: string, href: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return base + href;
  return `${base}/${href}`;
}

function extractEpisodeNumber(label: string, fallback: number): number {
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const explicitEpisode = normalized.match(/\b(?:episodio|ep)\s*\.?\s*(\d{1,4})\b/i);
  if (explicitEpisode) {
    const parsed = parseInt(explicitEpisode[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const allNums = Array.from(normalized.matchAll(/\d{1,4}/g))
    .map((m) => parseInt(m[0], 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (allNums.length > 0) return allNums[allNums.length - 1];

  return fallback;
}

// ─── AnimeFire ───────────────────────────────────────────────────────────────

export async function animefireSearch(query: string): Promise<ScrapeResult[]> {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, "-");
  const url = `${BASE_ANIMEFIRE}/pesquisar/${encodeURIComponent(normalized)}`;
  logger.debug("animefire", `search → ${url}`);
  try {
    const html = await get(url, `${BASE_ANIMEFIRE}/`);
    const $ = cheerio.load(html);
    const results: ScrapeResult[] = [];

    // Selector 1: list links
    $(".row.ml-1.mr-1 a").each((_i, el) => {
      const href = $(el).attr("href");
      const name = $(el).text().trim();
      if (href && name) {
        results.push({ title: name, url: resolveUrl(BASE_ANIMEFIRE, href), provider: "animefire" });
      }
    });

    if (results.length > 0) return results;

    // Selector 2: card grid
    $(".card_ani").each((_i, el) => {
      const a = $(el).find(".ani_name a");
      const title = a.text().trim();
      const href = a.attr("href");
      const img = $(el).find(".div_img img").attr("src");
      if (title && href) {
        results.push({
          title,
          url: resolveUrl(BASE_ANIMEFIRE, href),
          imageUrl: img ? resolveUrl(BASE_ANIMEFIRE, img) : undefined,
          provider: "animefire",
        });
      }
    });

    return results;
  } catch (err) {
    logger.warn("animefire", `search failed: ${err}`);
    return [];
  }
}

export async function animefireEpisodes(animeUrl: string): Promise<Episode[]> {
  logger.debug("animefire", `episodes → ${animeUrl}`);
  try {
    const html = await get(animeUrl, `${BASE_ANIMEFIRE}/`);
    const $ = cheerio.load(html);
    const episodes: Episode[] = [];

    $("a.lEp.epT.divNumEp.smallbox.px-2.mx-1.text-left.d-flex").each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr("href");
      const num = extractEpisodeNumber(text, i + 1);
      if (href) {
        episodes.push({ number: num, label: text || `Episódio ${num}`, url: resolveUrl(BASE_ANIMEFIRE, href) });
      }
    });

    return episodes.sort((a, b) => a.number - b.number);
  } catch (err) {
    logger.warn("animefire", `episodes failed: ${err}`);
    return [];
  }
}

// ─── Goyabu ──────────────────────────────────────────────────────────────────

async function goyabuNonce(): Promise<string> {
  const html = await get(BASE_GOYABU, `${BASE_GOYABU}/`);
  const m = html.match(/"nonce"\s*:\s*"([a-f0-9]+)"/);
  if (m) return m[1];
  throw new Error("nonce not found");
}

export async function goyabuSearch(query: string): Promise<ScrapeResult[]> {
  logger.debug("goyabu", `search → "${query}"`);
  try {
    const nonce = await goyabuNonce();
    const url = `${BASE_GOYABU}/wp-json/animeonline/search/?keyword=${encodeURIComponent(query)}&nonce=${nonce}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: `${BASE_GOYABU}/` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, { title?: string; url?: string; img?: string } | string>;
    const results: ScrapeResult[] = [];
    for (const val of Object.values(data)) {
      if (typeof val === "object" && val.title && val.url) {
        results.push({
          title: val.title,
          url: resolveUrl(BASE_GOYABU, val.url),
          imageUrl: val.img ?? undefined,
          provider: "goyabu",
        });
      }
    }
    return results;
  } catch (_e) {
    // Fallback HTML
    try {
      const url = `${BASE_GOYABU}/?s=${encodeURIComponent(query)}`;
      const html = await get(url, `${BASE_GOYABU}/`);
      const $ = cheerio.load(html);
      const results: ScrapeResult[] = [];
      $("article a, .anime-item a").each((_i, el) => {
        const href = $(el).attr("href") ?? "";
        if (!href.includes("/anime/")) return;
        const title =
          $(el).find("h3").text().trim() ||
          $(el).find("h2").text().trim() ||
          $(el).find("img").attr("alt")?.trim() ||
          "";
        if (!title) return;
        const img = $(el).find("img").attr("src") ?? undefined;
        results.push({ title, url: resolveUrl(BASE_GOYABU, href), imageUrl: img, provider: "goyabu" });
      });
      return [...new Map(results.map((r) => [r.url, r])).values()];
    } catch (err2) {
      logger.warn("goyabu", `search failed: ${err2}`);
      return [];
    }
  }
}

export async function goyabuEpisodes(animeUrl: string): Promise<Episode[]> {
  logger.debug("goyabu", `episodes → ${animeUrl}`);
  try {
    const html = await get(animeUrl, `${BASE_GOYABU}/`);
    const patterns = [
      /(?:const|let|var)\s+allEpisodes\s*=\s*(\[[\s\S]*?\])\s*;/,
      /episodes\s*[:=]\s*(\[[\s\S]*?\])/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (!m) continue;
      try {
        const arr = JSON.parse(m[1]) as { id: number | string; episodio?: string }[];
        return arr
          .map((ep, i) => {
            const num = ep.episodio ? parseInt(ep.episodio) || i + 1 : i + 1;
            return {
              number: num,
              label: `Episódio ${num}`,
              url: `${BASE_GOYABU}/?p=${ep.id}`,
            };
          })
          .sort((a, b) => a.number - b.number);
      } catch {
        continue;
      }
    }
    return [];
  } catch (err) {
    logger.warn("goyabu", `episodes failed: ${err}`);
    return [];
  }
}

// ─── Unified search ───────────────────────────────────────────────────────────

export async function searchAll(query: string): Promise<ScrapeResult[]> {
  const [af, gy] = await Promise.allSettled([animefireSearch(query), goyabuSearch(query)]);
  const results: ScrapeResult[] = [];
  if (af.status === "fulfilled") results.push(...af.value);
  if (gy.status === "fulfilled") results.push(...gy.value);
  return results;
}

export async function getEpisodes(animeUrl: string, provider: string): Promise<Episode[]> {
  if (provider === "goyabu") return goyabuEpisodes(animeUrl);
  return animefireEpisodes(animeUrl);
}
