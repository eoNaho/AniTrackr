/**
 * Auto-scheduler: verifica séries em lançamento e enfileira novos episódios automaticamente.
 *
 * Estratégia inteligente:
 * - Verifica a cada 5 minutos (antes: 1 hora)
 * - Atualiza metadados AniList (next_release) a cada hora para todas as séries
 * - Só consulta o provider quando o episódio está a ≤30 min de lançar ou já lançou
 *   → evita scraping desnecessário em séries que lançam daqui a dias
 */

import db from "../db/index.ts";
import { getAniListAnime } from "./anilist.ts";
import { getEpisodesWithFallback, type Provider } from "./provider-chain.ts";
import { enqueueDownloads } from "./downloader.ts";
import { logger } from "../utils/logger.ts";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;       // 5 minutos
const ANILIST_REFRESH_MS = 60 * 60 * 1000;      // 1 hora
const RELEASE_WINDOW_MS  = 30 * 60 * 1000;      // 30 min antes do lançamento

let _schedulerInterval: ReturnType<typeof setInterval> | null = null;
let _lastAniListRefresh = 0;

export function startAutoScheduler() {
  if (_schedulerInterval) clearInterval(_schedulerInterval);
  // Primeira verificação após 2 minutos (deixa o servidor inicializar)
  const boot = setTimeout(() => void checkAndSchedule(), 2 * 60 * 1000);
  _schedulerInterval = setInterval(() => void checkAndSchedule(), CHECK_INTERVAL_MS);
  return () => { clearTimeout(boot); if (_schedulerInterval) clearInterval(_schedulerInterval); };
}

