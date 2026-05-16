/**
 * Auto-scheduler: verifica séries em lançamento e enfileira novos episódios automaticamente.
 * Roda a cada hora.
 */

import db from "../db/index.ts";
import { getAniListAnime } from "./anilist.ts";
import { getEpisodesWithFallback, type Provider } from "./provider-chain.ts";
import { enqueueDownloads } from "./downloader.ts";
import { logger } from "../utils/logger.ts";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
let _schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoScheduler() {
  if (_schedulerInterval) clearInterval(_schedulerInterval);
  // Primeira verificação após 2 minutos (deixa o servidor inicializar)
  const boot = setTimeout(() => void checkAndSchedule(), 2 * 60 * 1000);
  _schedulerInterval = setInterval(() => void checkAndSchedule(), CHECK_INTERVAL_MS);
  // Retorna cleanup para testes
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
    auto_download: number;
  }, []>(
    `SELECT a.id, a.title, a.anilist_id, a.provider, a.source_url, a.downloaded_count, a.season_number,
            COALESCE(r.auto_download, 1) AS auto_download
     FROM animes a
     LEFT JOIN anime_rules r ON r.anime_id = a.id
     WHERE a.is_tracked = 1
       AND a.anilist_status = 'RELEASING'
       AND a.source_url IS NOT NULL
       AND COALESCE(r.auto_download, 1) = 1`
  ).all();

  if (!releasing.length) return;
  logger.info("auto-schedule", `verificando ${releasing.length} série(s) em lançamento`);

  let totalQueued = 0;
  for (const anime of releasing) {
    try {
      const queued = await checkAnime(anime);
      totalQueued += queued;
    } catch (err) {
      logger.warn("auto-schedule", `erro em "${anime.title}": ${err}`);
    }
    // Throttle entre animes para não sobrecarregar providers
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (totalQueued > 0)
    logger.info("auto-schedule", `${totalQueued} novo(s) episódio(s) enfileirado(s)`);
}

async function checkAnime(anime: {
  id: string;
  title: string;
  anilist_id: number;
  provider: string;
  source_url: string | null;
  downloaded_count: number;
  season_number: number;
}): Promise<number> {
  if (!anime.source_url) return 0;

  if (anime.anilist_id) {
    const anilistData = await getAniListAnime(anime.anilist_id).catch(() => null);
    const nextReleaseIso = anilistData?.nextAiringEpisode?.airingAt
      ? new Date(anilistData.nextAiringEpisode.airingAt * 1000).toISOString()
      : null;
    db.run(`UPDATE animes SET next_release = ?, updated_at = datetime('now') WHERE id = ?`, [nextReleaseIso, anime.id]);
  }

  // Episódios já baixados ou em fila
  const existing = new Set(
    db.query<{ episode_number: number }, [string]>(
      `SELECT DISTINCT episode_number FROM downloads
       WHERE anime_id = ? AND status IN ('queued','downloading','completed')`
    ).all(anime.id).map((r) => r.episode_number)
  );

  const maxExisting = existing.size > 0 ? Math.max(...existing) : anime.downloaded_count;

  // Busca episódios disponíveis no provider (usa cache se recente)
  const available = await getEpisodesWithFallback(
    anime.source_url,
    anime.provider as Provider
  );
  if (!available.length) return 0;

  const newEps = available.filter((ep) => ep.number > maxExisting && !existing.has(ep.number));
  if (!newEps.length) return 0;

  logger.info("auto-schedule", `"${anime.title}": ${newEps.length} novo(s) ep(s) detectado(s) (após ep ${maxExisting})`);

  const urlByNumber = new Map(available.map((e) => [e.number, e.url]));
  let queued = 0;

  for (const ep of newEps) {
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
