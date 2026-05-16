/**
 * Nyaa.si torrent search via RSS público.
 * Categorias: 1_2 = Anime EN-translated, 1_4 = Raw, 0_0 = Tudo
 */

export interface NyaaResult {
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
  releaseType: "raw" | "subbed" | "dubbed" | "unknown";
}

const TRACKERS = [
  "http://nyaa.tracker.wf:7777/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
];

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

function parseSizeBytes(sizeStr: string): number {
  const m = sizeStr.match(/([\d.]+)\s*(GiB|MiB|KiB|GB|MB|KB)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit.startsWith("G")) return Math.round(val * 1024 * 1024 * 1024);
  if (unit.startsWith("M")) return Math.round(val * 1024 * 1024);
  if (unit.startsWith("K")) return Math.round(val * 1024);
  return 0;
}

function buildMagnet(infoHash: string, title: string): string {
  const hash = infoHash.toLowerCase();
  const dn = encodeURIComponent(title);
  const trs = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("");
  return `magnet:?xt=urn:btih:${hash}&dn=${dn}${trs}`;
}

function extractGroup(title: string): string {
  const m = title.match(/^\[([^\]]+)\]/);
  return m ? m[1] : "";
}

function extractResolution(title: string): string {
  const m = title.match(/\b(2160p|1080p|720p|480p|360p)\b/i);
  return m ? m[1] : "";
}

function inferReleaseType(title: string, category: string): NyaaResult["releaseType"] {
  const normalizedTitle = title.toLowerCase();
  const normalizedCategory = category.toLowerCase();

  if (normalizedCategory.includes("raw")) return "raw";
  if (/\b(raw|raws|unsubbed|no subs?|no subtitles?)\b/i.test(normalizedTitle)) return "raw";
  if (/\b(dub|dubbed|dual audio)\b/i.test(normalizedTitle)) return "dubbed";
  if (/\b(sub|subs|subbed|softsub|multi-sub|multi subs|english translated)\b/i.test(normalizedTitle)) return "subbed";
  return "unknown";
}

function parseItems(rssXml: string): NyaaResult[] {
  const results: NyaaResult[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(rssXml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link").trim();
    const infoHash = extractTag(block, "nyaa:infoHash").trim();
    const size = extractTag(block, "nyaa:size").trim();
    const seeders = parseInt(extractTag(block, "nyaa:seeders")) || 0;
    const leechers = parseInt(extractTag(block, "nyaa:leechers")) || 0;
    const downloads = parseInt(extractTag(block, "nyaa:downloads")) || 0;
    const category = extractTag(block, "nyaa:category").trim();
    const pubDate = extractTag(block, "pubDate").trim();

    if (!title || !infoHash) continue;

    // link é a URL da página de visualização (ex: https://nyaa.si/view/1234)
    const idMatch = link.match(/\/view\/(\d+)/);
    const id = idMatch ? idMatch[1] : infoHash;
    const torrentUrl = id ? `https://nyaa.si/download/${id}.torrent` : "";
    const magnetLink = buildMagnet(infoHash, title);

    results.push({
      id,
      title,
      pageUrl: link,
      torrentUrl,
      magnetLink,
      infoHash,
      size,
      sizeBytes: parseSizeBytes(size),
      seeders,
      leechers,
      downloads,
      category,
      pubDate,
      group: extractGroup(title),
      resolution: extractResolution(title),
      releaseType: inferReleaseType(title, category),
    });
  }

  return results;
}

export async function searchNyaa(
  query: string,
  options: {
    category?: string;
    preferredGroup?: string;
    preferredResolution?: string;
    limit?: number;
  } = {}
): Promise<NyaaResult[]> {
  const { category = "1_2", limit = 50 } = options;
  const q = encodeURIComponent(query.trim());
  const url = `https://nyaa.si/?page=rss&q=${q}&c=${category}&f=0`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AniTrackrTracker/2.0)",
      "Accept": "application/rss+xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new Error(`Nyaa RSS retornou ${resp.status}`);

  const xml = await resp.text();
  let items = parseItems(xml);

  // Ranking: grupo preferido + resolução preferida + seeders
  if (options.preferredGroup || options.preferredResolution || category === "1_2" || category === "1_4") {
    items = items.sort((a, b) => {
      let sa = 0, sb = 0;
      if (category === "1_4") {
        if (a.releaseType === "raw") sa += 90;
        if (b.releaseType === "raw") sb += 90;
        if (a.releaseType === "subbed" || a.releaseType === "dubbed") sa -= 90;
        if (b.releaseType === "subbed" || b.releaseType === "dubbed") sb -= 90;
      } else if (category === "1_2") {
        if (a.releaseType === "subbed") sa += 90;
        if (b.releaseType === "subbed") sb += 90;
      }
      if (options.preferredGroup) {
        if (a.group.toLowerCase().includes(options.preferredGroup!.toLowerCase())) sa += 100;
        if (b.group.toLowerCase().includes(options.preferredGroup!.toLowerCase())) sb += 100;
      }
      if (options.preferredResolution) {
        if (a.resolution === options.preferredResolution) sa += 50;
        if (b.resolution === options.preferredResolution) sb += 50;
      }
      sa += Math.min(a.seeders, 50);
      sb += Math.min(b.seeders, 50);
      return sb - sa;
    });
  }

  return items.slice(0, limit);
}

export async function getNyaaById(id: string): Promise<NyaaResult | null> {
  const url = `https://nyaa.si/?page=rss&q=&c=0_0&f=0`;
  // Para busca por ID específico, usamos a URL de download direta
  const torrentUrl = `https://nyaa.si/download/${id}.torrent`;
  // Retorna um resultado mínimo com o que podemos inferir do ID
  return {
    id,
    title: `Torrent #${id}`,
    pageUrl: `https://nyaa.si/view/${id}`,
    torrentUrl,
    magnetLink: "",
    infoHash: "",
    size: "?",
    sizeBytes: 0,
    seeders: 0,
    leechers: 0,
    downloads: 0,
    category: "",
    pubDate: "",
    group: "",
    resolution: "",
    releaseType: "unknown",
  };
}
