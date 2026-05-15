import * as cheerio from "cheerio";

const BASE = "https://www.anirena.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const TRACKERS = [
  "udp://tracker-udp.anirena.com:80/announce",
  "https://tracker.anirena.com/announce",
  "http://nyaa.tracker.wf:7777/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
];

const INFO_HASH_RE = /\b[a-f0-9]{40}\b/i;
const RESOLUTION_RE = /\b(2160p|1440p|1080p|900p|720p|576p|540p|480p|360p)\b/i;

export interface AniRenaResult {
  id: string;
  title: string;
  pageUrl: string;
  torrentUrl: string;
  magnetLink: string;
  infoHash: string;
  size: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  downloads: number;
  category: string;
  pubDate: string;
  group: string;
  resolution: string;
}

function parseSizeBytes(sizeStr: string): number {
  const m = sizeStr.match(/([\d.]+)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit.includes("TI") || unit === "TB") return Math.round(val * 1024 * 1024 * 1024 * 1024);
  if (unit.includes("GI") || unit === "GB") return Math.round(val * 1024 * 1024 * 1024);
  if (unit.includes("MI") || unit === "MB") return Math.round(val * 1024 * 1024);
  if (unit.includes("KI") || unit === "KB") return Math.round(val * 1024);
  return 0;
}

function toAbsolute(urlOrPath: string): string {
  if (!urlOrPath) return "";
  try {
    return new URL(urlOrPath, BASE).toString();
  } catch {
    return "";
  }
}

function parseFirstInt(raw: string): number {
  const m = raw.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function extractGroup(title: string, fallback = ""): string {
  const fromBadge = fallback.replace(/^\[|\]$/g, "").trim();
  if (fromBadge) return fromBadge;
  const m = title.match(/^\[([^\]]+)\]/);
  return m ? m[1].trim() : "";
}

function extractResolution(title: string): string {
  const m = title.match(RESOLUTION_RE);
  return m ? m[1] : "";
}

function buildMagnet(infoHash: string, title: string): string {
  const hash = infoHash.toLowerCase();
  const dn = encodeURIComponent(title);
  const trs = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("");
  return `magnet:?xt=urn:btih:${hash}&dn=${dn}${trs}`;
}

function looksLikeChallenge(html: string): boolean {
  const h = html.toLowerCase();
  if (h.includes("cf-challenge")) return true;
  if (h.includes("just a moment") && h.includes("cloudflare")) return true;
  if (h.includes("/cdn-cgi/challenge-platform/") && !h.includes("data-torrent-id=")) return true;
  return false;
}

async function fetchInfoHash(pageUrl: string): Promise<string> {
  const resp = await fetch(pageUrl, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": `${BASE}/`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) return "";

  const html = await resp.text();
  if (looksLikeChallenge(html)) return "";

  const $ = cheerio.load(html);
  const fromCode = $("code.td-ov-stat-hash").first().text().trim();
  if (INFO_HASH_RE.test(fromCode)) return fromCode.toLowerCase();

  const fallback = html.match(INFO_HASH_RE);
  return fallback ? fallback[0].toLowerCase() : "";
}

async function enrichInfoHashes(results: AniRenaResult[], concurrency = 5): Promise<void> {
  if (!results.length) return;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, results.length) }, () =>
    (async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= results.length) return;

        const item = results[idx];
        try {
          const infoHash = await fetchInfoHash(item.pageUrl);
          if (!infoHash) continue;
          item.infoHash = infoHash;
          item.magnetLink = buildMagnet(infoHash, item.title);
        } catch {
          // Melhor esforco: segue sem info-hash.
        }
      }
    })()
  );

  await Promise.all(workers);
}

export async function searchAniRena(
  query: string,
  options: {
    page?: number;
    preferredGroup?: string;
    preferredResolution?: string;
    limit?: number;
    includeInfoHash?: boolean;
  } = {}
): Promise<AniRenaResult[]> {
  const q = query.trim();
  if (!q) return [];

  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, options.limit ?? 50);
  const url = `${BASE}/?q=${encodeURIComponent(q)}&page=${page}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": `${BASE}/`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new Error(`AniRena search retornou ${resp.status}`);

  const html = await resp.text();
  if (looksLikeChallenge(html)) {
    throw new Error("AniRena bloqueou a busca (challenge Cloudflare detectado)");
  }

  const $ = cheerio.load(html);
  const results: AniRenaResult[] = [];

  $("tr[data-torrent-id]").each((_i, row) => {
    const id = ($(row).attr("data-torrent-id") ?? "").trim();
    if (!id) return;

    const titleLink = $(row).find("a.tl-torrent-name").first();
    const title = titleLink.text().trim();
    if (!title) return;

    const pageUrl = toAbsolute(titleLink.attr("href") ?? `/torrent/${id}`);
    const torrentUrl = toAbsolute(`/torrents/${id}.torrent`);

    const sizeRaw = $(row).find("td.col-size").first().text().trim()
      || $(row).find(".tl-meta-size").first().text().trim();

    const seeders = parseFirstInt($(row).find("td.col-se").first().text());
    const leechers = parseFirstInt($(row).find("td.col-le").first().text());
    const downloads = parseFirstInt($(row).find("td.col-dl").first().text());
    const pubDate = ($(row).find("td.col-date [data-utc]").first().attr("data-utc") ?? "").trim()
      || $(row).find("td.col-date").first().text().trim();

    const category = ($(row).find("td.col-cat").first().attr("title") ?? "").trim();
    const groupText = $(row).find("a.tl-group").first().text().trim();

    results.push({
      id,
      title,
      pageUrl,
      torrentUrl,
      magnetLink: "",
      infoHash: "",
      size: sizeRaw,
      sizeBytes: parseSizeBytes(sizeRaw),
      seeders,
      leechers,
      downloads,
      category,
      pubDate,
      group: extractGroup(title, groupText),
      resolution: extractResolution(title),
    });
  });

  let ranked = results;

  if (options.preferredGroup || options.preferredResolution) {
    ranked = ranked.sort((a, b) => {
      let sa = 0;
      let sb = 0;

      if (options.preferredGroup) {
        const g = options.preferredGroup.toLowerCase();
        if (a.group.toLowerCase().includes(g)) sa += 100;
        if (b.group.toLowerCase().includes(g)) sb += 100;
      }

      if (options.preferredResolution) {
        if (a.resolution === options.preferredResolution) sa += 50;
        if (b.resolution === options.preferredResolution) sb += 50;
      }

      sa += Math.min(a.seeders, 100);
      sb += Math.min(b.seeders, 100);
      return sb - sa;
    });
  }

  ranked = ranked.slice(0, limit);

  if (options.includeInfoHash !== false) {
    await enrichInfoHashes(ranked);
  }

  return ranked;
}
