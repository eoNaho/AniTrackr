import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { dirname } from "path";
import db, { getActiveQueueProfile } from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { buildPath, inferSeasonInfo, stripSeasonSuffix } from "./naming.ts";
import { getAllAnimeStreamUrl, searchAllAnime } from "./allanime.ts";
import { animefireEpisodes, animefireSearch, goyabuSearch, goyabuEpisodes } from "./scraper.ts";
import { animeDriveSearch, animeDriveEpisodes, animeDriveStreamUrl } from "./animedrive.ts";
import { dattebayoSearch, dattebayoEpisodes, dattebayoStreamUrl } from "./dattebayo.ts";
import { resolveDownloadSourceUrl } from "./source-resolver.ts";
import { generateSingleEpisodeNfoAsync } from "./jellyfin.ts";
import { scheduleJellyfinRefresh } from "./jellyfin-refresh-queue.ts";
import { getAniListAnime, resolveSeriesRootTitle } from "./anilist.ts";
import { notifyDownloadComplete, notifyDownloadFailed } from "./notifications.ts";
import { hasOpenSubtitlesKey, fetchAndSaveSubtitle } from "./opensubtitles.ts";

// Providers que entregam conteúdo em inglês — legenda automática ativada para eles
const ENGLISH_PROVIDERS = new Set(["allanime", "nineanime", "nyaa"]);

// Erros que não devem gerar retry (problema permanente no provider/fonte)
const NO_RETRY_ERROR_CODES = new Set(["auth_error", "geo_blocked", "source_not_found"]);

function getFreeSpaceGb(path: string): number {
  try {
    if (process.platform === "win32") {
      const drive = path.match(/^([A-Za-z]:)/)?.[1] ?? "C:";
      const result = Bun.spawnSync([
        "wmic", "logicaldisk", "where", `deviceid='${drive}'`, "get", "freespace", "/value",
      ]);
      if (result.exitCode !== 0) return Infinity;
      const out = new TextDecoder().decode(result.stdout);
      const match = out.match(/FreeSpace=(\d+)/);
      if (!match) return Infinity;
      return Number(match[1]) / (1024 ** 3);
    }
    const result = Bun.spawnSync(["df", "-k", "--output=avail", path]);
    if (result.exitCode !== 0) return Infinity;
    const lines = new TextDecoder().decode(result.stdout).trim().split("\n");
    const kbFree = parseInt(lines[lines.length - 1]?.trim() ?? "0", 10);
    return kbFree / (1024 * 1024); // KB → GB
  } catch {
    return Infinity; // falha silenciosa — não bloqueia downloads
  }
}

export type DownloadStatus = "queued" | "downloading" | "retry_wait" | "completed" | "failed" | "cancelled";
const DOWNLOAD_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const BLOGGER_ORIGIN = "https://www.blogger.com";

export interface QueueJob {
  id: string;
  animeId: string;
  animeTitle: string;
  episodeNumber: number;
  season: number;
  status: DownloadStatus;
  progress: number;
  speedKbps: number;
  totalBytes: number;
  downloadedBytes: number;
  filePath: string;
  provider: string;
  quality: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMsg: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
}

type ActiveHandle = { type: "sim" | "real"; cancel: () => void };
type DownloadJobRow = {
  id: string;
  anime_id: string;
  episode_number: number;
  season: number;
  source_url: string | null;
  status: DownloadStatus;
  attempt_count: number;
  max_attempts: number;
};

function normalizeForCompare(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tokenizeForCompare(value: string): string[] {
  return [...new Set(normalizeForCompare(value).split("-").filter((token) => token.length > 1))];
}

function scoreTokenOverlap(query: string, ...candidateValues: string[]): number {
  const queryTokens = tokenizeForCompare(query);
  if (!queryTokens.length) return 0;

  const candidateTokens = new Set(candidateValues.flatMap((value) => tokenizeForCompare(value)));
  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }

  return overlap * 3;
}

