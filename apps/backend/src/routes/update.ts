import Elysia from "elysia";
import { existsSync } from "fs";
import { logger } from "../utils/logger.ts";

export const CURRENT_VERSION = "2.1.0";
const GITHUB_REPO = "eonaho/goanime-trackear";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

type CheckResult = {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
  body: string | null;
  isDocker: boolean;
  checkedAt: string;
  error?: string;
};

let _cache: CheckResult | null = null;
let _cacheTs = 0;

function isDockerRuntime(): boolean {
  return existsSync("/.dockerenv") || process.env.ANITRACKR_RUNTIME?.trim() === "docker";
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchLatestRelease(): Promise<CheckResult> {
  const isDocker = isDockerRuntime();
  const checkedAt = new Date().toISOString();

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "anitrackr-backend" },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404) {
      // Sem releases publicadas ainda
      return { current: CURRENT_VERSION, latest: null, hasUpdate: false, releaseUrl: null, publishedAt: null, body: null, isDocker, checkedAt };
    }

    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);

    const data = await res.json() as {
      tag_name: string;
      html_url: string;
      published_at: string;
      body: string;
    };

    const latest = data.tag_name.replace(/^v/, "");
    const hasUpdate = compareVersions(latest, CURRENT_VERSION) > 0;

    return {
      current: CURRENT_VERSION,
      latest,
      hasUpdate,
      releaseUrl: data.html_url,
      publishedAt: data.published_at,
      body: (data.body ?? "").slice(0, 600) || null,
      isDocker,
      checkedAt,
    };
  } catch (err) {
    logger.warn("update", `falha ao verificar versão: ${err}`);
    return {
      current: CURRENT_VERSION,
      latest: null,
      hasUpdate: false,
      releaseUrl: null,
      publishedAt: null,
      body: null,
      isDocker,
      checkedAt,
      error: String(err),
    };
  }
}

export const updateRoutes = new Elysia({ prefix: "/update" })

  .get("/check", async () => {
    const now = Date.now();
    if (_cache && now - _cacheTs < CACHE_TTL_MS) return _cache;

    const result = await fetchLatestRelease();
    _cache = result;
    _cacheTs = now;
    if (result.hasUpdate) {
      logger.info("update", `nova versão disponível: ${result.latest} (atual: ${result.current})`);
    }
    return result;
  })

  // Force refresh (ignora cache)
  .post("/check", async () => {
    _cache = null;
    _cacheTs = 0;
    const result = await fetchLatestRelease();
    _cache = result;
    _cacheTs = Date.now();
    return result;
  });
