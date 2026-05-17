"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTorrent,
  clearQueueMonitor,
  cancelAllDownloads,
  cancelDownloadById,
  createLibraryAnime,
  deleteLibraryAnime,
  enqueueEpisodes,
  fetchBackendHealth,
  fetchConfig,
  fetchDownloadStats,
  fetchDownloads,
  fetchLibrary,
  fetchLibrarySummary,
  fetchMetadataSearch,
  fetchSearchProviders,
  openDownloadStream,
  queueMissingEpisodes,
  queueMissingForAll,
  retryDownloadById,
  retryFailedDownloads,
  scanAnimeById,
  searchAnime,
  searchEpisodes,
  type BackendHealth,
  type DownloadJob,
  type DownloadStreamEvent,
  type KitsuMetadata,
  type LibraryAnime,
  type LibrarySummary,
  type SearchResult,
} from "@/lib/api";
import { AnimeView, ConfirmDialog } from "./ui";
import { LibraryView } from "./library-view";
import { SearchView } from "./search-view";
import { SettingsView } from "./settings-view";
import { DashboardView } from "./dashboard-view";
import { CalendarView } from "./calendar-view";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { IntegrityView } from "./integrity-view";
import { DiscoverView } from "./discover-view";
import { SubtitlesView } from "./subtitles-view";

function fmtGb(v: number) {
  return `${v.toFixed(1)} GB`;
}

function mapAnime(a: LibraryAnime): AnimeView {
  return {
    id: a.id,
    title: a.title,
    altTitle: a.altTitle ?? null,
    provider: a.provider,
    quality: a.quality,
    downloaded: a.downloadedCount,
    total: a.episodeCount,
    missing: a.missingEpisodes,
    synopsis: a.synopsis ?? "",
    path: a.localPath ?? "",
    status: a.downloadStatus,
    sizeGb: a.sizeGb,
    tags: a.tags ?? [],
    posterUrl: a.posterUrl ?? null,
    asciiArt: a.asciiArt ?? null,
    progress: a.progress,
    year: a.year ?? null,
    rating: a.rating ?? null,
    watchStatus: a.watchStatus ?? "none",
  };
}

type Mode = "dashboard" | "library" | "calendar" | "discover" | "subtitles" | "search" | "diagnostics" | "integrity" | "settings";
type LogEntry = { time: string; module: string; text: string };
type StreamState = "connecting" | "live" | "fallback";
type SearchEpisode = { key: string; number: number; label: string; url: string };
function buildEpisodeKey(episode: { number: number; label: string; url: string }, index: number) {
  return `${episode.number}::${episode.url}::${episode.label}::${index}`;
}

function normalizeAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseSafePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return null;
  return n;
}

function parseRomanNumeral(value: string): number | null {
  const roman = value.trim().toUpperCase();
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  let prev = 0;
  for (let i = roman.length - 1; i >= 0; i -= 1) {
    const cur = map[roman[i]];
    if (!cur) return null;
    if (cur < prev) total -= cur;
    else total += cur;
    prev = cur;
  }
  if (total <= 0 || total > 100) return null;
  return total;
}

const JAPANESE_NUMBER_MAP: Record<string, number> = {
  ichi: 1,
  ni: 2,
  san: 3,
  yon: 4,
  shi: 4,
  go: 5,
  roku: 6,
  nana: 7,
  shichi: 7,
  hachi: 8,
  kyu: 9,
  ku: 9,
  juu: 10,
};

function inferSeasonNumber(...candidates: Array<string | null | undefined>): number {
  for (const rawCandidate of candidates) {
    if (!rawCandidate) continue;
    const candidate = normalizeAscii(rawCandidate);

    const direct =
      candidate.match(/\b(?:season|temporada)\s*(\d{1,2})\b/i)
      ?? candidate.match(/\b(\d{1,2})(?:st|nd|rd|th)\s*season\b/i)
      ?? candidate.match(/\bs(?:eason)?\s*0?(\d{1,2})\b/i)
      ?? candidate.match(/\b(\d{1,2})\s*no\s*shou\b/i);
    if (direct) {
      const parsed = parseSafePositiveInt(direct[1]);
      if (parsed != null) return parsed;
    }

    const roman = candidate.match(/\b(?:season|temporada)\s*([ivxlc]{1,5})\b/i);
    if (roman) {
      const parsed = parseRomanNumeral(roman[1]);
      if (parsed != null) return parsed;
    }

    const japaneseNoShou = candidate.match(/\b([a-z]+)\s+no\s+shou\b/i);
    if (japaneseNoShou) {
      const parsed = JAPANESE_NUMBER_MAP[japaneseNoShou[1]];
      if (parsed != null) return parsed;
    }
  }

  return 1;
}