async function checkAndSchedule() {
  const releasing = db.query<{
    id: string;
    title: string;
    anilist_id: number;
    provider: string;
    source_url: string | null;
    downloaded_count: number;
    season_number: number;
    next_release: string | null;
    auto_download: number;
  }, []>(
    `SELECT a.id, a.title, a.anilist_id, a.provider, a.source_url, a.downloaded_count,
            a.season_number, a.next_release,
            COALESCE(r.auto_download, 1) AS auto_download
     FROM animes a
     LEFT JOIN anime_rules r ON r.anime_id = a.id
     WHERE a.is_tracked = 1
       AND a.anilist_status = 'RELEASING'
       AND a.source_url IS NOT NULL
       AND COALESCE(r.auto_download, 1) = 1`
  ).all();

  if (!releasing.length) return;

  const now = Date.now();
  const shouldRefreshMeta = now - _lastAniListRefresh > ANILIST_REFRESH_MS;

  // 1. Atualiza next_release via AniList (operação leve, 1x/hora)
  if (shouldRefreshMeta) {
    _lastAniListRefresh = now;
    logger.info("auto-schedule", `atualizando metadados AniList para ${releasing.length} série(s)`);
    for (const anime of releasing) {
      if (!anime.anilist_id) continue;
      try {
        const data = await getAniListAnime(anime.anilist_id).catch(() => null);
        const nextReleaseIso = data?.nextAiringEpisode?.airingAt
          ? new Date(data.nextAiringEpisode.airingAt * 1000).toISOString()
          : null;
        db.run(`UPDATE animes SET next_release = ?, updated_at = datetime('now') WHERE id = ?`, [nextReleaseIso, anime.id]);
        // Atualiza objeto local para usar na próxima etapa
        anime.next_release = nextReleaseIso;
      } catch (err) {
        logger.warn("auto-schedule", `AniList falhou para "${anime.title}": ${err}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // 2. Filtra apenas séries com episódio próximo ou sem data conhecida
  type SkipReason = "out_of_window" | "no_source_url";
  const skipCounts: Record<SkipReason, number> = { out_of_window: 0, no_source_url: 0 };
  const toCheck: typeof releasing = [];

  for (const anime of releasing) {
    if (!anime.source_url) {
      skipCounts.no_source_url++;
      logger.debug("auto-schedule", `skip "${anime.title}": sem source_url`);
      continue;
    }
    if (anime.next_release) {
      const releaseMs = new Date(anime.next_release).getTime();
      if (releaseMs > now + RELEASE_WINDOW_MS) {
        skipCounts.out_of_window++;
        const minUntil = Math.round((releaseMs - now) / 60_000);
        logger.debug("auto-schedule", `skip "${anime.title}": próximo ep em ${minUntil}min`);
        continue;
      }
    }
    toCheck.push(anime);
  }

  // Resumo de skips
  const skipParts = (Object.entries(skipCounts) as [SkipReason, number][])
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  if (skipParts) logger.debug("auto-schedule", `skips: ${skipParts}`);

  if (!toCheck.length) {
    logger.debug("auto-schedule", `ciclo: ${releasing.length} avaliados | 0 verificados | todos fora da janela`);
    return;
  }

  logger.info("auto-schedule", `ciclo: ${releasing.length} avaliados | ${toCheck.length} para verificar no provider`);

  let totalQueued = 0;
  let failures = 0;
  for (const anime of toCheck) {
    try {
      const queued = await checkAndQueueNewEpisodes(anime);
      totalQueued += queued;
    } catch (err) {
      failures++;
      logger.warn("auto-schedule", `erro em "${anime.title}": ${err}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  logger.info(
    "auto-schedule",
    `ciclo concluído: verificados=${toCheck.length} | enfileirados=${totalQueued} | falhas=${failures}`
  );
}

// ── Rule helpers ──────────────────────────────────────────────────────────────

type AnimeScheduleRule = {
  auto_download: number;
  download_window_start: string | null;
  download_window_end: string | null;
  daily_limit: number;
  skip_fillers: number;
  skip_recaps: number;
};

function getAnimeScheduleRules(animeId: string): AnimeScheduleRule {
  return db.query<AnimeScheduleRule, [string]>(`
    SELECT auto_download, download_window_start, download_window_end, daily_limit, skip_fillers, skip_recaps
    FROM anime_rules WHERE anime_id = ?
  `).get(animeId) ?? { auto_download: 1, download_window_start: null, download_window_end: null, daily_limit: 0, skip_fillers: 0, skip_recaps: 0 };
}

function isInDownloadWindow(start: string | null, end: string | null): boolean {
  if (!start || !end) return true;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  // Suporta janela overnight (ex.: 22:00-06:00)
  if (startMin <= endMin) return nowMin >= startMin && nowMin <= endMin;
  return nowMin >= startMin || nowMin <= endMin;
}

function getDailyQueuedCount(animeId: string): number {
  return db.query<{ count: number }, [string]>(
    `SELECT COUNT(*) as count FROM downloads WHERE anime_id = ? AND date(enqueued_at) = date('now')`
  ).get(animeId)?.count ?? 0;
}

// ── Provider check ────────────────────────────────────────────────────────────

async function checkAndQueueNewEpisodes(anime: {
  id: string;
  title: string;
  provider: string;
  source_url: string | null;
  downloaded_count: number;
  season_number: number;
}): Promise<number> {
  if (!anime.source_url) return 0;

  // ── Aplicar regras antes de consultar o provider ──────────────────────────
  const rules = getAnimeScheduleRules(anime.id);

  if (!isInDownloadWindow(rules.download_window_start, rules.download_window_end)) {
    logger.debug("auto-schedule", `"${anime.title}": fora da janela (${rules.download_window_start}-${rules.download_window_end})`);
    return 0;
  }

  if (rules.daily_limit > 0) {
    const todayCount = getDailyQueuedCount(anime.id);
    if (todayCount >= rules.daily_limit) {
      logger.debug("auto-schedule", `"${anime.title}": limite diário atingido (${todayCount}/${rules.daily_limit})`);
      return 0;
    }
  }

  const existing = new Set(
    db.query<{ episode_number: number }, [string]>(
      `SELECT DISTINCT episode_number FROM downloads
       WHERE anime_id = ? AND status IN ('queued','downloading','completed')`
    ).all(anime.id).map((r) => r.episode_number)
  );

  const maxExisting = existing.size > 0 ? Math.max(...existing) : anime.downloaded_count;

  const available = await getEpisodesWithFallback(anime.source_url, anime.provider as Provider);
  if (!available.length) return 0;

  const newEps = available.filter((ep) => ep.number > maxExisting && !existing.has(ep.number));
  if (!newEps.length) return 0;

  logger.info("auto-schedule", `"${anime.title}": ${newEps.length} novo(s) ep(s) detectado(s) (após ep ${maxExisting})`);

  const urlByNumber = new Map(available.map((e) => [e.number, e.url]));
  let queued = 0;

  for (const ep of newEps) {
    // ── Skip filler/recap (requer metadado do Jikan) ──────────────────────
    if (rules.skip_fillers || rules.skip_recaps) {
      const epMeta = db.query<{ is_filler: number; is_recap: number }, [string, number]>(
        `SELECT is_filler, is_recap FROM episodes WHERE anime_id = ? AND number = ?`
      ).get(anime.id, ep.number);
      if (epMeta) {
        if (rules.skip_fillers && epMeta.is_filler) {
          logger.debug("auto-schedule", `"${anime.title}" ep ${ep.number}: skip (filler)`);
          continue;
        }
        if (rules.skip_recaps && epMeta.is_recap) {
          logger.debug("auto-schedule", `"${anime.title}" ep ${ep.number}: skip (recap)`);
          continue;
        }
      }
    }

    // ── Verificar limite diário por episódio (reavalia a cada iteração) ──
    if (rules.daily_limit > 0 && getDailyQueuedCount(anime.id) >= rules.daily_limit) {
      logger.debug("auto-schedule", `"${anime.title}": limite diário atingido, parando em ep ${ep.number}`);
      break;
    }

    const sourceUrl = urlByNumber.get(ep.number) ?? anime.source_url;
    const jobs = enqueueDownloads(anime.id, [ep.number], anime.season_number, sourceUrl);
    queued += jobs.length;
    if (jobs.length) logger.info("auto-schedule", `enfileirado: "${anime.title}" ep ${ep.number}`);
  }

  return queued;
}

// Rota de controle exposta via API
export function getAutoScheduleStatus() {
  return {
    active: _schedulerInterval !== null,
    intervalHours: CHECK_INTERVAL_MS / 3_600_000,
  };
}

export async function triggerAutoScheduleNow() {
  await checkAndSchedule();
}
