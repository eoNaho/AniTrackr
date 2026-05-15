"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
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
  saveConfig,
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
import { AnimeView } from "./ui";
import { LibraryView } from "./library-view";
import { SearchView } from "./search-view";
import { SettingsView } from "./settings-view";

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
  };
}

type Mode = "library" | "search" | "settings";
type LogEntry = { time: string; module: string; text: string };
type StreamState = "connecting" | "live" | "fallback";

export function TrackerHome() {
  const [mode, setMode] = useState<Mode>("library");
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [backendStatus, setBackendStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [providers, setProviders] = useState<string[]>([]);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [animes, setAnimes] = useState<AnimeView[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: "00:00:00", module: "app", text: "Iniciando GoAnime Tracker v2.0.1..." },
  ]);

  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [lastStreamTs, setLastStreamTs] = useState<number | null>(null);

  const [downloadPath, setDownloadPath] = useState("");
  const [quality, setQuality] = useState("1080p");
  const [maxConcurrent, setMaxConcurrent] = useState("3");
  const [namingScheme, setNamingScheme] = useState("jellyfin");
  const [ytDlpPath, setYtDlpPath] = useState("yt-dlp");
  const [ffmpegPath, setFfmpegPath] = useState("ffmpeg");
  const [allowSimulatedDownloads, setAllowSimulatedDownloads] = useState("false");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchSource, setSearchSource] = useState("all");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [kitsuMeta, setKitsuMeta] = useState<KitsuMetadata | null>(null);
  const [libraryFallbackPoster, setLibraryFallbackPoster] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<{ number: number; label: string; url: string }[]>([]);
  const [selectedEpisodes, setSelectedEpisodes] = useState<number[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);

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
      setQuality(cfgRes.quality ?? "1080p");
      setMaxConcurrent(cfgRes.max_concurrent ?? "3");
      setNamingScheme(cfgRes.naming_scheme ?? "jellyfin");
      setYtDlpPath(cfgRes.yt_dlp_path ?? "yt-dlp");
      setFfmpegPath(cfgRes.ffmpeg_path ?? "ffmpeg");
      setAllowSimulatedDownloads(cfgRes.allow_simulated_downloads ?? "false");
      const statsByStatus = (statsRes as { byStatus?: Record<string, number> }).byStatus;
      pushLog("api", `online v${health.version} | queued: ${String(statsByStatus?.queued ?? 0)}`);
    } catch (err) {
      setBackendStatus("offline");
      pushLog("api", `erro: ${(err as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }, [pushLog]);

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

  const hasActiveDownloads = useMemo(
    () => downloadJobs.some((j) => j.status === "queued" || j.status === "downloading" || j.status === "retry_wait"),
    [downloadJobs]
  );

  useEffect(() => {
    if (!hasActiveDownloads) return;
    const timer = setInterval(() => {
      void refreshDownloads();
    }, streamState === "live" ? 5000 : 2000);
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
      if (e.key === "r" && !isBusy) {
        e.preventDefault();
        void refreshData();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, animes.length, isBusy, selected]);

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

  async function handleDeleteFromLibrary() {
    if (!selected) return;
    const confirmed = window.confirm(
      `Remover "${selected.title}" da biblioteca?\n\nIsso remove o registro do banco (nao apaga arquivos locais).`
    );
    if (!confirmed) return;

    setIsBusy(true);
    try {
      const res = await deleteLibraryAnime(selected.id);
      if (res?.error) {
        pushLog("library", `erro ao deletar: ${res.error}`);
      } else {
        pushLog("library", `removido: ${selected.title}`);
        await refreshData();
      }
    } catch (e) {
      pushLog("library", `erro ao deletar: ${(e as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSavePath() {
    try {
      await saveConfig({
        download_path: downloadPath,
        quality,
        max_concurrent: maxConcurrent,
        naming_scheme: namingScheme,
        yt_dlp_path: ytDlpPath,
        ffmpeg_path: ffmpegPath,
        allow_simulated_downloads: allowSimulatedDownloads,
      });
      pushLog("config", "config de download atualizada");
    } catch (e) {
      pushLog("config", `erro: ${(e as Error).message}`);
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
    if (searchQuery.trim().length < 2) return;
    setIsBusy(true);
    setSearchResults([]);
    setSelectedResult(null);
    setKitsuMeta(null);
    setEpisodes([]);
    setSelectedEpisodes([]);
    try {
      const res = await searchAnime(searchQuery.trim(), searchSource);
      setSearchResults(res.results ?? []);
      pushLog("search", `"${searchQuery}" -> ${res.results?.length ?? 0} resultados`);
    } catch (e) {
      pushLog("search", `erro: ${(e as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSelectResult(result: SearchResult) {
    setSelectedResult(result);
    setEpisodes([]);
    setSelectedEpisodes([]);
    setKitsuMeta(null);
    setIsLoadingMeta(true);
    setIsLoadingEpisodes(true);

    fetchMetadataSearch(result.title, "kitsu")
      .then((res) => {
        if (res.results?.length) {
          setKitsuMeta(res.results[0]);
          pushLog("meta", `kitsu: ${res.results[0].title}`);
        } else {
          pushLog("meta", "kitsu: sem resultado");
        }
      })
      .catch(() => pushLog("meta", "kitsu: falha"))
      .finally(() => setIsLoadingMeta(false));

    searchEpisodes({ provider: result.provider ?? searchSource, url: result.url, allAnimeId: result.allAnimeId ?? result.id })
      .then((res) => {
        const eps = res.episodes ?? [];
        setEpisodes(eps);
        setSelectedEpisodes(eps.slice(0, 1).map((e) => e.number));
        pushLog("search", `${result.title}: ${res.total} eps`);
      })
      .catch((e) => pushLog("search", `eps erro: ${(e as Error).message}`))
      .finally(() => setIsLoadingEpisodes(false));
  }

  async function handleQueueSelected() {
    if (!selectedResult || selectedEpisodes.length === 0) return;
    setIsBusy(true);
    try {
      const selectedSorted = [...selectedEpisodes].sort((a, b) => a - b);
      const episodeUrlByNumber = new Map(episodes.map((ep) => [ep.number, ep.url]));

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
      });

      let queuedCount = 0;
      for (const epNumber of selectedSorted) {
        const episodeSourceUrl = episodeUrlByNumber.get(epNumber) ?? selectedResult.url;
        if (!episodeSourceUrl) {
          pushLog("queue", `ep ${epNumber}: sem URL de source`);
          continue;
        }

        await enqueueEpisodes({
          animeId: lib.id,
          episodes: [epNumber],
          sourceUrl: episodeSourceUrl,
        });
        queuedCount += 1;
      }

      if (queuedCount === 0) {
        throw new Error("Nenhum episodio foi enfileirado (URLs invalidas).");
      }

      pushLog("queue", `${selectedResult.title}: ${queuedCount} eps enfileirados`);
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
        <header className="flex flex-col gap-2 text-[14px] md:flex-row md:items-center md:justify-between">
          <div className="font-extrabold tracking-[1px] text-[#cba6f7] drop-shadow-[0_0_4px_rgba(203,166,247,.35)]">
            GOANIME-DOWNLOAD-TRACKER v2.0.1<span className="blink ml-1">_</span>
          </div>

          <nav className="flex gap-1">
            {(["library", "search", "settings"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`border px-3 py-1 text-[12px] font-bold uppercase ${
                  mode === m
                    ? "border-[#cba6f7] bg-[#cba6f7] text-[#0f0f14]"
                    : "border-[#45475a] text-[#6c7086] hover:border-[#cba6f7] hover:text-[#cba6f7]"
                }`}
              >
                [{m === "settings" ? "⚙ config" : m}]
              </button>
            ))}
          </nav>

          <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#6c7086]">
            {providerBadges.map((p) => (
              <span key={p} className="uppercase">[{p}]</span>
            ))}
            <span>
              API: <span className={`font-bold ${statusColor}`}>{backendStatus}</span>
              {backendHealth ? ` v${backendHealth.version}` : ""}
            </span>
            <span>
              DL: <span className={`font-bold uppercase ${streamLabelClass}`}>{streamLabel}</span>
            </span>
          </div>
        </header>

        <div className="flex shrink-0 items-center gap-2 overflow-hidden border-b border-[#45475a] pb-2 text-[11px] text-[#6c7086]">
          {logs.slice(-2).map((log, i) => (
            <span key={i} className="truncate boot">
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
              results={searchResults}
              selectedResult={selectedResult}
              onSelectResult={handleSelectResult}
              kitsuMeta={kitsuMeta}
              isLoadingMeta={isLoadingMeta}
              episodes={episodes}
              selectedEpisodes={selectedEpisodes}
              onToggleEpisode={(n) =>
                setSelectedEpisodes((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]))
              }
              onSelectAll={() => setSelectedEpisodes(episodes.map((e) => e.number))}
              onClearAll={() => setSelectedEpisodes([])}
              isLoadingEpisodes={isLoadingEpisodes}
              downloadPath={downloadPath}
              onDownloadPathChange={setDownloadPath}
              quality={quality}
              onQualityChange={setQuality}
              maxConcurrent={maxConcurrent}
              onMaxConcurrentChange={setMaxConcurrent}
              namingScheme={namingScheme}
              onNamingSchemeChange={setNamingScheme}
              ytDlpPath={ytDlpPath}
              onYtDlpPathChange={setYtDlpPath}
              ffmpegPath={ffmpegPath}
              onFfmpegPathChange={setFfmpegPath}
              allowSimulatedDownloads={allowSimulatedDownloads}
              onAllowSimulatedDownloadsChange={setAllowSimulatedDownloads}
              onSavePath={handleSavePath}
              onQueueSelected={handleQueueSelected}
            />
          )}
          {mode === "settings" && (
            <SettingsView onSaved={refreshData} />
          )}
        </div>

        <footer className="flex shrink-0 flex-col gap-1 border-t border-[#45475a] pt-[8px] text-[11px] text-[#6c7086] md:flex-row md:items-center md:justify-between">
          <div>
            <span className="text-[#cba6f7]">goanime</span> download-tracker --scan --queue --missing
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
    </div>
  );
}