function inferEpisodeNumberFromUrl(url: string): number | null {
  if (!url?.trim()) return null;

  const raw = url.trim();
  const rawEpisode = raw.match(/(?:episodio|episode|ep)[-_/ ]*(\d{1,4})(?:\b|$)/i);
  if (rawEpisode) return parseSafePositiveInt(rawEpisode[1]);

  try {
    const parsed = new URL(raw);
    const fromQuery =
      parseSafePositiveInt(parsed.searchParams.get("ep"))
      ?? parseSafePositiveInt(parsed.searchParams.get("episode"))
      ?? parseSafePositiveInt(parsed.searchParams.get("episodio"));
    if (fromQuery != null) return fromQuery;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.length > 0 ? segments[segments.length - 1] : "";
    if (/^\d{1,4}$/.test(last)) {
      return parseSafePositiveInt(last);
    }
  } catch {
    // ignore parse errors
  }

  return null;
}

function inferEpisodeNumber(episode: { number: number; label: string; url: string }, fallback: number): number {
  const fromUrl = inferEpisodeNumberFromUrl(episode.url);
  if (fromUrl != null) return fromUrl;

  const fromLabel = normalizeAscii(episode.label).match(/\b(?:episodio|episode|ep)\s*\.?\s*(\d{1,4})\b/i);
  if (fromLabel) {
    const parsed = parseSafePositiveInt(fromLabel[1]);
    if (parsed != null) return parsed;
  }

  if (Number.isFinite(episode.number) && episode.number > 0) {
    return episode.number;
  }

  return fallback;
}

function sendNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, { body, icon: "/favicon.ico" });
}