function sanitizeSearchQuery(value: string): string {
  return value
    .replace(/\s+\d+(?:[.,]\d+)?\s+A\d+\b/gi, " ")
    .replace(/\(\s*dublado\s*\)/gi, " ")
    .replace(/[:'"`\u00B4\u2019]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQueryFromSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;

  try {
    const parsed = new URL(sourceUrl);
    const slug = parsed.pathname.match(/\/animes\/([^/]+)/i)?.[1] ?? "";
    if (!slug) return null;

    const normalized = slug
      .replace(/-todos-os-episodios$/i, "")
      .replace(/-\d+\/?$/i, "")
      .replace(/-dublado$/i, "")
      .replace(/-/g, " ")
      .trim();

    return normalized || null;
  } catch {
    return null;
  }
}

function buildSearchQueryCandidates(...values: Array<string | null | undefined>): string[] {
  const candidates: string[] = [];

  for (const value of values) {
    const raw = value?.trim();
    if (!raw) continue;

    const sanitized = sanitizeSearchQuery(raw);
    for (const candidate of [raw, sanitized]) {
      const normalized = candidate.trim();
      if (!normalized) continue;
      if (!candidates.includes(normalized)) candidates.push(normalized);
    }
  }

  return candidates;
}

function scoreAnimefireCandidate(url: string, title: string, query: string, season: number): number {
  const urlLower = url.toLowerCase();
  const titleNorm = normalizeForCompare(title);
  const querySlug = normalizeForCompare(query);
  let score = 0;

  if (querySlug && urlLower.includes(querySlug)) score += 4;
  if (querySlug && urlLower.includes(`${querySlug}-todos-os-episodios`)) score += 6;
  if (titleNorm && querySlug && titleNorm.includes(querySlug)) score += 2;
  score += scoreTokenOverlap(query, url, title);

  if (season <= 1 && /(2nd-season|season-2|segunda-temporada|temporada-2|2a-temporada|part-2)/i.test(urlLower)) {
    score -= 6;
  }

  if (/dublado/i.test(urlLower)) score -= 1;
  return score;
}

async function resolveAnimefireFallbackSource(animeId: string, episode: number, season: number): Promise<string | null> {
  const anime = db.query<{ title: string; title_english: string | null; source_url: string | null }, [string]>(
    `SELECT title, title_english, source_url FROM animes WHERE id = ?`
  ).get(animeId);
  if (!anime) return null;

  const legacyQueryCandidates = [anime.title, anime.title_english ?? ""]
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .map((q) => sanitizeSearchQuery(q));
  const queryCandidates = buildSearchQueryCandidates(
    extractQueryFromSourceUrl(anime.source_url),
    ...legacyQueryCandidates
  );

  for (const query of queryCandidates) {
    let hits: Awaited<ReturnType<typeof animefireSearch>> = [];
    try {
      hits = await animefireSearch(query);
    } catch {
      continue;
    }
    if (!hits.length) continue;

    const ranked = hits
      .map((hit) => ({
        ...hit,
        score: scoreAnimefireCandidate(hit.url, hit.title, query, season),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    for (const candidate of ranked) {
      try {
        const eps = await animefireEpisodes(candidate.url);
        const match = eps.find((ep) => ep.number === episode);
        if (match?.url) {
          return match.url;
        }
      } catch {
        // Try next candidate.
      }
    }
  }

  return null;
}

async function resolvePtBrFallbackSource(
  animeId: string,
  episode: number,
  _season: number,
  excludeSourceUrl: string | null
): Promise<string | null> {
  const anime = db.query<{ title: string; title_english: string | null; source_url: string | null }, [string]>(
    `SELECT title, title_english, source_url FROM animes WHERE id = ?`
  ).get(animeId);
  if (!anime) return null;

  const legacyQueryCandidates = [anime.title, anime.title_english ?? ""]
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .map((q) => sanitizeSearchQuery(q));
  const queryCandidates = buildSearchQueryCandidates(
    extractQueryFromSourceUrl(anime.source_url),
    ...legacyQueryCandidates
  );

  const excludeHost = (() => { try { return new URL(excludeSourceUrl ?? "").hostname.toLowerCase(); } catch { return ""; } })();

  // Try Goyabu (skip if that was the failing provider)
  if (!excludeHost.endsWith("goyabu.io")) {
    for (const query of queryCandidates) {
      try {
        const hits = await goyabuSearch(query);
        for (const hit of hits.slice(0, 4)) {
          try {
            const eps = await goyabuEpisodes(hit.url);
            const match = eps.find((ep) => ep.number === episode);
            if (match?.url) {
              logger.info("downloader", JSON.stringify({ event: "ptbr_fallback_resolved", provider: "goyabu", animeId, episode }));
              return match.url;
            }
          } catch { /* try next */ }
        }
      } catch { continue; }
    }
  }

  // Try AnimeDrive
  for (const query of queryCandidates) {
    try {
      const hits = await animeDriveSearch(query);
      for (const hit of hits.slice(0, 4)) {
        try {
          const eps = await animeDriveEpisodes(hit.url);
          const match = eps.find((ep) => ep.number === episode);
          if (match?.url) {
            const stream = await animeDriveStreamUrl(match.url);
            if (stream?.url && stream.type !== "iframe") {
              logger.info("downloader", JSON.stringify({ event: "ptbr_fallback_resolved", provider: "animedrive", animeId, episode }));
              return stream.url;
            }
          }
        } catch { /* try next */ }
      }
    } catch { continue; }
  }

  // Try Dattebayo
  for (const query of queryCandidates) {
    try {
      const hits = await dattebayoSearch(query);
      for (const hit of hits.slice(0, 4)) {
        try {
          const eps = await dattebayoEpisodes(hit.url);
          const match = eps.find((ep) => ep.number === episode);
          if (match?.url) {
            const stream = await dattebayoStreamUrl(match.url);
            if (stream?.url) {
              logger.info("downloader", JSON.stringify({ event: "ptbr_fallback_resolved", provider: "dattebayo", animeId, episode }));
              return stream.url;
            }
          }
        } catch { /* try next */ }
      }
    } catch { continue; }
  }

  return null;
}

function scoreAllAnimeCandidate(
  candidate: { name: string; englishName: string | null; episodeCount: number },
  query: string,
  season: number,
  episode: number,
  targetEpisodeCount: number
): number {
  const queryNorm = normalizeForCompare(query);
  const nameNorm = normalizeForCompare(candidate.name);
  const englishNorm = normalizeForCompare(candidate.englishName ?? "");
  const merged = `${candidate.name} ${candidate.englishName ?? ""}`.toLowerCase();

  let score = 0;

  if (queryNorm && nameNorm === queryNorm) score += 10;
  if (queryNorm && englishNorm === queryNorm) score += 12;
  if (queryNorm && nameNorm.includes(queryNorm)) score += 6;
  if (queryNorm && englishNorm.includes(queryNorm)) score += 7;
  if (queryNorm && queryNorm.includes(nameNorm)) score += 4;
  score += scoreTokenOverlap(query, candidate.name, candidate.englishName ?? "");

  if (candidate.episodeCount >= episode) score += 2;
  if (targetEpisodeCount > 0) {
    const diff = Math.abs(candidate.episodeCount - targetEpisodeCount);
    if (diff === 0) score += 8;
    else score -= Math.min(24, diff * 3);
  }

  if (/(\bmini\b|chibi|special)/i.test(merged)) score -= 8;

  if (season <= 1 && /(2nd|season\s*2|ni no shou|san no shou|3rd|season\s*3|part\s*2|part\s*3|\bs2\b|\bs3\b|\u222C)/i.test(merged)) {
    score -= 24;
  }

  if (/movie|filme|gekijouban/i.test(merged)) score -= 4;

  return score;
}

async function resolveAllAnimeFallbackSource(animeId: string, episode: number, season: number): Promise<string | null> {
  const anime = db.query<{ title: string; title_english: string | null; source_url: string | null; episode_count: number }, [string]>(
    `SELECT title, title_english, source_url, episode_count FROM animes WHERE id = ?`
  ).get(animeId);
  if (!anime) return null;

  const legacyQueryCandidates = [anime.title_english ?? "", anime.title]
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .map((q) => sanitizeSearchQuery(q));
  const queryCandidates = buildSearchQueryCandidates(
    extractQueryFromSourceUrl(anime.source_url),
    ...legacyQueryCandidates
  );

  for (const query of queryCandidates) {
    let hits: Awaited<ReturnType<typeof searchAllAnime>> = [];
    try {
      hits = await searchAllAnime(query, "sub");
    } catch {
      continue;
    }
    if (!hits.length) continue;

    const ranked = hits
      .map((hit) => ({
        ...hit,
        score: scoreAllAnimeCandidate(hit, query, season, episode, anime.episode_count ?? 0),
      }))
      .filter((hit) => hit.score >= 10)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    for (const candidate of ranked) {
      for (const mode of ["sub", "dub"] as const) {
        try {
          const stream = await getAllAnimeStreamUrl(candidate.id, episode, mode, "best");
          if (stream?.url && (await isPlayableStreamUrl(stream.url))) {
            logger.info(
              "downloader",
              JSON.stringify({
                event: "allanime_stream_resolved",
                animeId,
                episode,
                candidateId: candidate.id,
                candidateName: candidate.englishName ?? candidate.name,
                mode,
                quality: stream.quality,
              })
            );
            return stream.url;
          }
          if (stream?.url) {
            logger.warn(
              "downloader",
              JSON.stringify({
                event: "allanime_stream_rejected",
                animeId,
                episode,
                candidateId: candidate.id,
                candidateName: candidate.englishName ?? candidate.name,
                mode,
                reason: "stream_not_playable",
              })
            );
          }
        } catch {
          // Try next mode/candidate.
        }
      }
    }
  }

  return null;
}

const active = new Map<string, ActiveHandle>();
const scheduledStarts = new Map<string, ReturnType<typeof setTimeout>>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Tracks jobs that passed the guards in startDownload but haven't entered active yet
// (during the async setup window: ensureSeriesTitle + resolveDownloadSourceUrl)
const pendingStarts = new Set<string>();

function getConfig(key: string): string {
  const row = db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key);
  return row?.value ?? "";
}

function getConfigBool(key: string, fallback: boolean): boolean {
  const raw = getConfig(key);
  if (!raw) return fallback;
  return raw.toLowerCase() === "true";
}

function getConfigInt(key: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = parseInt(getConfig(key), 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

function getMaxConcurrentDownloads(): number {
  // Queue profile overrides config when active
  const profile = getActiveQueueProfile();
  if (profile) return Math.max(1, Math.min(20, profile.max_concurrent));
  return getConfigInt("max_concurrent", 3, 1, 10);
}

function isSimulationAllowed(): boolean {
  return getConfigBool("allow_simulated_downloads", false);
}

function isAutoRetryEnabled(): boolean {
  return getConfigBool("auto_retry_enabled", true);
}

function clearTimerMap(map: Map<string, ReturnType<typeof setTimeout>>, jobId: string) {
  const timer = map.get(jobId);
  if (!timer) return;
  clearTimeout(timer);
  map.delete(jobId);
}

function buildYtDlpFormatSelector(quality: string): string {
  const normalized = quality.trim().toLowerCase();
  const heightMatch = normalized.match(/(\d{3,4})p/);
  const height = heightMatch ? Number.parseInt(heightMatch[1], 10) : null;

  if (!height || !Number.isFinite(height)) {
    return "bestvideo+bestaudio/best";
  }

  return `bestvideo*[height<=${height}]+bestaudio/best*[height<=${height}]/best`;
}

function inferFragmentConcurrency(sourceUrl: string): number {
  const configOverride = getConfigInt("fragment_concurrency", 0, 0, 64);
  if (configOverride > 0) return configOverride;

  const lower = sourceUrl.toLowerCase();
  if (lower.includes(".m3u8")) return 16;
  if (lower.includes("googlevideo.com")) return 16;
  if (lower.endsWith(".mp4") || lower.includes(".mp4?")) return 6;
  return 2;
}

function shouldUseFfmpegLocation(ffmpegPath: string): boolean {
  const raw = ffmpegPath.trim();
  if (!raw) return false;

  const looksLikePath = raw.includes("/") || raw.includes("\\") || raw.includes(":");
  if (!looksLikePath) return false;
  return existsSync(raw);
}

// Cached probe — evita spawn repetido a cada download
let aria2cAvailableCache: boolean | null = null;

async function isAria2cAvailable(): Promise<boolean> {
  if (aria2cAvailableCache !== null) return aria2cAvailableCache;

  const useAria2cConfig = getConfig("use_aria2c").toLowerCase();
  if (useAria2cConfig === "false" || useAria2cConfig === "0") {
    aria2cAvailableCache = false;
    return false;
  }
  if (useAria2cConfig === "true" || useAria2cConfig === "1") {
    aria2cAvailableCache = true;
    return true;
  }

  // auto-detect: tenta executar aria2c --version
  const configured = getConfig("aria2c_path") || "aria2c";
  try {
    const probe = Bun.spawn([configured, "--version"], { stdout: "pipe", stderr: "pipe" });
    const code = await probe.exited;
    aria2cAvailableCache = code === 0;
  } catch {
    aria2cAvailableCache = false;
  }

  logger.info(
    "downloader",
    JSON.stringify({ event: "aria2c_probe", available: aria2cAvailableCache, path: configured })
  );
  return aria2cAvailableCache;
}

function isAnimefireEpisodePageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("animefire.io") && !host.endsWith("animefire.plus")) return false;
    return /\/animes\/[^/]+\/\d+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isLowQualityGoogleVideoUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("googlevideo.com")) return false;

    const mime = (parsed.searchParams.get("mime") ?? "").toLowerCase();
    const itag = parseInt(parsed.searchParams.get("itag") ?? "0", 10);

    if (mime.includes("video/3gpp")) return true;
    if ([13, 17, 18, 36].includes(itag)) return true;
    return false;
  } catch {
    return false;
  }
}

function shouldPreferPtBrFallback(sourceUrl: string | null, effectiveSourceUrl: string | null): string | null {
  if (!effectiveSourceUrl) return null;

  if (isAnimefireEpisodePageUrl(effectiveSourceUrl)) {
    return "animefire_page_unresolved";
  }

  return null;
}

function kickQueue(delayMs = 100) {
  if (active.size >= getMaxConcurrentDownloads()) return;

  const available = Math.max(0, getMaxConcurrentDownloads() - active.size);
  if (available === 0) return;

  const rows = db.query<{
    id: string;
    anime_id: string;
    episode_number: number;
    season: number;
    source_url: string | null;
  }, [number]>(
    `SELECT id, anime_id, episode_number, season, source_url
     FROM downloads
     WHERE status = 'queued'
     ORDER BY rowid ASC
     LIMIT ?`
  ).all(available * 3);

  let scheduled = 0;
  for (const row of rows) {
    if (scheduled >= available) break;
    if (active.has(row.id) || scheduledStarts.has(row.id) || retryTimers.has(row.id) || pendingStarts.has(row.id)) continue;

    scheduleStart(row.id, row.anime_id, row.episode_number, row.season, row.source_url, delayMs + scheduled * 75);
    scheduled += 1;
  }
}

function updateAnimeDownloadState(animeId: string) {
  const episodeAgg = db.query<{
    downloaded: number;
    missing: number;
  }, [string]>(
    `SELECT
      SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) as downloaded,
      SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) as missing
     FROM episodes
     WHERE anime_id = ?`
  ).get(animeId);

  const activeAgg = db.query<{ count: number }, [string]>(
    `SELECT COUNT(*) as count
     FROM downloads
     WHERE anime_id = ? AND status IN ('queued','downloading','retry_wait')`
  ).get(animeId);

  const animeInfo = db.query<{ episode_count: number }, [string]>(
    `SELECT episode_count FROM animes WHERE id = ?`
  ).get(animeId);

  if (!animeInfo) return;

  const downloaded = Number(episodeAgg?.downloaded ?? 0);
  const missing = Number(episodeAgg?.missing ?? 0);
  const activeJobs = Number(activeAgg?.count ?? 0);
  const total = Number(animeInfo.episode_count ?? 0);

  let status = "Missing";
  if (activeJobs > 0) status = "Downloading";
  else if (total > 0 && downloaded >= total) status = "Downloaded";
  else if (missing === 0 && downloaded > 0) status = "Downloaded";

  db.run(
    `UPDATE animes
     SET downloaded_count = ?, download_status = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [downloaded, status, animeId]
  );
}

function parseSizeToBytes(value: number, unit: string): number {
  const normalized = unit.toUpperCase();
  const base = normalized.endsWith("IB") ? 1024 : 1000;
  const symbol = normalized[0];
  if (symbol === "K") return Math.round(value * base);
  if (symbol === "M") return Math.round(value * base * base);
  if (symbol === "G") return Math.round(value * base * base * base);
  return Math.round(value);
}

function shouldTryAllAnimeRecovery(sourceUrl: string, errText: string): boolean {
  const err = errText.toLowerCase();
  const isExpiredStream = err.includes("http error 404") || err.includes("forbidden");
  if (!isExpiredStream) return false;

  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.endsWith("wixmp.com") || host.endsWith("wixstatic.com");
  } catch {
    return false;
  }
}

function isPtBrSourceUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith("animefire.io") ||
      host.endsWith("animefire.plus") ||
      host.endsWith("goyabu.io") ||
      host.endsWith("blogger.com")
    );
  } catch {
    return false;
  }
}

async function isPlayableStreamUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": DOWNLOAD_UA,
        Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,video/*,*/*",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return false;

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/plain")) {
      const sample = (await response.text()).slice(0, 200).toLowerCase();
      return sample.includes("#extm3u");
    }

    return true;
  } catch {
    return false;
  }
}

function findActualOutputFile(outputTemplate: string): string | null {
  const base = outputTemplate.replace(/\.%\(ext\)s$/, "");
  for (const ext of ["mkv", "mp4", "ts", "webm", "m4v"]) {
    const candidate = `${base}.${ext}`;
    try {
      if (statSync(candidate).size > 0) return candidate;
    } catch {
      // not found
    }
  }
  return null;
}

function isExpiredStreamFailure(sourceUrl: string, errText: string): boolean {
  const err = errText.toLowerCase();
  if (!err.includes("http error 404") && !err.includes("forbidden")) return false;

  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.endsWith("wixmp.com") || host.endsWith("wixstatic.com");
  } catch {
    return false;
  }
}

async function tryRecoverFromBloggerFailure(
  jobId: string,
  animeId: string,
  episode: number,
  season: number,
  sourceUrl: string,
  errText: string
): Promise<boolean> {
  const err = errText.toLowerCase();
  const isBloggerExtractorFailure = err.includes("blogger.com") && err.includes("unable to extract json data");

  // For PT-BR sources (AnimeFire, Goyabu, Blogger): try other PT-BR providers, never AllAnime
  if (isBloggerExtractorFailure || isPtBrSourceUrl(sourceUrl)) {
    if (!isBloggerExtractorFailure && !err.includes("http error 404") && !err.includes("forbidden")) {
      return false;
    }
    const fallbackSource = await resolvePtBrFallbackSource(animeId, episode, season, sourceUrl);
    if (!fallbackSource || fallbackSource === sourceUrl) return false;

    db.run(
      `UPDATE downloads
       SET status = 'queued',
           provider = 'ptbr_fallback',
           source_url = ?,
           progress = 0,
           speed_kbps = 0,
           total_bytes = 0,
           downloaded_bytes = 0,
           error_msg = NULL,
           last_error_code = NULL,
           next_retry_at = NULL
       WHERE id = ?`,
      [fallbackSource, jobId]
    );
    db.run(
      `UPDATE episodes
       SET status = 'queued', download_id = NULL
       WHERE anime_id = ? AND number = ? AND season = ?`,
      [animeId, episode, season]
    );
    updateAnimeDownloadState(animeId);
    logger.warn(
      "downloader",
      JSON.stringify({
        event: "provider_recovery_scheduled",
        jobId,
        animeId,
        episode,
        from: sourceUrl,
        to: fallbackSource,
        provider: "ptbr_fallback",
        reason: isBloggerExtractorFailure ? "blogger_json_extract_failed" : "ptbr_source_expired",
      })
    );
    scheduleStart(jobId, animeId, episode, season, fallbackSource, 200);
    return true;
  }

  // For expired AllAnime streams (wixmp/wixstatic): refresh via AllAnime
  if (!shouldTryAllAnimeRecovery(sourceUrl, errText)) return false;

  const fallbackSource = await resolveAllAnimeFallbackSource(animeId, episode, season);
  if (!fallbackSource || fallbackSource === sourceUrl) return false;

  db.run(
    `UPDATE downloads
     SET status = 'queued',
         provider = 'allanime',
         source_url = ?,
         progress = 0,
         speed_kbps = 0,
         total_bytes = 0,
         downloaded_bytes = 0,
         error_msg = NULL,
         last_error_code = NULL,
         next_retry_at = NULL
     WHERE id = ?`,
    [fallbackSource, jobId]
  );
  db.run(
    `UPDATE episodes
     SET status = 'queued', download_id = NULL
     WHERE anime_id = ? AND number = ? AND season = ?`,
    [animeId, episode, season]
  );
  updateAnimeDownloadState(animeId);
  logger.warn(
    "downloader",
    JSON.stringify({
      event: "provider_recovery_scheduled",
      jobId,
      animeId,
      episode,
      from: sourceUrl,
      to: fallbackSource,
      provider: "allanime",
      reason: "allanime_stream_expired",
    })
  );
  scheduleStart(jobId, animeId, episode, season, fallbackSource, 200);
  return true;
}

function getJobRow(jobId: string): DownloadJobRow | null {
  return db.query<DownloadJobRow, [string]>(
    `SELECT id, anime_id, episode_number, season, source_url, status, attempt_count, max_attempts
     FROM downloads
     WHERE id = ?`
  ).get(jobId) ?? null;
}

function finalizeFailure(jobId: string, animeId: string, episode: number, season: number, reason: string, errorCode: string) {
  db.run(
    `UPDATE downloads
     SET status = 'failed',
         error_msg = ?,
         last_error_code = ?,
         next_retry_at = NULL,
         speed_kbps = 0,
         completed_at = datetime('now')
     WHERE id = ?`,
    [reason.slice(0, 500), errorCode.slice(0, 120), jobId]
  );
  db.run(
    `UPDATE episodes
     SET status = 'missing', download_id = NULL
     WHERE anime_id = ? AND number = ? AND season = ?`,
    [animeId, episode, season]
  );
  updateAnimeDownloadState(animeId);
  logger.warn("downloader", JSON.stringify({ event: "failed", jobId, animeId, episode, season, errorCode }));

  const failedTitle = db.query<{ title: string }, [string]>(
    `SELECT title FROM animes WHERE id = ?`
  ).get(animeId);
  void notifyDownloadFailed(failedTitle?.title ?? animeId, episode, season, errorCode);

  kickQueue(150);
}

function scheduleAutoRetry(jobId: string, reason: string, errorCode: string): boolean {
  if (!isAutoRetryEnabled()) return false;
  // Erros permanentes não devem gerar retry — falham imediatamente
  if (NO_RETRY_ERROR_CODES.has(errorCode)) return false;

  const job = getJobRow(jobId);
  if (!job) return false;
  if (job.status === "cancelled") return false;

  // Guard against duplicate retries caused by the double-start race condition
  if (retryTimers.has(jobId)) return true;

  const configuredMaxAttempts = getConfigInt("retry_max_attempts", 3, 0, 20);
  const configuredBaseDelay = getConfigInt("retry_base_delay_seconds", 20, 1, 3600);
  const configuredMaxDelay = getConfigInt("retry_max_delay_seconds", 900, 1, 24 * 3600);

  const maxAttempts = Math.max(job.max_attempts || 0, configuredMaxAttempts);
  const nextAttempt = (job.attempt_count || 0) + 1;
  if (nextAttempt > maxAttempts) return false;

  const delaySeconds = Math.min(configuredBaseDelay * 2 ** Math.max(0, nextAttempt - 1), configuredMaxDelay);

  db.run(
    `UPDATE downloads
     SET status = 'retry_wait',
         attempt_count = ?,
         max_attempts = ?,
         next_retry_at = datetime('now', ?),
         error_msg = ?,
         last_error_code = ?,
         speed_kbps = 0,
         progress = 0,
         downloaded_bytes = 0
     WHERE id = ?`,
    [nextAttempt, maxAttempts, `+${delaySeconds} seconds`, reason.slice(0, 500), errorCode.slice(0, 120), jobId]
  );

  db.run(
    `UPDATE episodes
     SET status = 'queued', download_id = NULL
     WHERE anime_id = ? AND number = ? AND season = ?`,
    [job.anime_id, job.episode_number, job.season]
  );
  updateAnimeDownloadState(job.anime_id);

  clearTimerMap(retryTimers, jobId);
  const timer = setTimeout(() => {
    retryTimers.delete(jobId);
    const latest = getJobRow(jobId);
    if (!latest || latest.status !== "retry_wait") return;

    db.run(`UPDATE downloads SET status = 'queued', next_retry_at = NULL WHERE id = ?`, [jobId]);
    scheduleStart(jobId, latest.anime_id, latest.episode_number, latest.season, latest.source_url, 100);
  }, delaySeconds * 1000);

  retryTimers.set(jobId, timer);
  logger.warn(
    "downloader",
    JSON.stringify({ event: "retry_scheduled", jobId, animeId: job.anime_id, episode: job.episode_number, attempt: nextAttempt, delaySeconds, errorCode })
  );
  return true;
}

function handleJobFailure(jobId: string, animeId: string, episode: number, season: number, reason: string, errorCode: string) {
  clearTimerMap(scheduledStarts, jobId);
  const scheduled = scheduleAutoRetry(jobId, reason, errorCode);
  if (!scheduled) {
    finalizeFailure(jobId, animeId, episode, season, reason, errorCode);
    return;
  }

  kickQueue(100);
}

function completeJob(jobId: string, animeId: string, episode: number, season: number, filePath: string, totalBytes: number) {
  db.run(
    `UPDATE downloads
     SET status = 'completed',
         progress = 100,
         speed_kbps = 0,
         downloaded_bytes = ?,
         total_bytes = ?,
         next_retry_at = NULL,
         error_msg = NULL,
         last_error_code = NULL,
         completed_at = datetime('now')
     WHERE id = ?`,
    [totalBytes, totalBytes, jobId]
  );

  db.run(
    `UPDATE episodes
     SET status = 'downloaded', file_path = ?, file_size_mb = ?, download_id = ?
     WHERE anime_id = ? AND number = ? AND season = ?`,
    [filePath, Math.round(totalBytes / 1024 / 1024), jobId, animeId, episode, season]
  );

  db.run(`UPDATE animes SET last_download = datetime('now') WHERE id = ?`, [animeId]);
  updateAnimeDownloadState(animeId);

  logger.info("downloader", JSON.stringify({ event: "completed", jobId, animeId, episode, season, bytes: totalBytes }));

  // Gera NFO Jellyfin de forma assíncrona (não bloqueia)
  void generateSingleEpisodeNfoAsync(animeId, episode, season, filePath);
  // Enfileira refresh do Jellyfin se auto refresh estiver habilitado
  scheduleJellyfinRefresh(animeId, filePath);

  // Notificação webhook
  const jobRow = db.query<{ provider: string; anime_id: string }, [string]>(
    `SELECT provider, anime_id FROM downloads WHERE id = ?`
  ).get(jobId);
  const animeTitle = db.query<{ title: string; title_english: string | null }, [string]>(
    `SELECT title, title_english FROM animes WHERE id = ?`
  ).get(animeId);
  void notifyDownloadComplete(animeTitle?.title ?? animeId, episode, season);

  // Auto-legenda para providers em inglês
  if (
    jobRow && ENGLISH_PROVIDERS.has(jobRow.provider) &&
    getConfig("auto_subtitle_enabled") === "true" &&
    hasOpenSubtitlesKey()
  ) {
    const query = animeTitle?.title_english ?? animeTitle?.title ?? "";
    if (query) {
      void fetchAndSaveSubtitle({ query, season, episode, videoFilePath: filePath })
        .then((path) => {
          if (path) logger.info("downloader", `auto-subtitle saved: ${path}`);
        })
        .catch((e) => logger.warn("downloader", `auto-subtitle failed: ${e}`));
    }
  }

  kickQueue(100);
}

function simulateDownload(jobId: string, animeId: string, episode: number, season: number) {
  const anime = db.query<{
    title: string;
    title_english: string | null;
    title_romaji: string | null;
    year: number | null;
    series_title: string | null;
    subtype: string | null;
  }, [string]>(
    `SELECT title, title_english, title_romaji, year, series_title, subtype FROM animes WHERE id = ?`
  ).get(animeId);
  if (!anime) return;

  const basePath = getConfig("media_path") || getConfig("download_path") || `${process.env.USERPROFILE ?? "~"}/Anime`;
  const scheme = (getConfig("naming_scheme") || "jellyfin") as "jellyfin" | "plex" | "simple";
  // series_title tem o nome base da série (sem sufixo de temporada), resolvido via AniList
  const title = anime.series_title || anime.title_romaji || anime.title_english || anime.title;
  const seasonPart = inferSeasonInfo(anime.title, anime.title_english, anime.title_romaji).seasonPart;
  const filePath = buildPath(scheme, basePath, title, anime.year, season, episode, null, "mkv", seasonPart, anime.subtype);

  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // noop
  }

  const totalBytes = Math.round((Math.random() * 500 + 300) * 1024 * 1024);
  let downloaded = 0;

  db.run(
    `UPDATE downloads
     SET status = 'downloading',
         started_at = COALESCE(started_at, datetime('now')),
         file_path = ?,
         total_bytes = ?,
         next_retry_at = NULL
     WHERE id = ?`,
    [filePath, totalBytes, jobId]
  );
  db.run(
    `UPDATE episodes
     SET status = 'downloading', download_id = ?
     WHERE anime_id = ? AND number = ? AND season = ?`,
    [jobId, animeId, episode, season]
  );
  updateAnimeDownloadState(animeId);

  const timer = setInterval(() => {
    const chunk = Math.round((Math.random() * 5 + 2) * 1024 * 1024);
    downloaded = Math.min(downloaded + chunk, totalBytes);
    const progress = Math.round((downloaded / totalBytes) * 100);
    const speedKbps = Math.round(chunk / 1024);

    if (downloaded >= totalBytes) {
      clearInterval(timer);
      active.delete(jobId);
      completeJob(jobId, animeId, episode, season, filePath, totalBytes);
      return;
    }

    db.run(
      `UPDATE downloads
       SET progress = ?, speed_kbps = ?, downloaded_bytes = ?, total_bytes = ?
       WHERE id = ?`,
      [progress, speedKbps, downloaded, totalBytes, jobId]
    );
  }, 1000);

  active.set(jobId, { type: "sim", cancel: () => clearInterval(timer) });
}

async function realDownload(
  jobId: string,
  animeId: string,
  episode: number,
  season: number,
  sourceUrl: string,
  referer: string | null
) {
  const ytdlp = getConfig("yt_dlp_path") || "yt-dlp";
  const ffmpegPath = getConfig("ffmpeg_path");
  const basePath = getConfig("media_path") || getConfig("download_path") || `${process.env.USERPROFILE ?? "~"}/Anime`;
  const scheme = (getConfig("naming_scheme") || "jellyfin") as "jellyfin" | "plex" | "simple";
  const quality = getConfig("quality") || "1080p";
  const formatSelector = buildYtDlpFormatSelector(quality);
  const fragmentConcurrency = inferFragmentConcurrency(sourceUrl);

  const anime = db.query<{
    title: string;
    title_english: string | null;
    title_romaji: string | null;
    year: number | null;
    series_title: string | null;
    subtype: string | null;
  }, [string]>(
    `SELECT title, title_english, title_romaji, year, series_title, subtype FROM animes WHERE id = ?`
  ).get(animeId);
  if (!anime) return;

  // series_title tem o nome base da série (sem sufixo de temporada), resolvido via AniList
  const title = anime.series_title || anime.title_romaji || anime.title_english || anime.title;
  const seasonPart = inferSeasonInfo(anime.title, anime.title_english, anime.title_romaji).seasonPart;
  const filePath = buildPath(scheme, basePath, title, anime.year, season, episode, null, "mkv", seasonPart, anime.subtype);

  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // noop
  }

  // %(ext)s evita que yt-dlp injete IDs de formato (ex: "8.13 A14") no nome
  // quando baixa bestvideo+bestaudio em streams separados antes de mesclar
  const outputTemplate = filePath.replace(/\.[^.]+$/, ".%(ext)s");

  const args = [
    ytdlp,
    sourceUrl,
    "-o",
    outputTemplate,
    "--no-playlist",
    "--progress",
    "--newline",
    "-f",
    formatSelector,
    "--merge-output-format",
    "mkv",
    "--embed-metadata",
    "--force-overwrites",
    "--user-agent",
    DOWNLOAD_UA,
  ];

  if (shouldUseFfmpegLocation(ffmpegPath)) {
    args.push("--ffmpeg-location", ffmpegPath);
  }

  if (fragmentConcurrency > 1) {
    args.push("-N", String(fragmentConcurrency));
  }

  // yt-dlp retry flags — previne falhas intermitentes em fragmentos HLS
  const ytdlpRetries = getConfigInt("yt_dlp_retries", 5, 1, 20);
  const ytdlpFragmentRetries = getConfigInt("yt_dlp_fragment_retries", 10, 1, 50);
  args.push("--retries", String(ytdlpRetries));
  args.push("--fragment-retries", String(ytdlpFragmentRetries));

  const isGoogleVideo = sourceUrl.toLowerCase().includes("googlevideo.com");
  const isHls = sourceUrl.toLowerCase().includes(".m3u8");
  const aria2cPath = getConfig("aria2c_path") || "aria2c";
  const useAria2c = (isGoogleVideo || isHls) && (await isAria2cAvailable());

  if (useAria2c) {
    // aria2c com 16 conexões paralelas — ideal para MP4 direto e HLS do googlevideo
    args.push("--downloader", aria2cPath);
    args.push("--downloader-args", "aria2c:-x 16 -k 1M --max-connection-per-server=16 --min-split-size=1M");
  } else if (isHls) {
    // Fallback: ffmpeg para streams HLS quando aria2c não disponível
    args.push("--downloader", "ffmpeg");
    args.push("--hls-use-mpegts");
  }

  // Referer: usar referer explícito, ou Blogger origin para googlevideo como fallback
  const effectiveReferer = referer ?? (isGoogleVideo ? BLOGGER_ORIGIN : null);
  if (effectiveReferer) {
    args.push("--referer", effectiveReferer);
    try {
      const origin = new URL(effectiveReferer).origin;
      args.push("--add-header", `Origin:${origin}`);
    } catch {
      // invalid referer, ignore
    }
  }

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });

  active.set(jobId, {
    type: "real",
    cancel: () => {
      try {
        if (process.platform === "win32") {
          Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(proc.pid)]);
        } else {
          proc.kill();
        }
      } catch {
        // noop
      }
    },
  });

  db.run(
    `UPDATE downloads
     SET status = 'downloading',
         started_at = COALESCE(started_at, datetime('now')),
         file_path = ?,
         next_retry_at = NULL
     WHERE id = ?`,
    [filePath, jobId]
  );
  db.run(
    `UPDATE episodes
     SET status = 'downloading', download_id = ?
     WHERE anime_id = ? AND number = ? AND season = ?`,
    [jobId, animeId, episode, season]
  );
  updateAnimeDownloadState(animeId);

  let lastProgress = 0;
  let totalBytes = 0;
  let downloadedBytes = 0;
  let speedKbps = 0;

  // Lemos stdout E stderr em paralelo: yt-dlp escreve progresso no stderr,
  // mas o aria2c (external downloader) pode escrever no stdout do yt-dlp.
  const allOutputLines: string[] = [];

  const processLine = (line: string) => {
    // Formato yt-dlp nativo: [download]  42.3% of 234.00MiB at 5.12MiB/s ETA 00:44
    // Formato aria2c (downloader externo): [#abc123 10MiB/234MiB(4%) CN:16 DL:5.24MiB/s ETA:44s]
    // Formato fragmentos HLS: [download] Downloading fragment 5 of 240

    const fragmentMatch = line.match(/Downloading fragment (\d+) of (\d+)/i);
    if (fragmentMatch) {
      const current = parseInt(fragmentMatch[1], 10);
      const total = parseInt(fragmentMatch[2], 10);
      if (total > 0) lastProgress = Math.round((current / total) * 100);
    }

    const progressMatch = line.match(/(\d+\.?\d*)%/);
    if (progressMatch) {
      lastProgress = Math.round(parseFloat(progressMatch[1]));
    }

    // yt-dlp nativo: "of 234.00MiB"
    const totalMatchNative = line.match(/of\s+~?\s*(\d+\.?\d*)\s*([KMG]i?B)/i);
    if (totalMatchNative) {
      totalBytes = parseSizeToBytes(parseFloat(totalMatchNative[1]), totalMatchNative[2]);
    }

    // aria2c: "10MiB/234MiB" — extrai o denominador
    if (!totalMatchNative) {
      const totalMatchAria2c = line.match(/[\d.]+[KMG]i?B\/([\d.]+)([KMG]i?B)/i);
      if (totalMatchAria2c) {
        totalBytes = parseSizeToBytes(parseFloat(totalMatchAria2c[1]), totalMatchAria2c[2]);
      }
    }

    // yt-dlp nativo: "at 5.12MiB/s" | aria2c: "DL:5.24MiB/s"
    const speedMatch = line.match(/(?:at|DL:)\s*([\d.]+)\s*([KMG]i?B)\/s/i);
    if (speedMatch) {
      speedKbps = Math.round(parseSizeToBytes(parseFloat(speedMatch[1]), speedMatch[2]) / 1024);
    }

    if (totalBytes > 0) {
      downloadedBytes = Math.round((lastProgress / 100) * totalBytes);
    }

    db.run(
      `UPDATE downloads
       SET progress = ?, speed_kbps = ?, downloaded_bytes = ?, total_bytes = ?
       WHERE id = ?`,
      [lastProgress, speedKbps, downloadedBytes, totalBytes, jobId]
    );
  };

  const drainStream = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let carry = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      const lines = carry.split(/\r\n|\r|\n/);
      carry = lines.pop() ?? "";
      for (const line of lines) {
        allOutputLines.push(line);
        if (line.includes("[download]") || line.includes("[#") || (line.includes("%") && line.includes("/"))) {
          processLine(line);
        }
      }
    }
    if (carry) {
      allOutputLines.push(carry);
      if (carry.includes("[download]") || carry.includes("[#") || (carry.includes("%") && carry.includes("/"))) {
        processLine(carry);
      }
    }
  };

  await Promise.all([drainStream(proc.stderr), drainStream(proc.stdout)]);

  const code = await proc.exited;
  active.delete(jobId);

  if (code === 0) {
    // yt-dlp pode salvar com extensão diferente de .mkv (.mp4, .ts, etc.)
    const actualFilePath = findActualOutputFile(outputTemplate);
    if (!actualFilePath) {
      handleJobFailure(
        jobId, animeId, episode, season,
        "Arquivo de vídeo não encontrado após download (yt-dlp retornou exit 0 sem arquivo válido no disco).",
        "file_not_found"
      );
      return;
    }

    let diskSize = 0;
    try {
      diskSize = statSync(actualFilePath).size;
    } catch {
      diskSize = 0;
    }

    if (diskSize > 0 && diskSize < 1024 * 1024) {
      try {
        const sample = readFileSync(actualFilePath, "utf8").slice(0, 1200).toLowerCase();
        const looksJson = sample.trimStart().startsWith("{") && sample.includes("\"data\"");
        const looksHtml = sample.includes("<html") || sample.includes("<!doctype html");
        if (looksJson || looksHtml) {
          handleJobFailure(
            jobId,
            animeId,
            episode,
            season,
            "Arquivo inválido retornado como texto/JSON pelo provider (provável bloqueio/URL temporária expirada).",
            "invalid_media_payload"
          );
          return;
        }
      } catch {
        // Binary/locked read; continue with size-based validation only.
      }
    }

    const finalBytes = Math.max(totalBytes > 0 ? totalBytes : downloadedBytes, diskSize);
    completeJob(jobId, animeId, episode, season, actualFilePath, finalBytes);
    return;
  }

  const latest = db.query<{ status: DownloadStatus }, [string]>(`SELECT status FROM downloads WHERE id = ?`).get(jobId);
  if (latest?.status === "cancelled") {
    logger.info("downloader", JSON.stringify({ event: "cancelled", jobId, animeId, episode, season }));
    return;
  }

  const errText = allOutputLines.join("\n");
  const recovered = await tryRecoverFromBloggerFailure(jobId, animeId, episode, season, sourceUrl, errText);
  if (recovered) return;

  if (isExpiredStreamFailure(sourceUrl, errText)) {
    finalizeFailure(
      jobId,
      animeId,
      episode,
      season,
      "Fonte AllAnime/Wix indisponivel no momento (404/Forbidden). Tente outro provider ou reprocessar mais tarde.",
      "source_unavailable"
    );
    return;
  }

  if (errText) {
    logger.warn(
      "downloader",
      JSON.stringify({ event: "yt_dlp_stderr", jobId, episode, stderr: errText.slice(0, 400) })
    );
  }

  handleJobFailure(
    jobId,
    animeId,
    episode,
    season,
    errText.slice(0, 500) || "yt-dlp retornou erro",
    "yt_dlp_exit"
  );
}

/**
 * Garante que series_title está populado antes de construir o caminho de download.
 * Usa AniList (via relações PREQUEL) para obter o título raiz da série.
 * Se não tiver anilist_id, aplica stripSeasonSuffix como fallback.
 * Resultado é persistido no banco para chamadas subsequentes.
 */
async function ensureSeriesTitle(animeId: string): Promise<void> {
  const anime = db.query<{
    series_title: string | null;
    anilist_id: number | null;
    title: string;
    title_english: string | null;
  }, [string]>(
    `SELECT series_title, anilist_id, title, title_english FROM animes WHERE id = ?`
  ).get(animeId);

  if (!anime || anime.series_title) return;

  let resolved: string | null = null;

  if (anime.anilist_id) {
    try {
      const anilistData = await getAniListAnime(anime.anilist_id);
      if (anilistData) {
        resolved = resolveSeriesRootTitle(anilistData, anime.title);
        logger.info("downloader", JSON.stringify({ event: "series_title_resolved_anilist", animeId, resolved }));
      }
    } catch (err) {
      logger.warn("downloader", `ensureSeriesTitle AniList failed for ${animeId}: ${err}`);
    }
  }

  if (!resolved) {
    resolved = stripSeasonSuffix(anime.title);
    logger.info("downloader", JSON.stringify({ event: "series_title_resolved_fallback", animeId, resolved }));
  }

  if (resolved) {
    db.run(`UPDATE animes SET series_title = ? WHERE id = ?`, [resolved, animeId]);
  }
}

async function startDownload(jobId: string, animeId: string, episode: number, season: number, sourceUrl: string | null) {
  clearTimerMap(scheduledStarts, jobId);

  const current = db.query<{ status: DownloadStatus }, [string]>(`SELECT status FROM downloads WHERE id = ?`).get(jobId);
  if (!current || (current.status !== "queued" && current.status !== "retry_wait")) {
    return;
  }

  if (current.status === "queued" && active.size >= getMaxConcurrentDownloads()) {
    scheduleStart(jobId, animeId, episode, season, sourceUrl, 500);
    return;
  }

  // Guard against the double-start race: between scheduledStarts timer firing and
  // active.set() being called in realDownload, kickQueue can re-schedule this job.
  if (pendingStarts.has(jobId)) return;
  pendingStarts.add(jobId);

  // Resolve series_title antes de construir o caminho — garante pasta correta da série
  await ensureSeriesTitle(animeId);

  let effectiveSourceUrl = sourceUrl;
  let downloadReferer: string | null = null;

  if (effectiveSourceUrl) {
    try {
      const beforeResolve = effectiveSourceUrl;
      const resolved = await resolveDownloadSourceUrl(effectiveSourceUrl);
      if (resolved && resolved !== effectiveSourceUrl) {
        logger.info(
          "downloader",
          JSON.stringify({
            event: "source_resolved",
            jobId,
            animeId,
            episode,
            from: effectiveSourceUrl,
            to: resolved,
          })
        );
        effectiveSourceUrl = resolved;
        try {
          const host = new URL(beforeResolve).hostname.toLowerCase();
          if (host.endsWith("animefire.io") || host.endsWith("animefire.plus")) {
            downloadReferer = beforeResolve;
          }
        } catch {
          // ignore
        }
        // Não persiste a URL resolvida — mantém a URL original da página no DB
        // para que retries possam re-resolver e obter uma URL de CDN fresca
      }
    } catch (err) {
      logger.warn(
        "downloader",
        JSON.stringify({
          event: "source_resolve_failed",
          jobId,
          animeId,
          episode,
          error: String(err),
        })
      );
    }
  }

  if (sourceUrl && effectiveSourceUrl) {
    try {
      const sourceHost = new URL(sourceUrl).hostname.toLowerCase();
      const effectiveHost = new URL(effectiveSourceUrl).hostname.toLowerCase();

      if (sourceHost.endsWith("goyabu.io")) {
        const shouldTryAnimefire =
          effectiveHost.endsWith("goyabu.io") ||
          effectiveHost.endsWith("blogger.com");

        if (shouldTryAnimefire) {
          const animefireFallback = await resolveAnimefireFallbackSource(animeId, episode, season);
          if (animefireFallback && animefireFallback !== effectiveSourceUrl) {
            let fallbackResolved = animefireFallback;
            try {
              const resolved = await resolveDownloadSourceUrl(animefireFallback);
              if (resolved) fallbackResolved = resolved;
            } catch {
              // keep plain fallback URL
            }

            downloadReferer = animefireFallback;

            logger.info(
              "downloader",
              JSON.stringify({
                event: "provider_fallback_source",
                jobId,
                animeId,
                episode,
                from: effectiveSourceUrl,
                to: fallbackResolved,
                provider: "animefire",
              })
            );

            effectiveSourceUrl = fallbackResolved;
            db.run(`UPDATE downloads SET source_url = ?, provider = ? WHERE id = ?`, [animefireFallback, "animefire", jobId]);
          }
        }
      }
    } catch {
      // keep original source resolution result
    }
  }

  const ptBrFallbackReason = shouldPreferPtBrFallback(sourceUrl, effectiveSourceUrl);
  if (effectiveSourceUrl && ptBrFallbackReason) {
    const ptBrFallback = await resolvePtBrFallbackSource(animeId, episode, season, sourceUrl);
    if (ptBrFallback && ptBrFallback !== effectiveSourceUrl) {
      logger.warn(
        "downloader",
        JSON.stringify({
          event: "provider_fallback_source",
          jobId,
          animeId,
          episode,
          from: effectiveSourceUrl,
          to: ptBrFallback,
          provider: "ptbr_fallback",
          reason: ptBrFallbackReason,
        })
      );
      effectiveSourceUrl = ptBrFallback;
      downloadReferer = null;
      db.run(`UPDATE downloads SET source_url = ?, provider = ? WHERE id = ?`, [ptBrFallback, "ptbr_fallback", jobId]);
    }
  }

  // Remove from pendingStarts before handing off to the actual download functions,
  // which manage the active map themselves.
  pendingStarts.delete(jobId);

  if (!effectiveSourceUrl) {
    if (isSimulationAllowed()) {
      simulateDownload(jobId, animeId, episode, season);
      return;
    }
    handleJobFailure(
      jobId,
      animeId,
      episode,
      season,
      "Sem source_url para download real. Ative allow_simulated_downloads=true para modo simulado.",
      "missing_source_url"
    );
    return;
  }

  realDownload(jobId, animeId, episode, season, effectiveSourceUrl, downloadReferer).catch((err) => {
    if (isSimulationAllowed()) {
      logger.warn("downloader", JSON.stringify({ event: "real_fallback_sim", jobId, animeId, episode, error: String(err) }));
      simulateDownload(jobId, animeId, episode, season);
      return;
    }

    handleJobFailure(jobId, animeId, episode, season, `yt-dlp falhou: ${String(err)}`, "spawn_error");
  });
}

function scheduleStart(
  jobId: string,
  animeId: string,
  episode: number,
  season: number,
  sourceUrl: string | null,
  delayMs: number
) {
  clearTimerMap(scheduledStarts, jobId);
  const timer = setTimeout(() => {
    scheduledStarts.delete(jobId);
    void startDownload(jobId, animeId, episode, season, sourceUrl);
  }, Math.max(0, delayMs));
  scheduledStarts.set(jobId, timer);
}

function parseEpisodeCandidate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 5000) return null;
  return parsed;
}

function inferEpisodeFromSourceUrl(sourceUrl?: string | null): number | null {
  if (!sourceUrl) return null;
  const raw = sourceUrl.trim();
  if (!raw) return null;

  const asSimpleNumber = parseEpisodeCandidate(raw);
  if (asSimpleNumber != null && /^\d{1,4}$/.test(raw)) {
    return asSimpleNumber;
  }

  const fromRawToken = raw.match(/(?:episodio|episode|ep)[^0-9]{0,4}(\d{1,4})(?:\b|$)/i);
  if (fromRawToken) {
    return parseEpisodeCandidate(fromRawToken[1]);
  }

  try {
    const parsed = new URL(raw);
    const queryCandidates = [
      parsed.searchParams.get("ep"),
      parsed.searchParams.get("episode"),
      parsed.searchParams.get("episodio"),
      parsed.searchParams.get("e"),
    ];
    for (const candidate of queryCandidates) {
      const fromQuery = parseEpisodeCandidate(candidate);
      if (fromQuery != null) return fromQuery;
    }

    const pathname = decodeURIComponent(parsed.pathname ?? "");
    const fromPathToken = pathname.match(/(?:episodio|episode|ep)[-_/ ]*(\d{1,4})(?:\b|$)/i);
    if (fromPathToken) {
      return parseEpisodeCandidate(fromPathToken[1]);
    }

    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : "";
    if (lastSegment) {
      const fromLastSegment = parseEpisodeCandidate(lastSegment);
      if (fromLastSegment != null && /^\d{1,4}$/.test(lastSegment)) {
        return fromLastSegment;
      }
    }
  } catch {
    // ignore URL parse errors
  }

  return null;
}

export function enqueueDownloads(animeId: string, episodes: number[], season = 1, sourceUrl?: string, providerOverride?: string): QueueJob[] {
  const quality = getConfig("quality") || "1080p";
  const provider = providerOverride || getConfig("provider") || "animefire";
  const maxAttempts = getConfigInt("retry_max_attempts", 3, 0, 20);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO downloads (
      id, anime_id, episode_number, season, status,
      provider, quality, source_url, attempt_count, max_attempts, enqueued_at
    )
    VALUES (
      $id, $animeId, $ep, $season, 'queued',
      $provider, $quality, $sourceUrl, 0, $maxAttempts, datetime('now')
    )
  `);

  const insEp = db.prepare(`
    INSERT OR IGNORE INTO episodes (id, anime_id, number, season, status)
    VALUES (?, ?, ?, ?, 'queued')
  `);

  const createdJobIds: string[] = [];
  let skippedCount = 0;
  const inferredEpisode = episodes.length === 1 ? inferEpisodeFromSourceUrl(sourceUrl) : null;

  for (const ep of episodes) {
    const effectiveEpisode = inferredEpisode ?? ep;
    if (inferredEpisode != null && inferredEpisode !== ep) {
      logger.warn(
        "downloader",
        JSON.stringify({
          event: "enqueue_episode_adjusted",
          animeId,
          requestedEpisode: ep,
          adjustedEpisode: inferredEpisode,
          sourceUrl,
        })
      );
    }

    // Pula se já há download ativo para o episódio
    const existing = db.query<{
      id: string;
      status: DownloadStatus;
    }, [string, number, number]>(
      `SELECT id, status
       FROM downloads
       WHERE anime_id = ? AND episode_number = ? AND season = ? AND status IN ('queued','downloading','retry_wait')
       ORDER BY rowid DESC
       LIMIT 1`
    ).get(animeId, effectiveEpisode, season);

    if (existing) {
      skippedCount += 1;
      continue;
    }

    // Pula se episódio já foi baixado com sucesso (evita redownload acidental)
    const alreadyDone = db.query<{ status: string }, [string, number, number]>(
      `SELECT status FROM episodes WHERE anime_id = ? AND number = ? AND season = ? AND status = 'downloaded' LIMIT 1`
    ).get(animeId, effectiveEpisode, season);

    if (alreadyDone) {
      skippedCount += 1;
      logger.info("downloader", JSON.stringify({ event: "enqueue_skip_already_downloaded", animeId, episode: effectiveEpisode, season }));
      continue;
    }

    // Alerta se espaço em disco está abaixo do threshold configurado
    const thresholdGb = parseFloat(getConfig("disk_alert_threshold_gb") || "2");
    if (Number.isFinite(thresholdGb) && thresholdGb > 0) {
      const downloadPath = getConfig("download_path") || (process.env.USERPROFILE ?? "/");
      const freeGb = getFreeSpaceGb(downloadPath);
      if (freeGb < thresholdGb) {
        logger.warn("downloader", JSON.stringify({ event: "low_disk_space", freeGb: freeGb.toFixed(2), thresholdGb }));
      }
    }

    const id = randomUUID();
    insert.run({
      $id: id,
      $animeId: animeId,
      $ep: effectiveEpisode,
      $season: season,
      $provider: provider,
      $quality: quality,
      $sourceUrl: sourceUrl ?? null,
      $maxAttempts: maxAttempts,
    });

    insEp.run(randomUUID(), animeId, effectiveEpisode, season);

    const startIndex = createdJobIds.length;
    scheduleStart(id, animeId, effectiveEpisode, season, sourceUrl ?? null, 50 + startIndex * 75);

    createdJobIds.push(id);
  }

  if (createdJobIds.length > 0) {
    updateAnimeDownloadState(animeId);
    kickQueue(25);
  }

  logger.info(
    "downloader",
    JSON.stringify({
      event: "enqueued",
      animeId,
      requested: episodes.length,
      created: createdJobIds.length,
      skipped: skippedCount,
    })
  );

  if (createdJobIds.length === 0) return [];
  const created = new Set(createdJobIds);
  return getAllDownloads().filter((job) => created.has(job.id));
}

export function getAllDownloads(): QueueJob[] {
  return db.query<{
    id: string;
    anime_id: string;
    anime_title: string;
    episode_number: number;
    season: number;
    status: string;
    progress: number;
    speed_kbps: number;
    total_bytes: number;
    downloaded_bytes: number;
    file_path: string;
    provider: string;
    quality: string;
    started_at: string | null;
    completed_at: string | null;
    error_msg: string | null;
    attempt_count: number;
    max_attempts: number;
    next_retry_at: string | null;
    last_error_code: string | null;
  }, []>(`
    SELECT
      d.*,
      a.title as anime_title
    FROM downloads d
    JOIN animes a ON a.id = d.anime_id
    ORDER BY d.rowid DESC
    LIMIT 200
  `).all().map((r) => ({
    id: r.id,
    animeId: r.anime_id,
    animeTitle: r.anime_title,
    episodeNumber: r.episode_number,
    season: r.season,
    status: r.status as DownloadStatus,
    progress: r.progress,
    speedKbps: r.speed_kbps,
    totalBytes: r.total_bytes,
    downloadedBytes: r.downloaded_bytes,
    filePath: r.file_path,
    provider: r.provider,
    quality: r.quality,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    errorMsg: r.error_msg,
    attemptCount: r.attempt_count ?? 0,
    maxAttempts: r.max_attempts ?? 0,
    nextRetryAt: r.next_retry_at,
    lastErrorCode: r.last_error_code,
  }));
}

export function cancelDownload(jobId: string): boolean {
  const row = getJobRow(jobId);
  if (!row) return false;

  clearTimerMap(scheduledStarts, jobId);
  clearTimerMap(retryTimers, jobId);

  const handle = active.get(jobId);
  if (handle) {
    handle.cancel();
    active.delete(jobId);
  }

  const result = db.run(
    `UPDATE downloads
     SET status = 'cancelled',
         error_msg = 'cancelled_by_user',
         last_error_code = 'cancelled_by_user',
         next_retry_at = NULL,
         speed_kbps = 0,
         completed_at = datetime('now')
     WHERE id = ? AND status IN ('queued','downloading','retry_wait')`,
    [jobId]
  );

  db.run(
    `UPDATE episodes
     SET status = 'missing', download_id = NULL
     WHERE anime_id = ? AND number = ? AND season = ?`,
    [row.anime_id, row.episode_number, row.season]
  );

  updateAnimeDownloadState(row.anime_id);
  logger.info("downloader", JSON.stringify({ event: "cancelled", jobId, animeId: row.anime_id, episode: row.episode_number }));
  kickQueue(100);
  return result.changes > 0;
}

export function retryDownload(jobId: string): boolean {
  const job = db.query<{
    anime_id: string;
    episode_number: number;
    season: number;
    source_url: string | null;
  }, [string]>(
    `SELECT anime_id, episode_number, season, source_url
     FROM downloads
     WHERE id = ? AND status IN ('failed','cancelled','retry_wait')`
  ).get(jobId);
  if (!job) return false;

  clearTimerMap(scheduledStarts, jobId);
  clearTimerMap(retryTimers, jobId);

  db.run(
    `UPDATE downloads
     SET status = 'queued',
         progress = 0,
         speed_kbps = 0,
         downloaded_bytes = 0,
         total_bytes = 0,
         error_msg = NULL,
         started_at = NULL,
         completed_at = NULL,
         attempt_count = 0,
         max_attempts = ?,
         next_retry_at = NULL,
         last_error_code = NULL
     WHERE id = ?`,
    [getConfigInt("retry_max_attempts", 3, 0, 20), jobId]
  );

  db.run(
    `UPDATE episodes
     SET status = 'queued', download_id = NULL
     WHERE anime_id = ? AND number = ? AND season = ?`,
    [job.anime_id, job.episode_number, job.season]
  );

  updateAnimeDownloadState(job.anime_id);
  scheduleStart(jobId, job.anime_id, job.episode_number, job.season, job.source_url, 250);
  kickQueue(50);

  logger.info("downloader", JSON.stringify({ event: "retry_manual", jobId, animeId: job.anime_id, episode: job.episode_number }));
  return true;
}

export function retryFailedDownloads(limit = 20): { requested: number; retried: number } {
  const rows = db.query<{ id: string }, [number]>(
    `SELECT id
     FROM downloads
     WHERE status IN ('failed','cancelled')
     ORDER BY rowid DESC
     LIMIT ?`
  ).all(limit);

  let retried = 0;
  for (const row of rows) {
    if (retryDownload(row.id)) retried += 1;
  }

  return { requested: rows.length, retried };
}

export function getActiveCount(): number {
  return active.size;
}

export function getQueueStats() {
  const rows = db.query<{ status: string; count: number }, []>(
    `SELECT status, COUNT(*) as count FROM downloads GROUP BY status`
  ).all();

  return {
    active: getActiveCount(),
    scheduled: scheduledStarts.size,
    retryScheduled: retryTimers.size,
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.count])),
  };
}

