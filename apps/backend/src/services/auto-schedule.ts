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
  const toCheck = releasing.filter((anime) => {
    if (!anime.next_release) return true; // data desconhecida → sempre verifica
    const releaseMs = new Date(anime.next_release).getTime();
    return releaseMs <= now + RELEASE_WINDOW_MS; // já lançou ou vai lançar em ≤30 min
  });

  if (!toCheck.length) return;
  logger.info("auto-schedule", `verificando provider para ${toCheck.length} série(s) com episódio próximo`);

  let totalQueued = 0;
  for (const anime of toCheck) {
    try {
      const queued = await checkAndQueueNewEpisodes(anime);
      totalQueued += queued;
    } catch (err) {
      logger.warn("auto-schedule", `erro em "${anime.title}": ${err}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (totalQueued > 0)
    logger.info("auto-schedule", `${totalQueued} novo(s) episódio(s) enfileirado(s)`);
}

async function checkAndQueueNewEpisodes(anime: {
  id: string;
  title: string;
  provider: string;
  source_url: string | null;
  downloaded_count: number;
  season_number: number;
}): Promise<number> {
  if (!anime.source_url) return 0;

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