export function TrackerHome() {
  const [mode, setMode] = useState<Mode>("dashboard");
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [backendStatus, setBackendStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [providers, setProviders] = useState<string[]>([]);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [animes, setAnimes] = useState<AnimeView[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: "00:00:00", module: "app", text: "Iniciando AniTrackr v2.0.1..." },
  ]);

  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [lastStreamTs, setLastStreamTs] = useState<number | null>(null);

  const [downloadPath, setDownloadPath] = useState("");
  const [allowSimulatedDownloads, setAllowSimulatedDownloads] = useState("false");
  const [qbtEnabled, setQbtEnabled] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchSource, setSearchSource] = useState("all");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchProviderStats, setSearchProviderStats] = useState<Record<string, import("@/lib/api").ProviderSearchStat> | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [kitsuMeta, setKitsuMeta] = useState<KitsuMetadata | null>(null);
  const [libraryFallbackPoster, setLibraryFallbackPoster] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<SearchEpisode[]>([]);
  const [selectedEpisodes, setSelectedEpisodes] = useState<string[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [deleteDialogTarget, setDeleteDialogTarget] = useState<AnimeView | null>(null);

  const selectVersionRef = useRef(0);
  const prevJobStatusRef = useRef<Map<string, string>>(new Map());
  const prevCompletedRef = useRef<Set<string>>(new Set());
  const prevFailedRef = useRef<Set<string>>(new Set());

  const pushLog = useCallback((module: string, text: string) => {
    setLogs((cur) => [
      ...cur.slice(-7),
      { time: new Date().toLocaleTimeString("pt-BR", { hour12: false }), module, text },
    ]);
  }, []);

  const refreshDownloads = useCallback(async () => {
    try {
      const downloads = await fetchDownloads();
      setDownloadJobs(downloads.jobs);
    } catch (err) {
      pushLog("downloads", `erro ao atualizar fila: ${(err as Error).message}`);
    }
  }, [pushLog]);

  const refreshData = useCallback(async () => {
    setIsBusy(true);
    try {
      const [health, provRes, libRes, sumRes, statsRes, cfgRes, downloadsRes] = await Promise.all([
        fetchBackendHealth(),
        fetchSearchProviders(),
        fetchLibrary(),
        fetchLibrarySummary(),
        fetchDownloadStats(),
        fetchConfig(),
        fetchDownloads(),
      ]);
      setBackendHealth(health);
      setProviders(provRes.providers.map((p) => p.key ?? p.id ?? "?"));
      setAnimes(libRes.animes.map(mapAnime));
      setSummary(sumRes);
      setDownloadJobs(downloadsRes.jobs);
      setBackendStatus("online");
      setDownloadPath(cfgRes.download_path ?? "");
      setAllowSimulatedDownloads(cfgRes.allow_simulated_downloads ?? "false");
      setQbtEnabled(cfgRes.qbittorrent_enabled === "true");
      const statsByStatus = (statsRes as { byStatus?: Record<string, number> }).byStatus;
      pushLog("api", `online v${health.version} | queued: ${String(statsByStatus?.queued ?? 0)}`);
    } catch (err) {
      setBackendStatus("offline");
      pushLog("api", `erro: ${(err as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }, [pushLog]);

  // Solicitar permissão de notificação na primeira carga
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshData();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshData]);

  useEffect(() => {
    let mounted = true;
    const close = openDownloadStream(
      (payload: DownloadStreamEvent) => {
        if (!mounted) return;
        setLastStreamTs(Date.now());

        if (payload.type === "snapshot" || payload.type === "progress") {
          setDownloadJobs(payload.jobs);
          // Notificações de download concluído / falha permanente
          for (const job of payload.jobs) {
            if (job.status === "completed" && !prevCompletedRef.current.has(job.id)) {
              prevCompletedRef.current.add(job.id);
              sendNotification("Download concluído", `${job.animeTitle} — Ep. ${job.episodeNumber}`);
            }
            if (
              job.status === "failed" &&
              job.attemptCount >= job.maxAttempts &&
              !prevFailedRef.current.has(job.id)
            ) {
              prevFailedRef.current.add(job.id);
              sendNotification(
                "Falha no download",
                `${job.animeTitle} — Ep. ${job.episodeNumber}: ${job.errorMsg ?? "erro desconhecido"}`
              );
            }
          }
          return;
        }

        if (payload.type === "enqueued") {
          pushLog("queue", `novos jobs enfileirados: ${payload.count}`);
          return;
        }
        if (payload.type === "cancelled") {
          pushLog("queue", `job cancelado: ${payload.jobId.slice(0, 8)}`);
          void refreshDownloads();
          return;
        }
        if (payload.type === "retried") {
          pushLog("queue", `job em retry: ${payload.jobId.slice(0, 8)}`);
          void refreshDownloads();
          return;
        }
        if (payload.type === "retry-batch") {
          pushLog("queue", `retry em lote: ${payload.retried}/${payload.requested}`);
          void refreshDownloads();
          return;
        }
        if (payload.type === "batch-enqueued") {
          pushLog("queue", `missing-all: ${payload.totalQueued} jobs`);
          void refreshDownloads();
        }
      },
      (state) => {
        if (!mounted) return;
        if (state === "open") {
          setStreamState("live");
          setBackendStatus("online");
        } else {
          setStreamState("fallback");
        }
      }
    );

    return () => {
      mounted = false;
      close();
    };
  }, [pushLog, refreshDownloads]);

  useEffect(() => {
    if (streamState === "live") return;
    const boot = setTimeout(() => {
      void refreshDownloads();
    }, 0);
    const timer = setInterval(() => {
      void refreshDownloads();
    }, 2000);
    return () => {
      clearTimeout(boot);
      clearInterval(timer);
    };
  }, [refreshDownloads, streamState]);

  // Detectar downloads completados para notificação
  useEffect(() => {
    const prev = prevJobStatusRef.current;
    for (const job of downloadJobs) {
      if (job.status === "completed" && prev.get(job.id) === "downloading") {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`✓ Download concluído`, {
            body: `${job.animeTitle} — Ep ${job.episodeNumber}`,
            tag: job.id,
          });
        }
      }
    }
    prevJobStatusRef.current = new Map(downloadJobs.map((j) => [j.id, j.status]));
  }, [downloadJobs]);

  const hasActiveDownloads = useMemo(
    () => downloadJobs.some((j) => j.status === "queued" || j.status === "downloading" || j.status === "retry_wait"),
    [downloadJobs]
  );

  useEffect(() => {
    // SSE já entrega eventos de progresso em tempo real; polling só faz sentido no fallback
    if (!hasActiveDownloads || streamState === "live") return;
    const timer = setInterval(() => {
      void refreshDownloads();
    }, 2000);
    return () => clearInterval(timer);
  }, [hasActiveDownloads, refreshDownloads, streamState]);

  const selected = animes[selectedIndex < animes.length ? selectedIndex : 0] ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Tab") {
        e.preventDefault();
        setMode((m) => m === "library" ? "search" : m === "search" ? "settings" : "library");
        return;
      }
      if (deleteDialogTarget) return;
      if (mode !== "library") return;
      if (["ArrowDown", "j"].includes(e.key)) {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(animes.length - 1, i + 1));
        return;
      }
      if (["ArrowUp", "k"].includes(e.key)) {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "d" && !isBusy) {
        e.preventDefault();
        void handleQueueMissing();
        return;
      }
      if (e.key === "b" && !isBusy) {
        e.preventDefault();
        void handleQueueMissingAll();
        return;
      }
      if (e.key === "s" && !isBusy) {
        e.preventDefault();
        void handleScan();
        return;
      }
      if (e.key === "x" && !isBusy) {
        e.preventDefault();
        handleDeleteFromLibrary();
        return;
      }
      if (e.key === "r" && !isBusy) {
        e.preventDefault();
        void refreshData();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, animes.length, isBusy, selected, deleteDialogTarget]);

  useEffect(() => {
    let active = true;
    if (!selected || selected.posterUrl) {
      queueMicrotask(() => {
        if (active) setLibraryFallbackPoster(null);
      });
      return;
    }

    fetchMetadataSearch(selected.title, "kitsu")
      .then((res) => {
        if (!active) return;
        setLibraryFallbackPoster(res.results?.[0]?.posterUrl ?? null);
      })
      .catch(() => {
        if (!active) return;
        setLibraryFallbackPoster(null);
      });

    return () => {
      active = false;
    };
  }, [selected]);

  async function handleQueueMissing() {
    if (!selected) return;
    setIsBusy(true);
    try {
      const res = await queueMissingEpisodes(selected.id);
      pushLog("queue", `${selected.title}: ${res.queued} eps na fila`);
      await refreshData();
    } catch (e) {
      pushLog("queue", `erro: ${(e as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleQueueMissingAll() {
    setIsBusy(true);
    try {
      const res = await queueMissingForAll();
      pushLog("queue", `missing-all: ${res.totalQueued} enfileirados`);
      await refreshData();
    } catch (e) {
      pushLog("queue", `erro: ${(e as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleScan() {
    if (!selected) return;
    setIsBusy(true);
    try {
      const res = await scanAnimeById(selected.id);
      pushLog("scan", `${selected.title}: ${res.foundFiles ?? 0} arquivos`);
      await refreshData();
    } catch (e) {
      pushLog("scan", `erro: ${(e as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }

  function handleDeleteFromLibrary() {
    if (!selected || isBusy) return;
    setDeleteDialogTarget(selected);
  }

  async function handleConfirmDeleteFromLibrary() {
    if (!deleteDialogTarget) return;
    const target = deleteDialogTarget;
    setDeleteDialogTarget(null);

    setIsBusy(true);
    try {
      const res = await deleteLibraryAnime(target.id);
      if (res?.error) {
        pushLog("library", `erro ao deletar: ${res.error}`);
      } else {
        pushLog("library", `removido: ${target.title}`);
        await refreshData();
      }
    } catch (e) {
      pushLog("library", `erro ao deletar: ${(e as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCancelDownload(id: string) {
    try {
      await cancelDownloadById(id);
      pushLog("queue", `cancelado: ${id.slice(0, 8)}`);
      await refreshDownloads();
    } catch (e) {
      pushLog("queue", `cancel erro: ${(e as Error).message}`);
    }
  }

  async function handleRetryDownload(id: string) {
    try {
      await retryDownloadById(id);
      pushLog("queue", `retry: ${id.slice(0, 8)}`);
      await refreshDownloads();
    } catch (e) {
      pushLog("queue", `retry erro: ${(e as Error).message}`);
    }
  }

  async function handleRetryFailedBatch() {
    try {
      const res = await retryFailedDownloads(50);
      pushLog("queue", `retry em lote: ${res.retried}/${res.requested}`);
      await refreshDownloads();
    } catch (e) {
      pushLog("queue", `retry-lote erro: ${(e as Error).message}`);
    }
  }

  async function handleCancelAllActive() {
    try {
      const res = await cancelAllDownloads();
      pushLog("queue", `cancel all: ${res.cancelled}`);
      await refreshDownloads();
    } catch (e) {
      pushLog("queue", `cancel-all erro: ${(e as Error).message}`);
    }
  }

  async function handleClearQueueMonitor() {
    try {
      const res = await clearQueueMonitor();
      pushLog("queue", `monitor limpo: removidos ${res.removed}`);
      await refreshDownloads();
    } catch (e) {
      pushLog("queue", `clear-monitor erro: ${(e as Error).message}`);
    }
  }

  async function handleSearch() {
    return runSearch(searchQuery, searchSource);
  }

  async function runSearch(rawQuery: string, sourceOverride?: string) {
    const effectiveQuery = rawQuery.trim();
    const effectiveSource = sourceOverride ?? searchSource;
    if (effectiveQuery.length < 2) return;
    setIsBusy(true);
    setSearchResults([]);
    setSearchProviderStats(null);
    setSelectedResult(null);
    setKitsuMeta(null);
    setEpisodes([]);
    setSelectedEpisodes([]);
    try {
      const res = await searchAnime(effectiveQuery, effectiveSource);
      setSearchResults(res.results ?? []);
      setSearchProviderStats(res.providerStats ?? null);
      pushLog("search", `"${effectiveQuery}" -> ${res.results?.length ?? 0} resultados`);
    } catch (e) {
      pushLog("search", `erro: ${(e as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDiscoverSearch(title: string) {
    const normalized = title.trim();
    if (!normalized) return;
    setSearchQuery(normalized);
    setSearchSource("all");
    setMode("search");
    await runSearch(normalized, "all");
  }

  async function handleSelectResult(result: SearchResult) {
    selectVersionRef.current += 1;
    const version = selectVersionRef.current;

    setSelectedResult(result);
    setEpisodes([]);
    setSelectedEpisodes([]);
    setKitsuMeta(null);
    setIsLoadingMeta(true);
    setIsLoadingEpisodes(true);

    fetchMetadataSearch(result.title.split(" [")[0].split(" ·")[0], "kitsu")
      .then((res) => {
        if (selectVersionRef.current !== version) return;
        if (res.results?.length) {
          setKitsuMeta(res.results[0]);
          pushLog("meta", `kitsu: ${res.results[0].title}`);
        } else {
          pushLog("meta", "kitsu: sem resultado");
        }
      })
      .catch(() => { if (selectVersionRef.current === version) pushLog("meta", "kitsu: falha"); })
      .finally(() => { if (selectVersionRef.current === version) setIsLoadingMeta(false); });

    if (result.provider === "nyaa") {
      const nyaaEp: SearchEpisode = {
        key: `nyaa::${result.id ?? result.url ?? "0"}`,
        number: 1,
        label: "▼ Adicionar ao qBittorrent",
        url: result.url ?? "",
      };
      setEpisodes([nyaaEp]);
      setSelectedEpisodes([nyaaEp.key]);
      setIsLoadingEpisodes(false);
      return;
    }

    searchEpisodes({ provider: result.provider ?? searchSource, url: result.url, allAnimeId: result.allAnimeId ?? result.id })
      .then((res) => {
        if (selectVersionRef.current !== version) return;
        const eps: SearchEpisode[] = (res.episodes ?? [])
          .map((episode, index) => {
            const normalizedEpisode = {
              ...episode,
              number: inferEpisodeNumber(episode, index + 1),
              label: episode.label || `Episódio ${index + 1}`,
            };
            return {
              ...normalizedEpisode,
              key: buildEpisodeKey(normalizedEpisode, index),
            };
          })
          .sort((a, b) => a.number - b.number);
        setEpisodes(eps);
        setSelectedEpisodes(eps.slice(0, 1).map((e) => e.key));
        pushLog("search", `${result.title}: ${res.total} eps`);
      })
      .catch((e) => { if (selectVersionRef.current === version) pushLog("search", `eps erro: ${(e as Error).message}`); })
      .finally(() => { if (selectVersionRef.current === version) setIsLoadingEpisodes(false); });
  }

  async function handleQueueSelected() {
    if (!selectedResult || selectedEpisodes.length === 0) return;
    setIsBusy(true);

    if (selectedResult.provider === "nyaa") {
      try {
        const magnetLink = selectedResult.url ?? "";
        if (!magnetLink) throw new Error("Magnet link ausente neste resultado.");
        await addTorrent({ magnetLink });
        pushLog("torrent", `${selectedResult.title.split(" [")[0]}: adicionado ao qBittorrent`);
      } catch (e) {
        pushLog("torrent", `erro: ${(e as Error).message}`);
      } finally {
        setIsBusy(false);
      }
      return;
    }

    try {
      const selectedSet = new Set(selectedEpisodes);
      const selectedEntries = episodes
        .filter((ep) => selectedSet.has(ep.key))
        .sort((a, b) => a.number - b.number);

      // Mantém a relação 1:1 entre (episódio, URL) para evitar drift no monitor.
      const enqueueTargets = new Map<string, { number: number; sourceUrl: string }>();
      for (const episode of selectedEntries) {
        const sourceUrl = episode.url || selectedResult.url || "";
        if (!sourceUrl) continue;
        const key = `${episode.number}::${sourceUrl}`;
        if (!enqueueTargets.has(key)) {
          enqueueTargets.set(key, { number: episode.number, sourceUrl });
        }
      }

      if (enqueueTargets.size === 0) {
        throw new Error("Nenhum episódio com URL válida para enfileirar.");
      }

      const inferredSeason = inferSeasonNumber(
        selectedResult.title,
        kitsuMeta?.title,
        kitsuMeta?.altTitle,
      );

      const lib = await createLibraryAnime({
        title: selectedResult.title,
        provider: selectedResult.provider ?? searchSource,
        sourceUrl: selectedResult.url,
        episodeCount: selectedResult.episodeCount ?? kitsuMeta?.episodeCount ?? episodes.length,
        localPath: downloadPath,
        posterUrl: kitsuMeta?.posterUrl ?? undefined,
        synopsis: kitsuMeta?.synopsis ?? undefined,
        year: kitsuMeta?.year,
        rating: kitsuMeta?.rating,
        kitsuId: kitsuMeta?.kitsuId,
        seasonNumber: inferredSeason,
      });
      if (lib.reused) {
        pushLog("library", `${selectedResult.title}: reutilizado registro existente`);
      }

      let queuedCount = 0;
      for (const target of enqueueTargets.values()) {
        const res = await enqueueEpisodes({
          animeId: lib.id,
          episodes: [target.number],
          season: inferredSeason,
          sourceUrl: target.sourceUrl,
        });
        queuedCount += res.queued ?? 0;
      }

      pushLog("queue", `${selectedResult.title}: ${queuedCount}/${enqueueTargets.size} eps enfileirados`);
      await refreshData();
      setMode("library");
    } catch (e) {
      pushLog("queue", `erro: ${(e as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }

  const queuedCount = useMemo(
    () => downloadJobs.filter((j) => j.status === "queued" || j.status === "downloading" || j.status === "retry_wait").length,
    [downloadJobs]
  );
  // byStatus keys vêm capitalizados do backend ("Downloaded", "Missing", etc.)
  const byStatus = useMemo(() => {
    if (!summary?.byStatus) return {} as Record<string, number>;
    return Object.fromEntries(
      Object.entries(summary.byStatus).map(([k, v]) => [k.toLowerCase(), v])
    ) as Record<string, number>;
  }, [summary]);
  const downloadedTitles = byStatus.downloaded ?? 0;
  const missingEpisodes = summary?.missingEpisodes ?? 0;
  const totalStorage = summary ? fmtGb(summary.totalStorageGb) : "0.0 GB";
  const providerBadges = useMemo(() => providers.slice(0, 4), [providers]);

  const statusColor = backendStatus === "online" ? "text-[#a6e3a1]" : backendStatus === "offline" ? "text-[#f38ba8]" : "text-[#f9e2af]";
  const streamLabel = streamState === "live" ? "live" : streamState === "fallback" ? "polling" : "connecting";
  const streamLabelClass = streamState === "live" ? "text-[#a6e3a1]" : streamState === "fallback" ? "text-[#f9e2af]" : "text-[#6c7086]";
  const runtimeModeLabel = allowSimulatedDownloads === "true" ? "sim-on" : "real-only";
  const runtimeModeClass = allowSimulatedDownloads === "true" ? "text-[#f9e2af]" : "text-[#a6e3a1]";

  return (
    <div
      className="h-[100dvh] overflow-hidden bg-[#050505] p-2 text-[#e0e0ed] md:p-3"
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
        backgroundImage:
          "linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,.25) 50%), linear-gradient(90deg, rgba(255,0,0,.06), rgba(0,255,0,.02), rgba(0,0,255,.06))",
        backgroundSize: "100% 4px, 3px 100%",
      }}
    >
      <style>{`
        @keyframes boot { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        .boot { animation: boot .32s ease-out both; }
        .blink { animation: blink 1s step-end infinite; }
      `}</style>

      <div className="flex h-full flex-col gap-[10px] rounded-md border border-[#45475a] bg-[#0f0f14] p-[10px] shadow-[0_20px_50px_rgba(0,0,0,.8),inset_0_0_100px_rgba(0,0,0,.5)]">
        <header className="flex shrink-0 flex-col gap-3 border-b border-[#2a2a38] pb-3 text-[14px]">
          <div className="font-extrabold tracking-[1px] text-[#cba6f7] drop-shadow-[0_0_4px_rgba(203,166,247,.35)]">
            ANITRACKR-DOWNLOAD-TRACKER v2.0.1<span className="blink ml-1">_</span>
          </div>

          <nav className="order-3 flex flex-wrap gap-1">
            {(
              [
                ["dashboard", "início"],
                ["library", "biblioteca"],
                ["calendar", "calendário"],
                ["discover", "discover"],
                ["subtitles", "subtitles"],
                ["search", "busca"],
                ["diagnostics", "diagnóstico"],
                ["integrity", "integridade"],
                ["settings", "⚙ config"],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`border px-3 py-[7px] text-[11px] font-bold uppercase tracking-[0.12em] ${
                  mode === m
                    ? "border-[#cba6f7] bg-[#cba6f7] text-[#0f0f14]"
                    : "border-[#45475a] text-[#6c7086] hover:border-[#cba6f7] hover:text-[#cba6f7]"
                }`}
              >
                [{label}]
              </button>
            ))}
          </nav>

          <div className="order-2 flex flex-wrap items-center gap-2 rounded-sm border border-[#2a2a38] bg-[#0b0b11] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[#6c7086]">
            {providerBadges.map((p) => (
              <span key={p} className="border border-[#232332] px-[6px] py-[2px] uppercase">[{p}]</span>
            ))}
            <span className="mr-2">
              API: <span className={`font-bold ${statusColor}`}>{backendStatus}</span>
              {backendHealth ? ` v${backendHealth.version}` : ""}
            </span>
            <span className="mr-2">
              DL: <span className={`font-bold uppercase ${streamLabelClass}`}>{streamLabel}</span>
            </span>
            <span>
              Mode: <span className={`font-bold uppercase ${runtimeModeClass}`}>{runtimeModeLabel}</span>
            </span>
          </div>
        </header>

        <div className="flex shrink-0 items-center gap-2 overflow-hidden pb-2 text-[11px] text-[#6c7086]">
          {logs.slice(-2).map((log, i) => (
            <span key={`${log.time}-${log.module}-${i}`} className="truncate boot">
              <span className="text-[#89dceb]">{log.time}</span>{" "}
              <span className="text-[#f9e2af]">[{log.module}]</span>{" "}
              {log.text}
            </span>
          ))}
          {lastStreamTs && (
            <span className="ml-auto shrink-0 text-[#6c7086]">
              stream {new Date(lastStreamTs).toLocaleTimeString("pt-BR", { hour12: false })}
            </span>
          )}
          {isBusy && <span className="shrink-0 text-[#f9e2af] blink">● busy</span>}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-5">
          {mode === "dashboard" && (
            <DashboardView
              onSelectAnime={(id) => {
                const idx = animes.findIndex((a) => a.id === id);
                if (idx >= 0) { setSelectedIndex(idx); setMode("library"); }
              }}
            />
          )}
          {mode === "calendar" && <CalendarView />}
          {mode === "discover" && (
            <DiscoverView
              selectedAnime={selected}
              onRefreshLibrary={refreshData}
              onOpenSearch={handleDiscoverSearch}
            />
          )}
          {mode === "subtitles" && <SubtitlesView selectedAnime={selected} />}
          {mode === "diagnostics" && <DiagnosticsPanel />}
          {mode === "integrity" && <IntegrityView />}
          {mode === "library" && (
            <LibraryView
              animes={animes}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              isBusy={isBusy}
              queuedCount={queuedCount}
              downloadedTitles={downloadedTitles}
              missingEpisodes={missingEpisodes}
              totalStorage={totalStorage}
              onQueueMissing={handleQueueMissing}
              onQueueMissingAll={handleQueueMissingAll}
              onScan={handleScan}
              onDeleteAnime={handleDeleteFromLibrary}
              onRefresh={refreshData}
              fallbackPosterUrl={libraryFallbackPoster}
              downloads={downloadJobs}
              streamState={streamState}
              onCancelDownload={handleCancelDownload}
              onRetryDownload={handleRetryDownload}
              onRetryFailed={handleRetryFailedBatch}
              onCancelAllDownloads={handleCancelAllActive}
              onRefreshDownloads={refreshDownloads}
              onClearQueueMonitor={handleClearQueueMonitor}
            />
          )}
          {mode === "search" && (
            <SearchView
              query={searchQuery}
              onQueryChange={setSearchQuery}
              source={searchSource}
              onSourceChange={setSearchSource}
              onSearch={handleSearch}
              isBusy={isBusy}
              qbtEnabled={qbtEnabled}
              results={searchResults}
              providerStats={searchProviderStats}
              selectedResult={selectedResult}
              onSelectResult={handleSelectResult}
              kitsuMeta={kitsuMeta}
              isLoadingMeta={isLoadingMeta}
              episodes={episodes}
              selectedEpisodes={selectedEpisodes}
              onToggleEpisode={(episodeKey) =>
                setSelectedEpisodes((cur) =>
                  cur.includes(episodeKey)
                    ? cur.filter((key) => key !== episodeKey)
                    : [...cur, episodeKey]
                )
              }
              onSelectAll={() => setSelectedEpisodes(episodes.map((e) => e.key))}
              onClearAll={() => setSelectedEpisodes([])}
              isLoadingEpisodes={isLoadingEpisodes}
              downloadPath={downloadPath}
              onQueueSelected={handleQueueSelected}
            />
          )}
          {mode === "settings" && (
            <SettingsView onSaved={refreshData} />
          )}
        </div>

        <footer className="flex shrink-0 flex-col gap-1 border-t border-[#45475a] pt-[8px] text-[11px] text-[#6c7086] md:flex-row md:items-center md:justify-between">
          <div>
            <span className="text-[#cba6f7]">anitrackr</span> download-tracker --scan --queue --missing
          </div>
          <div>
            <span className="font-bold text-[#cba6f7]">Tab</span> Switch ·{" "}
            <span className="font-bold text-[#cba6f7]">↑/k ↓/j</span> Navigate ·{" "}
            <span className="font-bold text-[#cba6f7]">d</span> Queue ·{" "}
            <span className="font-bold text-[#cba6f7]">s</span> Scan ·{" "}
            <span className="font-bold text-[#cba6f7]">r</span> Refresh
          </div>
        </footer>
      </div>
      <ConfirmDialog
        open={!!deleteDialogTarget}
        title="Remover Da Biblioteca?"
        message={
          deleteDialogTarget ? (
            <>
              Remover <span className="font-bold text-[#e0e0ed]">{deleteDialogTarget.title}</span> da biblioteca?
              <br />
              <br />
              Isso remove apenas o registro do banco. Arquivos locais nao sao apagados.
            </>
          ) : null
        }
        confirmLabel="Remover"
        cancelLabel="Cancelar"
        busy={isBusy}
        onCancel={() => setDeleteDialogTarget(null)}
        onConfirm={() => void handleConfirmDeleteFromLibrary()}
      />
    </div>
  );
}
