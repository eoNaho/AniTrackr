/**
 * AllAnime scraper — TypeScript port do AniTrackr allanime.go
 *
 * Key phrase: "Xot36i3lK3:v1"  (rotacionada em 2026-04-24)
 * Persisted query hash: d405d0e...  (2026-04-22)
 * Origin para GET path: https://youtu-chan.com
 * AES-256-CTR: nonce(12) from blob[1:13], counter = nonce || 0x00000002
 * Hex substitution table: ani-cli provider_init
 */

import { createHash, createCipheriv } from "crypto";
import { logger } from "../utils/logger.ts";

const API = "https://api.allanime.day/api";
const REFERER = "https://allmanga.to";
const ORIGIN_PERSISTED = "https://youtu-chan.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

const KEY_PHRASE = "Xot36i3lK3:v1";
const PERSISTED_HASH = "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec";

// AES-256 key = SHA-256(KEY_PHRASE)
const AES_KEY = createHash("sha256").update(KEY_PHRASE).digest();

// Hex substitution table (ani-cli provider_init)
const HEX_TABLE: Record<string, string> = {
  "79":"A","7a":"B","7b":"C","7c":"D","7d":"E","7e":"F","7f":"G",
  "70":"H","71":"I","72":"J","73":"K","74":"L","75":"M","76":"N","77":"O",
  "68":"P","69":"Q","6a":"R","6b":"S","6c":"T","6d":"U","6e":"V","6f":"W",
  "60":"X","61":"Y","62":"Z",
  "59":"a","5a":"b","5b":"c","5c":"d","5d":"e","5e":"f","5f":"g",
  "50":"h","51":"i","52":"j","53":"k","54":"l","55":"m","56":"n","57":"o",
  "48":"p","49":"q","4a":"r","4b":"s","4c":"t","4d":"u","4e":"v","4f":"w",
  "40":"x","41":"y","42":"z",
  "08":"0","09":"1","0a":"2","0b":"3","0c":"4","0d":"5","0e":"6","0f":"7",
  "00":"8","01":"9",
  "15":"-","16":".","67":"_","46":"~","02":":","17":"/","07":"?","1b":"#",
  "63":"[","65":"]","78":"@","19":"!","1c":"$","1e":"&","10":"(","11":")",
  "12":"*","13":"+","14":",","03":";","05":"=","1d":"%",
};

function decodeSourceURL(encoded: string): string {
  let result = "";
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    const pair = encoded.slice(i, i + 2);
    result += HEX_TABLE[pair] ?? pair;
  }
  result = result.replace(/\/clock\b/g, "/clock.json");
  if (result.startsWith("/")) result = `https://allanime.day${result}`;
  return result;
}

/**
 * Decripta o blob "tobeparsed" do AllAnime.
 * Formato: [0x01][12-byte nonce][ciphertext][16 trailing bytes]
 * Cifra: AES-256-CTR, counter = nonce || 0x00000002
 */
