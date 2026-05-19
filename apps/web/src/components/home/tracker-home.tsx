"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  fetchLibrary,
  fetchLibrarySummary,
  fetchMetadataSearch,
  fetchSearchProviders,
  queueMissingEpisodes,
  queueMissingForAll,
  retryDownloadById,
  retryFailedDownloads,
  scanAnimeById,
  type BackendHealth,
  type LibraryAnime,
  type LibrarySummary,
} from "@/lib/api";
// Note: fetchDownloads é gerenciado internamente pelo hook useDownloadStream
import { useDownloadStream } from "@/hooks/use-download-stream";
import { useSearchState, inferSeasonNumber } from "@/hooks/use-search-state";
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
    { time: "00:00:00", module: "app", text: "Iniciando AniTrackr v2.1.0..." },
  ]);

  const [downloadPath, setDownloadPath] = useState("");
  const [allowSimulatedDownloads, setAllowSimulatedDownloads] = useState("false");
  const [qbtEnabled, setQbtEnabled] = useState(false);

  const [libraryFallbackPoster, setLibraryFallbackPoster] = useState<string | null>(null);
  const [deleteDialogTarget, setDeleteDialogTarget] = useState<AnimeView | null>(null);

  const pushLog = useCallback((module: string, text: string) => {
    setLogs((cur) => [
      ...cur.slice(-7),
      { time: new Date().toLocaleTimeString("pt-BR", { hour12: false }), module, text },
    ]);
  }, []);

  // ── hooks ──────────────────────────────────────────────────────────────────

  const { downloadJobs, streamState, lastStreamTs, refreshDownloads, queuedCount } =
    useDownloadStream(pushLog);

  const {
    searchQuery, setSearchQuery,
    searchSource, setSearchSource,
    searchResults, searchProviderStats,
    selectedResult, kitsuMeta, isLoadingMeta,
    episodes, selectedEpisodes, isLoadingEpisodes,
    runSearch, handleSelectResult,
    toggleEpisode, selectAllEpisodes, clearAllEpisodes,
  } = useSearchState(pushLog);

  // ── library data ───────────────────────────────────────────────────────────

  const refreshData = useCallback(async () => {
    setIsBusy(true);
    try {
      const [health, provRes, libRes, sumRes, statsRes, cfgRes] = await Promise.all([
        fetchBackendHealth(),
        fetchSearchProviders(),
        fetchLibrary(),
        fetchLibrarySummary(),
        fetchDownloadStats(),
        fetchConfig(),
      ]);
      setBackendHealth(health);
      setProviders(provRes.providers.map((p) => p.key ?? p.id ?? "?"));
      setAnimes(libRes.animes.map(mapAnime));
      setSummary(sumRes);
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
    const timer = setTimeout(() => { void refreshData(); }, 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // backendStatus derivado: SSE live sempre implica online
  const effectiveBackendStatus = streamState === "live" ? "online" : backendStatus;

  const selected = animes[selectedIndex < animes.length ? selectedIndex : 0] ?? null;

  // Poster fallback via Kitsu para animes sem poster
  useEffect(() => {
    let active = true;
    if (!selected || selected.posterUrl) {
      queueMicrotask(() => { if (active) setLibraryFallbackPoster(null); });
      return;
    }
    fetchMetadataSearch(selected.title, "kitsu")
      .then((res) => { if (active) setLibraryFallbackPoster(res.results?.[0]?.posterUrl ?? null); })
      .catch(() => { if (active) setLibraryFallbackPoster(null); });
    return () => { active = false; };
  }, [selected]);

  // ── keyboard shortcuts ─────────────────────────────────────────────────────

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
      if (["ArrowDown", "j"].includes(e.key)) { e.preventDefault(); setSelectedIndex((i) => Math.min(animes.length - 1, i + 1)); return; }
      if (["ArrowUp", "k"].includes(e.key)) { e.preventDefault(); setSelectedIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === "d" && !isBusy) { e.preventDefault(); void handleQueueMissing(); return; }
      if (e.key === "b" && !isBusy) { e.preventDefault(); void handleQueueMissingAll(); return; }
      if (e.key === "s" && !isBusy) { e.preventDefault(); void handleScan(); return; }
      if (e.key === "x" && !isBusy) { e.preventDefault(); handleDeleteFromLibrary(); return; }
      if (e.key === "r" && !isBusy) { e.preventDefault(); void refreshData(); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, animes.length, isBusy, selected, deleteDialogTarget]);

  // ── library handlers ───────────────────────────────────────────────────────

  async function handleQueueMissing() {
    if (!selected) return;
    setIsBusy(true);
    try {
      const res = await queueMissingEpisodes(selected.id);
      pushLog("queue", `${selected.title}: ${res.queued} eps na fila`);
      await refreshData();
    } catch (e) { pushLog("queue", `erro: ${(e as Error).message}`); }
    finally { setIsBusy(false); }
  }

  async function handleQueueMissingAll() {
    setIsBusy(true);
    try {
      const res = await queueMissingForAll();
      pushLog("queue", `missing-all: ${res.totalQueued} enfileirados`);
      await refreshData();
    } catch (e) { pushLog("queue", `erro: ${(e as Error).message}`); }
    finally { setIsBusy(false); }
  }

  async function handleScan() {
    if (!selected) return;
    setIsBusy(true);
    try {
      const res = await scanAnimeById(selected.id);
      pushLog("scan", `${selected.title}: ${res.foundFiles ?? 0} arquivos`);
      await refreshData();
    } catch (e) { pushLog("scan", `erro: ${(e as Error).message}`); }
    finally { setIsBusy(false); }
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
      if (res?.error) pushLog("library", `erro ao deletar: ${res.error}`);
      else { pushLog("library", `removido: ${target.title}`); await refreshData(); }
    } catch (e) { pushLog("library", `erro ao deletar: ${(e as Error).message}`); }
    finally { setIsBusy(false); }
  }

  async function handleCancelDownload(id: string) {
    try { await cancelDownloadById(id); pushLog("queue", `cancelado: ${id.slice(0, 8)}`); await refreshDownloads(); }
    catch (e) { pushLog("queue", `cancel erro: ${(e as Error).message}`); }
  }

  async function handleRetryDownload(id: string) {
    try { await retryDownloadById(id); pushLog("queue", `retry: ${id.slice(0, 8)}`); await refreshDownloads(); }
    catch (e) { pushLog("queue", `retry erro: ${(e as Error).message}`); }
  }

  async function handleRetryFailedBatch() {
    try { const res = await retryFailedDownloads(50); pushLog("queue", `retry em lote: ${res.retried}/${res.requested}`); await refreshDownloads(); }
    catch (e) { pushLog("queue", `retry-lote erro: ${(e as Error).message}`); }
  }

  async function handleCancelAllActive() {
    try { const res = await cancelAllDownloads(); pushLog("queue", `cancel all: ${res.cancelled}`); await refreshDownloads(); }
    catch (e) { pushLog("queue", `cancel-all erro: ${(e as Error).message}`); }
  }

  async function handleClearQueueMonitor() {
    try { const res = await clearQueueMonitor(); pushLog("queue", `monitor limpo: removidos ${res.removed}`); await refreshDownloads(); }
    catch (e) { pushLog("queue", `clear-monitor erro: ${(e as Error).message}`); }
  }

  // ── search handlers ────────────────────────────────────────────────────────

  async function handleSearch() {
    setIsBusy(true);
    try { await runSearch(searchQuery, searchSource); }
    finally { setIsBusy(false); }
  }

  async function handleDiscoverSearch(title: string) {
    const normalized = title.trim();
    if (!normalized) return;
    setSearchQuery(normalized);
    setSearchSource("all");
    setMode("search");
    setIsBusy(true);
    try { await runSearch(normalized, "all"); }
    finally { setIsBusy(false); }
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
      } catch (e) { pushLog("torrent", `erro: ${(e as Error).message}`); }
      finally { setIsBusy(false); }
      return;
    }

    try {
      const selectedSet = new Set(selectedEpisodes);
      const selectedEntries = episodes
        .filter((ep) => selectedSet.has(ep.key))
        .sort((a, b) => a.number - b.number);

      const enqueueTargets = new Map<string, { number: number; sourceUrl: string }>();
      for (const episode of selectedEntries) {
        const sourceUrl = episode.url || selectedResult.url || "";
        if (!sourceUrl) continue;
        const key = `${episode.number}::${sourceUrl}`;
        if (!enqueueTargets.has(key)) enqueueTargets.set(key, { number: episode.number, sourceUrl });
      }

      if (enqueueTargets.size === 0) throw new Error("Nenhum episódio com URL válida para enfileirar.");

      const inferredSeason = inferSeasonNumber(selectedResult.title, kitsuMeta?.title, kitsuMeta?.altTitle);

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
      if (lib.reused) pushLog("library", `${selectedResult.title}: reutilizado registro existente`);

      let queuedCount = 0;
      for (const target of enqueueTargets.values()) {
        const res = await enqueueEpisodes({ animeId: lib.id, episodes: [target.number], season: inferredSeason, sourceUrl: target.sourceUrl });
        queuedCount += res.queued ?? 0;
      }

      pushLog("queue", `${selectedResult.title}: ${queuedCount}/${enqueueTargets.size} eps enfileirados`);
      await refreshData();
      setMode("library");
    } catch (e) { pushLog("queue", `erro: ${(e as Error).message}`); }
    finally { setIsBusy(false); }
  }

  // ── derived state ──────────────────────────────────────────────────────────

  const byStatus = useMemo(() => {
    if (!summary?.byStatus) return {} as Record<string, number>;
    return Object.fromEntries(Object.entries(summary.byStatus).map(([k, v]) => [k.toLowerCase(), v])) as Record<string, number>;
  }, [summary]);

  const downloadedTitles = byStatus.downloaded ?? 0;
  const missingEpisodes = summary?.missingEpisodes ?? 0;
  const totalStorage = summary ? fmtGb(summary.totalStorageGb) : "0.0 GB";
  const providerBadges = useMemo(() => providers.slice(0, 4), [providers]);

  const statusColor = effectiveBackendStatus === "online" ? "text-[#a6e3a1]" : effectiveBackendStatus === "offline" ? "text-[#f38ba8]" : "text-[#f9e2af]";
  const streamLabel = streamState === "live" ? "live" : streamState === "fallback" ? "polling" : "connecting";
  const streamLabelClass = streamState === "live" ? "text-[#a6e3a1]" : streamState === "fallback" ? "text-[#f9e2af]" : "text-[#6c7086]";
  const runtimeModeLabel = allowSimulatedDownloads === "true" ? "sim-on" : "real-only";
  const runtimeModeClass = allowSimulatedDownloads === "true" ? "text-[#f9e2af]" : "text-[#a6e3a1]";

  // ── render ─────────────────────────────────────────────────────────────────

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

      <div className="flex h-full flex-col gap-2 rounded-md border border-[#45475a] bg-[#0f0f14] p-2 shadow-[0_20px_50px_rgba(0,0,0,.8),inset_0_0_100px_rgba(0,0,0,.5)]">
        <header className="flex shrink-0 flex-col gap-2 border-b border-[#2a2a38] pb-2 text-[13px]">
          <div className="font-extrabold tracking-[1px] text-[#cba6f7] drop-shadow-[0_0_4px_rgba(203,166,247,.35)]">
            ANITRACKR-DOWNLOAD-TRACKER v2.1.0<span className="blink ml-1">_</span>
          </div>

          <nav className="order-3 flex gap-1 overflow-x-auto pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                className={`border px-2 py-[5px] text-[10px] font-bold uppercase tracking-[0.1em] whitespace-nowrap ${
                  mode === m
                    ? "border-[#cba6f7] bg-[#cba6f7] text-[#0f0f14]"
                    : "border-[#45475a] text-[#6c7086] hover:border-[#cba6f7] hover:text-[#cba6f7]"
                }`}
              >
                [{label}]
              </button>
            ))}
          </nav>

          <div className="order-2 flex flex-wrap items-center gap-1.5 rounded-sm border border-[#2a2a38] bg-[#0b0b11] px-2 py-1.5 text-[10px] uppercase tracking-[0.1em] text-[#6c7086]">
            {providerBadges.map((p) => (
              <span key={p} className="border border-[#232332] px-[6px] py-[2px] uppercase">[{p}]</span>
            ))}
            <span className="mr-1.5">
              API: <span className={`font-bold ${statusColor}`}>{effectiveBackendStatus}</span>
              {backendHealth ? ` v${backendHealth.version}` : ""}
            </span>
            <span className="mr-1.5">
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2 sm:pt-5">
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
              onToggleEpisode={toggleEpisode}
              onSelectAll={selectAllEpisodes}
              onClearAll={clearAllEpisodes}
              isLoadingEpisodes={isLoadingEpisodes}
              downloadPath={downloadPath}
              onQueueSelected={handleQueueSelected}
            />
          )}
          {mode === "settings" && (
            <SettingsView onSaved={refreshData} />
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[#45475a] pt-[8px] text-[11px] text-[#6c7086]">
          <div>
            <span className="text-[#cba6f7]">anitrackr</span>
            <span className="hidden sm:inline"> download-tracker --scan --queue --missing</span>
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <span className="font-bold text-[#cba6f7]">Tab</span> Switch ·{" "}
            <span className="font-bold text-[#cba6f7]">↑/k ↓/j</span> Nav ·{" "}
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
              <br /><br />
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
