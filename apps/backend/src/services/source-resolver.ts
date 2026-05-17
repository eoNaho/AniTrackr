import { logger } from "../utils/logger.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const GOYABU_ORIGIN = "https://goyabu.io";
const BLOGGER_ORIGIN = "https://www.blogger.com";
const DATTEBAYO_ORIGIN = "https://www.dattebayo-br.com";

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeEscapedUrl(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\\\//g, "/").trim();
}

function isBloggerTokenUrl(value: string): boolean {
  return /https?:\/\/(?:www\.)?blogger\.com\/video\.g\?token=/i.test(value);
}

function extractIframeSource(html: string): string | null {
  const match = html.match(/<iframe[^>]+src=["'](https?:\/\/[^"'<>]+)["']/i);
  const candidate = normalizeEscapedUrl(match?.[1] ?? "");
  return candidate && isHttpUrl(candidate) ? candidate : null;
}

function pickBestPlayUrl(play: unknown): string | null {
  if (!Array.isArray(play)) return null;

  let bestUrl = "";
  let bestSize = -1;

  for (const item of play) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const src = typeof record.src === "string" ? record.src.trim() : "";
    const size = typeof record.size === "number" ? record.size : Number(record.size ?? 0);
    if (!src || !isHttpUrl(src)) continue;
    if (size >= bestSize) {
      bestSize = size;
      bestUrl = src;
    }
  }

  return bestUrl || null;
}