function decodeToBeParsed(blob: string): { sourceName: string; sourceUrl: string }[] {
  // tenta base64 padrão e URL-safe
  let data: Buffer | null = null;
  for (const enc of ["base64", "base64url"] as const) {
    try { data = Buffer.from(blob, enc); if (data.length >= 30) break; } catch { }
  }
  if (!data || data.length < 30) throw new Error(`tobeparsed muito curto: ${data?.length ?? 0}B`);

  const nonce = data.subarray(1, 13);           // bytes [1..12]
  const ciphertext = data.subarray(13, data.length - 16); // sem trailing 16B

  const iv = Buffer.alloc(16);
  nonce.copy(iv, 0);
  iv[15] = 0x02; // counter fixo pelo protocolo (GCM J0+1)

  const stream = createCipheriv("aes-256-ctr", AES_KEY, iv);
  const plaintext = Buffer.concat([stream.update(ciphertext), stream.final()]);

  const text = plaintext.toString("utf8");
  logger.debug("allanime", `tobeparsed decrypted (${text.length} chars): ${text.slice(0, 80)}...`);

  // tenta JSON estruturado primeiro
  try {
    const parsed = JSON.parse(text) as {
      data?: { episode?: { sourceUrls?: { sourceUrl: string; sourceName: string }[] } };
    };
    const urls = parsed?.data?.episode?.sourceUrls;
    if (urls?.length) {
      return urls.map((u) => ({
        sourceName: u.sourceName,
        sourceUrl: u.sourceUrl.replace(/^--/, ""),
      }));
    }
  } catch { /* continua */ }

  // regex fallback (igual ao bash sed)
  const re = /"sourceUrl"\s*:\s*"--([^"]*)"[^}]*"sourceName"\s*:\s*"([^"]*)"/g;
  const results: { sourceName: string; sourceUrl: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) results.push({ sourceName: m[2], sourceUrl: m[1] });
  return results;
}

function headers(extra?: Record<string, string>) {
  return { "User-Agent": UA, Referer: REFERER, ...extra };
}

async function graphqlPost(body: object): Promise<unknown> {
  const res = await fetch(API, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Busca ──────────────────────────────────────────────────────────────────

export interface AllAnimeResult {
  id: string;
  name: string;
  englishName: string | null;
  episodeCount: number;
  imageUrl?: string;
}

export async function searchAllAnime(query: string, mode: "sub" | "dub" = "sub"): Promise<AllAnimeResult[]> {
  const SEARCH_GQL = `query($search: SearchInput, $limit: Int, $page: Int, $translationType: VaildTranslationTypeEnumType, $countryOrigin: VaildCountryOriginEnumType) {
    shows(search: $search, limit: $limit, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
      edges { _id name englishName thumbnail availableEpisodes __typename }
    }
  }`;

  try {
    const resp = (await graphqlPost({
      query: SEARCH_GQL,
      variables: {
        search: { allowAdult: false, allowUnknown: false, query },
        limit: 40, page: 1,
        translationType: mode,
        countryOrigin: "ALL",
      },
    })) as { data?: { shows?: { edges?: { _id: string; name: string; englishName: string; thumbnail: string; availableEpisodes: Record<string, number> }[] } } };

    const edges = resp?.data?.shows?.edges ?? [];
    return edges
      .map((e) => ({
        id: e._id,
        name: e.name,
        englishName: e.englishName || null,
        episodeCount: e.availableEpisodes?.[mode] ?? 0,
        imageUrl: e.thumbnail || undefined,
      }))
      .sort((a, b) => b.episodeCount - a.episodeCount);
  } catch (err) {
    logger.warn("allanime", `search failed: ${err}`);
    return [];
  }
}

// ── Lista de episódios ─────────────────────────────────────────────────────

export async function getAllAnimeEpisodes(animeId: string, mode: "sub" | "dub" = "sub"): Promise<number[]> {
  const GQL = `query ($showId: String!) { show(_id: $showId) { _id availableEpisodesDetail } }`;
  try {
    const resp = (await graphqlPost({ query: GQL, variables: { showId: animeId } })) as {
      data?: { show?: { availableEpisodesDetail?: Record<string, (string | number)[]> } };
    };
    const detail = resp?.data?.show?.availableEpisodesDetail ?? {};
    const eps = (detail[mode] ?? [])
      .map((ep) => parseFloat(String(ep)))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
    return eps;
  } catch (err) {
    logger.warn("allanime", `episodes failed for ${animeId}: ${err}`);
    return [];
  }
}

// ── Stream URL ─────────────────────────────────────────────────────────────

export interface StreamInfo {
  url: string;
  quality: string;
  sourceName: string;
  isHLS: boolean;
}

async function fetchSourceEntries(
  animeId: string,
  episodeNo: string,
  mode: string
): Promise<{ sourceName: string; sourceUrl: string }[]> {
  const vars = JSON.stringify({ showId: animeId, translationType: mode, episodeString: episodeNo });
  const ext = JSON.stringify({ persistedQuery: { version: 1, sha256Hash: PERSISTED_HASH } });

  // 1. Tenta GET com persistedQuery (único que retorna tobeparsed)
  try {
    const url = `${API}?variables=${encodeURIComponent(vars)}&extensions=${encodeURIComponent(ext)}`;
    const res = await fetch(url, {
      headers: headers({ Origin: ORIGIN_PERSISTED }),
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text.includes('"tobeparsed"')) {
        const blobMatch = text.match(/"tobeparsed"\s*:\s*"([^"]*)"/);
        if (blobMatch) {
          const sources = decodeToBeParsed(blobMatch[1]);
          if (sources.length > 0) return sources;
        }
      }
      // Tenta parseamento direto sem tobeparsed
      const json = JSON.parse(text) as { data?: { episode?: { sourceUrls?: { sourceUrl: string; sourceName: string }[] } } };
      const urls = json?.data?.episode?.sourceUrls ?? [];
      if (urls.length > 0) return urls.map((u) => ({ ...u, sourceUrl: u.sourceUrl.replace(/^--/, "") }));
    }
  } catch (err) {
    logger.debug("allanime", `GET path failed: ${err}`);
  }

  // 2. Fallback: POST legacy
  const EPISODE_GQL = `query ($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) {
    episode(showId: $showId translationType: $translationType episodeString: $episodeString) {
      episodeString sourceUrls
    }
  }`;
  try {
    const resp = (await graphqlPost({
      query: EPISODE_GQL,
      variables: { showId: animeId, translationType: mode, episodeString: episodeNo },
    })) as { data?: { episode?: { sourceUrls?: { sourceUrl: string; sourceName: string }[] } } };
    return (resp?.data?.episode?.sourceUrls ?? []).map((u) => ({
      ...u,
      sourceUrl: u.sourceUrl.replace(/^--/, ""),
    }));
  } catch (err) {
    logger.warn("allanime", `POST fallback failed: ${err}`);
    return [];
  }
}

async function resolveSourceUrl(encoded: string): Promise<Record<string, string>> {
  const decoded = decodeSourceURL(encoded);
  if (!decoded.startsWith("http")) return {};
  try {
    const res = await fetch(decoded, {
      headers: headers(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return {};
    const json = (await res.json()) as { links?: { link: string; resolutionStr?: string; hls?: boolean }[] };
    const links: Record<string, string> = {};
    for (const item of json?.links ?? []) {
      if (!item.link) continue;
      const quality = item.resolutionStr ?? (item.hls ? "hls" : "unknown");
      links[quality] = item.link.replace(/\\/g, "");
    }
    return links;
  } catch {
    return {};
  }
}

const QUALITY_ORDER = ["1080p", "720p", "480p", "360p", "hls", "unknown"];

export async function getAllAnimeStreamUrl(
  animeId: string,
  episodeNo: string | number,
  mode: "sub" | "dub" = "sub",
  preferQuality = "best"
): Promise<StreamInfo | null> {
  const ep = String(episodeNo);
  const sources = await fetchSourceEntries(animeId, ep, mode);
  if (!sources.length) return null;

  // Resolve todas as sources em paralelo
  const resolved = await Promise.allSettled(
    sources.map(async (s) => {
      const links = await resolveSourceUrl(s.sourceUrl);
      return { links, sourceName: s.sourceName };
    })
  );

  // Selecionar melhor qualidade
  const qualityMap: Record<string, { url: string; sourceName: string }> = {};
  for (const r of resolved) {
    if (r.status !== "fulfilled") continue;
    for (const [q, url] of Object.entries(r.value.links)) {
      if (!qualityMap[q]) qualityMap[q] = { url, sourceName: r.value.sourceName };
    }
  }

  if (!Object.keys(qualityMap).length) return null;

  const order = preferQuality === "best" ? QUALITY_ORDER : [...QUALITY_ORDER].reverse();
  for (const q of order) {
    if (qualityMap[q]) {
      return {
        url: qualityMap[q].url,
        quality: q,
        sourceName: qualityMap[q].sourceName,
        isHLS: q === "hls" || qualityMap[q].url.includes(".m3u8"),
      };
    }
  }

  // Retorna qualquer
  const first = Object.entries(qualityMap)[0];
  return { url: first[1].url, quality: first[0], sourceName: first[1].sourceName, isHLS: false };
}