export function getDownloaderHealth() {
  const counts = db.query<{
    queued: number;
    downloading: number;
    retryWait: number;
    failed: number;
    cancelled: number;
  }, []>(
    `SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status = 'downloading' THEN 1 ELSE 0 END) as downloading,
      SUM(CASE WHEN status = 'retry_wait' THEN 1 ELSE 0 END) as retryWait,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
     FROM downloads`
  ).get();

  const stuck = db.query<{
    id: string;
    anime_id: string;
    episode_number: number;
    started_at: string | null;
  }, []>(
    `SELECT id, anime_id, episode_number, started_at
     FROM downloads
     WHERE status = 'downloading' AND started_at IS NOT NULL AND started_at < datetime('now', '-30 minutes')
     ORDER BY started_at ASC
     LIMIT 10`
  ).all();

  const recentFailures = db.query<{
    id: string;
    anime_id: string;
    episode_number: number;
    error_msg: string | null;
    last_error_code: string | null;
    completed_at: string | null;
  }, []>(
    `SELECT id, anime_id, episode_number, error_msg, last_error_code, completed_at
     FROM downloads
     WHERE status = 'failed'
     ORDER BY completed_at DESC, rowid DESC
     LIMIT 10`
  ).all();

  return {
    active: active.size,
    scheduledStarts: scheduledStarts.size,
    retryTimers: retryTimers.size,
    counts: {
      queued: Number(counts?.queued ?? 0),
      downloading: Number(counts?.downloading ?? 0),
      retryWait: Number(counts?.retryWait ?? 0),
      failed: Number(counts?.failed ?? 0),
      cancelled: Number(counts?.cancelled ?? 0),
    },
    stuck,
    recentFailures,
  };
}