function extractDirectVideoFromHtml(html: string): string | null {
  const patterns = [
    /"file"\s*:\s*"(https?:\/\/[^"]+\.(?:m3u8|mp4)[^"]*)"/i,
    /src\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /source\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /<video[^>]*>\s*<source[^>]*src=["'](https?:\/\/[^"']+)["']/i,
    /<iframe[^>]*src=["'](https?:\/\/[^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const candidate = normalizeEscapedUrl(match?.[1] ?? "");
    if (candidate && isHttpUrl(candidate)) return candidate;
  }

  return null;
}

function extractDattebayoVideoCandidates(html: string): string[] {
  const candidates: string[] = [];

  const vidRegex = /var\s+vid\s*=\s*['"]([^'"]+)['"]/gi;
  for (const match of html.matchAll(vidRegex)) {
    const value = normalizeEscapedUrl(match[1] ?? "");
    if (value && isHttpUrl(value)) candidates.push(value);
  }

  const contentUrl = html.match(/itemprop=["']contentURL["']\s+content=["']([^"']+)["']/i)?.[1] ?? "";
  const normalizedContent = normalizeEscapedUrl(contentUrl);
  if (normalizedContent && isHttpUrl(normalizedContent)) candidates.push(normalizedContent);

  const sourceRegex = /<source[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
  for (const match of html.matchAll(sourceRegex)) {
    const value = normalizeEscapedUrl(match[1] ?? "");
    if (value && isHttpUrl(value)) candidates.push(value);
  }

  return [...new Set(candidates)];
}

function scoreDattebayoCandidate(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes("/fful/")) return 30;
  if (lower.includes("/f333/")) return 20;
  if (lower.includes("/fiphonec/")) return 10;
  if (lower.endsWith(".mp4") || lower.includes(".mp4?")) return 5;
  return 0;
}

function extractPlayersData(html: string): Array<Record<string, unknown>> {
  const match = html.match(/var\s+playersData\s*=\s*(\[[\s\S]*?\])\s*;/i);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  } catch {
    return [];
  }
}

function decodeEncryptedBloggerUrl(value: string): string | null {
  if (!value) return null;
  try {
    let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    if (normalized.length % 4 !== 0) {
      normalized += "=".repeat(4 - (normalized.length % 4));
    }
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    const reversed = decoded.split("").reverse().join("").trim();
    if (!isHttpUrl(reversed)) return null;
    return reversed;
  } catch {
    return null;
  }
}

function extractBloggerFromPlayers(html: string): { token: string; url: string } | null {
  const players = extractPlayersData(html);
  for (const player of players) {
    const select = typeof player.select === "string" ? player.select.toLowerCase() : "";
    if (select !== "blogger") continue;

    const token = typeof player.blogger_token === "string" ? player.blogger_token.trim() : "";
    const url = normalizeEscapedUrl(typeof player.url === "string" ? player.url : "");
    if (token || url) return { token, url };
  }

  return null;
}

function extractEncryptedBloggerUrl(html: string): string | null {
  const match = html.match(/data-blogger-url-encrypted="([^"]+)"/i);
  if (!match?.[1]) return null;
  return decodeEncryptedBloggerUrl(match[1]);
}

async function decodeGoyabuBloggerToken(token: string, referer: string): Promise<string | null> {
  if (!token) return null;

  try {
    const form = new URLSearchParams();
    form.set("action", "decode_blogger_video");
    form.set("token", token);

    const response = await fetch(`${GOYABU_ORIGIN}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
        Referer: referer,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;
    const text = (await response.text()).trim();
    if (!text) return null;

    if (isHttpUrl(text)) return text;

    const parsed = JSON.parse(text) as Record<string, unknown>;
    const payload = parsed.data && typeof parsed.data === "object"
      ? (parsed.data as Record<string, unknown>)
      : null;

    const fromPlay = pickBestPlayUrl(payload?.play);
    if (fromPlay) return fromPlay;

    const keys = ["url", "file", "src", "video_url", "stream_url"] as const;
    for (const key of keys) {
      const fromPayload = typeof payload?.[key] === "string" ? String(payload[key]) : "";
      if (isHttpUrl(fromPayload)) return fromPayload;

      const fromRoot = typeof parsed[key] === "string" ? String(parsed[key]) : "";
      if (isHttpUrl(fromRoot)) return fromRoot;
    }
  } catch (err) {
    logger.debug("source-resolver", `decode_blogger_video failed: ${String(err)}`);
  }

  return null;
}

function decodeEscapedBloggerBatchUrl(raw: string): string {
  let value = raw;
  value = value.replace(/\\u003f/gi, "?");
  value = value.replace(/\\u003d/gi, "=");
  value = value.replace(/\\u0026/gi, "&");
  value = value.replace(/\\u0025/gi, "%");
  value = value.replace(/\\([=&/?])/g, "$1");
  value = value.replace(/\\\//g, "/");
  value = value.replace(/\\"/g, "\"");
  return value;
}

function scoreGoogleVideoCandidate(candidate: string): number {
  try {
    const parsed = new URL(candidate);
    const mime = (parsed.searchParams.get("mime") ?? "").toLowerCase();
    const itag = parseInt(parsed.searchParams.get("itag") ?? "0", 10);
    const clen = parseInt(parsed.searchParams.get("clen") ?? "0", 10);
    let score = 0;

    if (mime.includes("video/mp4")) score += 40_000;
    else if (mime.includes("video/webm")) score += 30_000;
    else if (mime.includes("video/3gpp")) score -= 40_000;

    const preferredItags: Record<number, number> = {
      37: 12_000, // 1080p mp4
      22: 10_000, // 720p mp4
      59: 8_000,  // 480p mp4
      18: 6_000,  // 360p mp4
      43: 5_000,
      36: -2_000, // low 3gpp
      17: -8_000, // very low 3gpp
      13: -12_000, // tiny 3gpp/mobile
    };
    score += preferredItags[itag] ?? 0;

    if (Number.isFinite(clen) && clen > 0) {
      score += Math.min(5_000, Math.round(clen / (1024 * 1024)));
    }

    return score;
  } catch {
    return Number.MIN_SAFE_INTEGER;
  }
}

function extractGoogleVideoCandidate(raw: string): string | null {
  const normalized = decodeEscapedBloggerBatchUrl(raw);
  const candidates: string[] = [];

  const direct = normalized.match(/https?:\/\/[^"\s]*googlevideo\.com\/[^"\s]+/gi) ?? [];
  candidates.push(...direct);

  const playUrls = normalized.match(/"play_url"\s*:\s*"([^"]+)"/gi) ?? [];
  for (const entry of playUrls) {
    const m = entry.match(/"play_url"\s*:\s*"([^"]+)"/i);
    if (m?.[1]) candidates.push(m[1]);
  }

  const ranked = candidates
    .map((candidate) => decodeEscapedBloggerBatchUrl(candidate).replace(/[",\]}]+$/g, ""))
    .filter((candidate) => isHttpUrl(candidate) && candidate.includes("googlevideo.com"))
    .map((candidate) => ({ candidate, score: scoreGoogleVideoCandidate(candidate) }))
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.candidate ?? null;
}

async function resolveBloggerGoogleVideoUrl(bloggerUrl: string, referer: string): Promise<string | null> {
  try {
    const token = new URL(bloggerUrl).searchParams.get("token") ?? "";
    if (!token) return null;

    const pageResponse = await fetch(bloggerUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
        Referer: referer,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pageResponse.ok) return null;

    const pageHtml = await pageResponse.text();
    const fromPage = extractGoogleVideoCandidate(pageHtml);
    if (fromPage) return fromPage;

    const sid = pageHtml.match(/"FdrFJe"\s*:\s*"([^"]+)"/)?.[1] ?? "";
    const build = pageHtml.match(/"cfb2h"\s*:\s*"([^"]+)"/)?.[1] ?? "";
    const at = pageHtml.match(/"SNlM0e"\s*:\s*"([^"]+)"/)?.[1] ?? "";
    if (!sid || !build) return null;

    const cookieHeader = pageResponse.headers.get("set-cookie");
    const sessionCookie = cookieHeader ? cookieHeader.split(";")[0] : "";

    const inner = JSON.stringify([token, "", 0]);
    const fReq = JSON.stringify([[["WcwnYd", inner, null, "generic"]]]);
    const body = new URLSearchParams();
    body.set("f.req", fReq);
    if (at) body.set("at", at);

    const batchUrl = `${BLOGGER_ORIGIN}/_/BloggerVideoPlayerUi/data/batchexecute?rpcids=WcwnYd&source-path=%2Fvideo.g&f.sid=${encodeURIComponent(sid)}&bl=${encodeURIComponent(build)}&hl=en-US&_reqid=100001&rt=c`;

    const batchResponse = await fetch(batchUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: BLOGGER_ORIGIN,
        Referer: bloggerUrl,
        "X-Same-Domain": "1",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!batchResponse.ok) return null;
    const batchText = await batchResponse.text();
    if (!batchText) return null;

    const fromBatch = extractGoogleVideoCandidate(batchText);
    if (fromBatch) return fromBatch;
  } catch (err) {
    logger.debug("source-resolver", `blogger batchexecute failed: ${String(err)}`);
  }

  return null;
}

async function resolveGoyabuEpisodeSource(episodeUrl: string): Promise<string | null> {
  try {
    const response = await fetch(episodeUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
        Referer: `${GOYABU_ORIGIN}/`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;
    const html = await response.text();

    const direct = extractDirectVideoFromHtml(html);
    if (direct && !direct.includes("blogger.com/video.g?token=")) {
      return direct;
    }

    const blogger = extractBloggerFromPlayers(html);
    if (blogger?.token) {
      const decoded = await decodeGoyabuBloggerToken(blogger.token, episodeUrl);
      if (decoded) return decoded;
    }

    if (blogger?.url && isHttpUrl(blogger.url)) return blogger.url;

    const encryptedFallback = extractEncryptedBloggerUrl(html);
    if (encryptedFallback) return encryptedFallback;

    return direct;
  } catch (err) {
    logger.debug("source-resolver", `goyabu resolve failed: ${String(err)}`);
    return null;
  }
}

async function resolveAnimefireEpisodeSource(episodeUrl: string): Promise<string | null> {
  try {
    const pageResponse = await fetch(episodeUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
        Referer: "https://animefire.io/",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pageResponse.ok) return null;

    const pageHtml = await pageResponse.text();
    
    const direct = extractDirectVideoFromHtml(pageHtml);
    if (direct) {
      if (isBloggerTokenUrl(direct)) {
        const fromBlogger = await resolveBloggerGoogleVideoUrl(direct, episodeUrl);
        if (fromBlogger) return fromBlogger;
        return direct;
      }
      return direct;
    }

    const iframeSource = extractIframeSource(pageHtml);
    if (iframeSource) {
      if (isBloggerTokenUrl(iframeSource)) {
        const fromBlogger = await resolveBloggerGoogleVideoUrl(iframeSource, episodeUrl);
        if (fromBlogger) return fromBlogger;
      }
      return iframeSource;
    }

    const endpointRaw = pageHtml.match(/data-video-src="([^"]+)"/i)?.[1] ?? "";
    const endpoint = normalizeEscapedUrl(endpointRaw.replace(/&amp;/g, "&"));
    if (!endpoint || !isHttpUrl(endpoint)) return null;

    const apiResponse = await fetch(endpoint, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
        Referer: episodeUrl,
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!apiResponse.ok) return null;

    const payload = (await apiResponse.json()) as {
      data?: Array<{ src?: string; label?: string }>;
      src?: string;
      url?: string;
    };

    if (Array.isArray(payload.data) && payload.data.length > 0) {
      const ranked = payload.data
        .map((entry) => {
          const src = normalizeEscapedUrl(entry.src ?? "");
          const label = entry.label ?? "";
          const q = parseInt(label.replace(/\D+/g, ""), 10);
          const quality = Number.isFinite(q) ? q : 0;
          const scoreBoost = src.includes("googlevideo.com") || src.includes(".mp4") ? 10000 : 0;
          const scorePenalty = isBloggerTokenUrl(src) ? -10000 : 0;
          return { src, quality, rank: quality + scoreBoost + scorePenalty };
        })
        .filter((entry) => entry.src && isHttpUrl(entry.src))
        .sort((a, b) => b.rank - a.rank);

      if (ranked[0]?.src) return ranked[0].src;
    }

    const fallback = normalizeEscapedUrl(payload.src ?? payload.url ?? "");
    if (fallback && isHttpUrl(fallback) && !isBloggerTokenUrl(fallback)) return fallback;
  } catch (err) {
    logger.debug("source-resolver", `animefire resolve failed: ${String(err)}`);
  }

  return null;
}

async function resolveDattebayoEpisodeSource(episodeUrl: string): Promise<string | null> {
  try {
    const pageResponse = await fetch(episodeUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
        Referer: `${DATTEBAYO_ORIGIN}/`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pageResponse.ok) return null;

    const pageHtml = await pageResponse.text();
    const candidates = extractDattebayoVideoCandidates(pageHtml);
    if (!candidates.length) return null;

    const best = [...candidates].sort((a, b) => scoreDattebayoCandidate(b) - scoreDattebayoCandidate(a))[0];
    return best && isHttpUrl(best) ? best : null;
  } catch (err) {
    logger.debug("source-resolver", `dattebayo resolve failed: ${String(err)}`);
  }

  return null;
}

/**
 * Resolve a page-like source URL into a direct playable URL when possible.
 * Keeps the original URL if no resolution strategy succeeds.
 */
export async function resolveDownloadSourceUrl(sourceUrl: string): Promise<string> {
  if (!isHttpUrl(sourceUrl)) return sourceUrl;

  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.toLowerCase();

    if (host.endsWith("dattebayo-br.com") && parsed.pathname.includes("/videos/")) {
      const fromDattebayo = await resolveDattebayoEpisodeSource(sourceUrl);
      if (fromDattebayo && isHttpUrl(fromDattebayo)) {
        logger.info("source-resolver", "dattebayo->direct-mp4 resolved");
        return fromDattebayo;
      }
      return sourceUrl;
    }

    if (host.endsWith("goyabu.io")) {
      const fromGoyabu = await resolveGoyabuEpisodeSource(sourceUrl);
      if (fromGoyabu && isHttpUrl(fromGoyabu)) {
        if (fromGoyabu.includes("blogger.com/video.g?token=")) {
          const fromBlogger = await resolveBloggerGoogleVideoUrl(fromGoyabu, sourceUrl);
          if (fromBlogger && isHttpUrl(fromBlogger)) {
            logger.info("source-resolver", `goyabu->blogger->googlevideo resolved`);
            return fromBlogger;
          }
        }
        logger.info("source-resolver", `goyabu source resolved`);
        return fromGoyabu;
      }
      return sourceUrl;
    }

    if (host.endsWith("animefire.io") || host.endsWith("animefire.plus")) {
      const fromAnimefire = await resolveAnimefireEpisodeSource(sourceUrl);
      if (fromAnimefire && isHttpUrl(fromAnimefire)) {
        if (fromAnimefire.includes("blogger.com/video.g?token=")) {
          const fromBlogger = await resolveBloggerGoogleVideoUrl(fromAnimefire, sourceUrl);
          if (fromBlogger && isHttpUrl(fromBlogger)) {
            logger.info("source-resolver", `animefire->blogger->googlevideo resolved`);
            return fromBlogger;
          }
          logger.warn("source-resolver", "animefire->blogger unresolved token, keeping episode page URL");
          return sourceUrl;
        }
        logger.info("source-resolver", "animefire->direct-mp4 resolved");
        return fromAnimefire;
      }
      return sourceUrl;
    }

    if (host.endsWith("blogger.com") && parsed.pathname === "/video.g") {
      const fromBlogger = await resolveBloggerGoogleVideoUrl(sourceUrl, sourceUrl);
      if (fromBlogger && isHttpUrl(fromBlogger)) {
        logger.info("source-resolver", `blogger->googlevideo resolved`);
        return fromBlogger;
      }
      return sourceUrl;
    }
  } catch (err) {
    logger.debug("source-resolver", `resolve failed: ${String(err)}`);
  }

  return sourceUrl;
}
