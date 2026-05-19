"use client";

import React, { useMemo, useState } from "react";
import type { DownloadJob } from "@/lib/api";
import { generateAllJellyfinNfo, generateJellyfinNfo, enrichAnimeAnilist, enrichAnimeJikan } from "@/lib/api";
import { Panel, Badge, StatBox, AnimeRow, AnimeView, ActionBtn, ConfirmDialog, generateBar, statusBadgeClass, statusColor } from "./ui";
import { EpisodeList } from "./episode-list";

type Props = {
  animes: AnimeView[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  isBusy: boolean;
  queuedCount: number;
  downloadedTitles: number;
  missingEpisodes: number;
  totalStorage: string;
  onQueueMissing: () => void;
  onQueueMissingAll: () => void;
  onScan: () => void;
  onDeleteAnime: () => void;
  onRefresh: () => void;
  fallbackPosterUrl?: string | null;
  downloads: DownloadJob[];
  streamState: "connecting" | "live" | "fallback";
  onCancelDownload: (id: string) => void;
  onRetryDownload: (id: string) => void;
  onRetryFailed: () => void;
  onCancelAllDownloads: () => void;
  onRefreshDownloads: () => void;
  onClearQueueMonitor: () => void;
};

function fmtSpeed(kbps: number) {
  if (!Number.isFinite(kbps) || kbps <= 0) return "0 KB/s";
  if (kbps >= 1024 * 1024) return `${(kbps / 1024 / 1024).toFixed(2)} GB/s`;
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps)} KB/s`;
}

function fmtSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function LibraryView({
  animes,
  selectedIndex,
  onSelect,
  isBusy,
  queuedCount,
  downloadedTitles,
  missingEpisodes,
  totalStorage,
  onQueueMissing,
  onQueueMissingAll,
  onScan,
  onDeleteAnime,
  onRefresh,
  fallbackPosterUrl,
  downloads,
  streamState,
  onCancelDownload,
  onRetryDownload,
  onRetryFailed,
  onCancelAllDownloads,
  onRefreshDownloads,
  onClearQueueMonitor,
}: Props) {
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState("title");
  const [nfoStatus, setNfoStatus] = useState<string | null>(null);
  const [metaStatus, setMetaStatus] = useState<string | null>(null);
  const [isRunningNfo, setIsRunningNfo] = useState(false);
  const [isRunningMeta, setIsRunningMeta] = useState(false);
  const [queueConfirmAction, setQueueConfirmAction] = useState<"cancel-all" | "clear-monitor" | null>(null);
  const [queueConfirmBusy, setQueueConfirmBusy] = useState(false);

  const filteredAnimes = useMemo(() => {
    const q = filter.toLowerCase();
    const list = q
      ? animes.filter((a) =>
          a.title.toLowerCase().includes(q) ||
          (a.altTitle ?? "").toLowerCase().includes(q)
        )
      : [...animes];
    switch (sortBy) {
      case "progress": list.sort((a, b) => b.progress - a.progress); break;
      case "missing":  list.sort((a, b) => b.missing - a.missing); break;
      case "year":     list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0)); break;
      case "rating":   list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)); break;
      default:         list.sort((a, b) => a.title.localeCompare(b.title)); break;
    }
    return list;
  }, [animes, filter, sortBy]);

  const selected = animes[selectedIndex < animes.length ? selectedIndex : 0] ?? null;
  const progress = selected
    ? Math.min(100, Math.max(0, Math.round((selected.downloaded / Math.max(1, selected.total)) * 100)))
    : 0;

  const activeDownloads = downloads.filter((d) => d.status === "queued" || d.status === "downloading" || d.status === "retry_wait");
  const failedDownloads = downloads.filter((d) => d.status === "failed" || d.status === "cancelled");
  const streamText = streamState === "live" ? "SSE live" : streamState === "fallback" ? "fallback polling" : "connecting";
  const streamClass = streamState === "live" ? "text-[#a6e3a1]" : streamState === "fallback" ? "text-[#f9e2af]" : "text-[#6c7086]";

  async function handleGenerateSelectedNfo() {
    if (!selected) return;
    setIsRunningNfo(true);
    setNfoStatus(`gerando NFO de ${selected.title}...`);
    try {
      const res = await generateJellyfinNfo(selected.id, true);
      const suffix = res.errors.length > 0 ? ` · ${res.errors.length} warning(s)` : "";
      setNfoStatus(`ok: ${res.episodesNfo} episode.nfo + tvshow.nfo${suffix}`);
    } catch (err) {
      setNfoStatus(`erro: ${(err as Error).message}`);
    } finally {
      setIsRunningNfo(false);
    }
  }

  async function handleGenerateAllNfo() {
    setIsRunningNfo(true);
    setNfoStatus("gerando NFO da biblioteca...");
    try {
      const res = await generateAllJellyfinNfo(false);
      setNfoStatus(`ok: ${res.done}/${res.total} titles processed · ${res.episodesNfoTotal} episode.nfo`);
    } catch (err) {
      setNfoStatus(`erro: ${(err as Error).message}`);
    } finally {
      setIsRunningNfo(false);
    }
  }

  async function handleEnrichSelectedJikan() {
    if (!selected) return;
    setIsRunningMeta(true);
      setMetaStatus(`Jikan enrich: ${selected.title}...`);
    try {
      const res = await enrichAnimeJikan(selected.id);
      const total = typeof res.total === "number" ? res.total : res.enriched;
      setMetaStatus(`Jikan ok: ${res.enriched}/${total} episodes${res.message ? ` · ${res.message}` : ""}`);
      onRefresh();
    } catch (err) {
      setMetaStatus(`Jikan erro: ${(err as Error).message}`);
    } finally {
      setIsRunningMeta(false);
    }
  }

  async function handleEnrichSelectedAniList() {
    if (!selected) return;
    setIsRunningMeta(true);
      setMetaStatus(`AniList enrich: ${selected.title}...`);
    try {
      const res = await enrichAnimeAnilist(selected.id);
      if (!res.ok) throw new Error(res.error ?? "falha ao enriquecer");
      setMetaStatus(`AniList ok: id ${res.anilistId ?? "?"}`);
      onRefresh();
    } catch (err) {
      setMetaStatus(`AniList erro: ${(err as Error).message}`);
    } finally {
      setIsRunningMeta(false);
    }
  }

  async function handleConfirmQueueAction() {
    if (!queueConfirmAction) return;
    setQueueConfirmBusy(true);
    try {
      if (queueConfirmAction === "cancel-all") {
        await onCancelAllDownloads();
      } else {
        await onClearQueueMonitor();
      }
      setQueueConfirmAction(null);
    } finally {
      setQueueConfirmBusy(false);
    }
  }

  return (
  <div className="grid h-full w-full gap-[14px] overflow-hidden lg:grid-cols-[45%_1fr] lg:grid-rows-[1fr_300px]">
      <Panel title="Downloads :: Biblioteca Local" focused className="min-h-0">
        <div className="grid grid-cols-2 gap-2 border-b border-dashed border-[#45475a] p-3 md:grid-cols-4">
          <StatBox label="Queued" value={queuedCount} command="queue.len()" />
          <StatBox label="Complete" value={downloadedTitles} command="--done" />
          <StatBox label="Missing eps" value={missingEpisodes} command="scan.diff" />
          <StatBox label="Storage" value={totalStorage} command="du -sh" />
        </div>
        {/* Filtro + Sort */}
        <div className="flex gap-2 border-b border-dashed border-[#45475a] px-3 py-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filtrar..."
            className="flex-1 border border-[#45475a] bg-black/20 px-2 py-1 text-[12px] text-[#e0e0ed] placeholder-[#6c7086] outline-none focus:border-[#cba6f7]"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="border border-[#45475a] bg-[#0f0f14] px-2 text-[12px] text-[#e0e0ed] outline-none focus:border-[#cba6f7]"
          >
            <option value="title">A→Z</option>
            <option value="progress">Progresso</option>
            <option value="missing">Faltando</option>
            <option value="rating">Rating</option>
            <option value="year">Ano</option>
          </select>
        </div>
        <div className="flex items-center justify-between border-b border-dashed border-[#45475a] px-5 py-2 text-[11px] uppercase text-[#6c7086]">
          <span>Titulo {filter && <span className="text-[#cba6f7]">({filteredAnimes.length}/{animes.length})</span>}</span>
          <span className="hidden md:block">Status · Progresso · Eps</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {animes.length === 0 ? (
            <div className="px-4 py-6 text-[13px] text-[#6c7086]">
              Biblioteca vazia. Use a aba <span className="text-[#cba6f7]">[SEARCH]</span> para adicionar animes.
            </div>
          ) : filteredAnimes.length === 0 ? (
            <div className="px-4 py-4 text-[12px] text-[#6c7086]">Nenhum anime encontrado para o filtro atual.</div>
          ) : (
            filteredAnimes.map((anime) => {
              const realIdx = animes.findIndex((a) => a.id === anime.id);
              return (
                <AnimeRow
                  key={anime.id}
                  anime={anime}
                  index={realIdx}
                  selected={realIdx === selectedIndex}
                  onSelect={() => onSelect(realIdx)}
                />
              );
            })
          )}
        </div>
      </Panel>

      <Panel title="Detalhes do Download" className="min-h-0">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[#6c7086]">
            Nenhum anime selecionado
          </div>
        ) : (
          <div className="grid flex-1 min-h-0 gap-4 overflow-y-auto p-4 lg:grid-cols-[200px_1fr]">
            <div className="flex flex-col gap-3">
              {selected.posterUrl || fallbackPosterUrl ? (
                <div className="overflow-hidden border border-dashed border-[#45475a]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selected.posterUrl ?? fallbackPosterUrl ?? ""}
                    alt={selected.title}
                    className="w-full object-cover"
                    style={{ maxHeight: 180 }}
                  />
                </div>
              ) : (
                <pre className="min-h-[120px] overflow-hidden border border-dashed border-[#45475a] bg-black/30 p-2 text-[11px] leading-[1.2] text-[#89dceb] drop-shadow-[0_0_2px_rgba(137,220,235,.5)]">
                  {selected.asciiArt || "   /\\_\\\n  ( o.o )\n   > ^ <\n  /  _  \\\n /_| |_\\_\\"}
                </pre>
              )}
              <div className="space-y-0.5 border border-[#45475a] bg-black/20 p-3 text-[12px] leading-6">
                <div>
                  <span className="text-[#6c7086]">STATUS: </span>
                  <span className={statusColor(selected.status)}>{selected.status}</span>
                </div>
                <div>
                  <span className="text-[#6c7086]">PROVIDER: </span>
                  <span className="text-[#89dceb]">{selected.provider}</span>
                </div>
                <div>
                  <span className="text-[#6c7086]">QUALITY: </span>
                  {selected.quality}
                </div>
                <div>
                  <span className="text-[#6c7086]">SIZE: </span>
                  <span className="text-[#f9e2af]">
                    {selected.sizeGb > 0 ? `${selected.sizeGb.toFixed(1)} GB` : "—"}
                  </span>
                </div>
                {selected.rating != null && (
                  <div>
                    <span className="text-[#6c7086]">SCORE: </span>
                    <span className="text-[#f9e2af]">★ {selected.rating.toFixed(1)}</span>
                  </div>
                )}
                {selected.year && (
                  <div>
                    <span className="text-[#6c7086]">YEAR: </span>
                    <span className="text-[#bac2de]">{selected.year}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <div className="mb-1 text-[11px] uppercase text-[#6c7086]">selected entry</div>
                <h1 className="truncate text-2xl font-extrabold text-[#cba6f7]">{selected.title}</h1>
                {selected.altTitle && (
                  <p className="truncate text-[12px] text-[#6c7086]">{selected.altTitle}</p>
                )}
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <div className="border border-[#45475a] bg-black/20 p-3">
                  <div className="text-[11px] uppercase text-[#6c7086]">Downloaded</div>
                  <div className="mt-1 text-[15px] font-extrabold text-[#a6e3a1]">
                    {generateBar(selected.downloaded, selected.total, 12)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#bac2de]">
                    {selected.downloaded}/{selected.total} eps · {progress}%
                  </div>
                </div>
                <div className="border border-[#45475a] bg-black/20 p-3">
                  <div className="text-[11px] uppercase text-[#6c7086]">Missing</div>
                  <div className="mt-1 text-[15px] font-extrabold text-[#f38ba8]">
                    {selected.missing} eps
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#bac2de]">scan: OK</div>
                </div>
                <div className="border border-[#45475a] bg-black/20 p-3">
                  <div className="text-[11px] uppercase text-[#6c7086]">Next job</div>
                  <div className="mt-1 text-[15px] font-extrabold text-[#f9e2af]">
                    {selected.missing > 0 ? `Ep ${selected.downloaded + 1}` : "Complete"}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1 text-[12px] font-bold text-[#89dceb]">-- LOCAL PATH --</div>
                <div className="border border-[#45475a] bg-black/20 px-3 py-2 text-[12px] text-[#bac2de]">
                  {selected.path || "—"}
                </div>
              </div>

              {selected.tags.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-bold text-[#89dceb]">-- TAGS --</div>
                  <div className="flex flex-wrap gap-1">
                    <Badge className={statusBadgeClass(selected.status)}>{selected.status}</Badge>
                    {selected.tags.slice(0, 6).map((tag, i) => (
                      <Badge
                        key={tag}
                        className={
                          i % 3 === 0
                            ? "bg-[#89dceb] text-[#0f0f14]"
                            : i % 3 === 1
                            ? "bg-[#cba6f7] text-[#0f0f14]"
                            : "bg-[#f9e2af] text-[#0f0f14]"
                        }
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {selected.synopsis && (
                <div>
                  <div className="mb-1 text-[12px] font-bold text-[#89dceb]">-- TRACKER NOTE --</div>
                  <p className="line-clamp-4 border border-[#45475a] bg-black/20 px-3 py-2 text-[12px] leading-[1.6] text-[#6c7086]">
                    {selected.synopsis}
                  </p>
                </div>
              )}

              {/* Episódios individuais */}
              <div>
                <div className="mb-1 text-[12px] font-bold text-[#89dceb]">-- EPISÓDIOS --</div>
                <div className="max-h-[200px] overflow-y-auto border border-[#45475a] bg-black/20 p-2">
                  <EpisodeList animeId={selected.id} />
                </div>
              </div>

              <div className="border border-dashed border-[#45475a] bg-black/20 p-3">
                <div className="mb-2 text-[12px] font-bold text-[#89dceb]">-- JELLYFIN / METADATA --</div>
                <div className="grid gap-2 md:grid-cols-2">
                  <ActionBtn
                    kbd="n"
                    label="Gerar NFO (anime)"
                    onClick={() => void handleGenerateSelectedNfo()}
                    disabled={isBusy || isRunningNfo}
                  />
                  <ActionBtn
                    kbd="N"
                    label="Gerar NFO (biblioteca)"
                    onClick={() => void handleGenerateAllNfo()}
                    disabled={isBusy || isRunningNfo}
                  />
                  <ActionBtn
                    kbd="j"
                    label="Enriquecer episodios (Jikan)"
                    onClick={() => void handleEnrichSelectedJikan()}
                    disabled={isBusy || isRunningMeta}
                  />
                  <ActionBtn
                    kbd="a"
                    label="Enriquecer anime (AniList)"
                    onClick={() => void handleEnrichSelectedAniList()}
                    disabled={isBusy || isRunningMeta}
                  />
                </div>
                {(nfoStatus || metaStatus) && (
                  <div className="mt-2 border border-[#45475a] bg-black/20 px-2 py-1 text-[11px] text-[#bac2de]">
                    {nfoStatus && <div>{nfoStatus}</div>}
                    {metaStatus && <div>{metaStatus}</div>}
                  </div>
                )}
              </div>

              <div className="mt-auto grid gap-2 border border-dashed border-[#45475a] bg-black/20 p-3 text-[12px] md:grid-cols-2">
                <ActionBtn kbd="d" label="Download missing eps" onClick={onQueueMissing} disabled={isBusy} />
                <ActionBtn kbd="b" label="Queue missing all" onClick={onQueueMissingAll} disabled={isBusy} />
                <ActionBtn kbd="s" label="Rescan local folder" onClick={onScan} disabled={isBusy} />
                <ActionBtn kbd="x" label="Delete from library (DB)" onClick={onDeleteAnime} disabled={isBusy} />
                <ActionBtn kbd="r" label="Refresh library" onClick={onRefresh} disabled={isBusy} />
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel title={`Queue Monitor :: ${streamText}`} className="lg:col-span-2 min-h-0">
        <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-dashed border-[#45475a] px-4 py-2 text-[11px]">
          <span className={`font-bold uppercase ${streamClass}`}>{streamText}</span>
          <span className="text-[#6c7086]">active: {activeDownloads.length}</span>
          <span className="text-[#6c7086]">failed/cancelled: {failedDownloads.length}</span>
          <div className="ml-auto flex flex-wrap gap-1">
            <button
              onClick={onRefreshDownloads}
              className="border border-[#45475a] px-2 py-1 text-[#89dceb] hover:bg-[#89dceb] hover:text-[#0f0f14]"
            >
              refresh
            </button>
            <button
              onClick={onRetryFailed}
              className="border border-[#45475a] px-2 py-1 text-[#f9e2af] hover:bg-[#f9e2af] hover:text-[#0f0f14]"
            >
              retry failed
            </button>
            <button
              onClick={() => setQueueConfirmAction("cancel-all")}
              className="border border-[#45475a] px-2 py-1 text-[#f38ba8] hover:bg-[#f38ba8] hover:text-[#0f0f14]"
            >
              cancel all
            </button>
            <button
              onClick={() => setQueueConfirmAction("clear-monitor")}
              className="border border-[#45475a] px-2 py-1 text-[#89dceb] hover:bg-[#89dceb] hover:text-[#0f0f14]"
            >
              clear monitor
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain">
          {downloads.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-[#6c7086]">
              Nenhum job de download registrado ainda.
            </div>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-[#151521] text-left text-[11px] uppercase text-[#6c7086]">
                <tr>
                  <th className="px-3 py-2">Anime</th>
                  <th className="px-3 py-2">Ep</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2">Speed</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {downloads.slice(0, 80).map((job) => {
                  const canCancel = job.status === "queued" || job.status === "downloading" || job.status === "retry_wait";
                  const canRetry = job.status === "failed" || job.status === "cancelled" || job.status === "retry_wait";
                  return (
                    <tr key={job.id} className="border-t border-[#232330]">
                      <td className="max-w-[320px] truncate px-3 py-2 text-[#e0e0ed]" title={job.animeTitle}>
                        {job.animeTitle}
                      </td>
                      <td className="px-3 py-2 text-[#bac2de]">
                        S{String(job.season).padStart(2, "0")}E{String(job.episodeNumber).padStart(2, "0")}
                      </td>
                      <td className={`px-3 py-2 font-bold ${statusColor(job.status)}`}>{job.status}</td>
                      <td className="px-3 py-2 text-[#89dceb]">
                        {job.progress}% · {fmtSize(job.downloadedBytes)}/{fmtSize(job.totalBytes)}
                      </td>
                      <td className="px-3 py-2 text-[#f9e2af]">{fmtSpeed(job.speedKbps)}</td>
                      <td className="px-3 py-2 text-[#bac2de]">
                        {job.attemptCount}/{job.maxAttempts}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            disabled={!canCancel}
                            onClick={() => onCancelDownload(job.id)}
                            className="border border-[#45475a] px-2 py-1 text-[11px] text-[#f38ba8] hover:bg-[#f38ba8] hover:text-[#0f0f14] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            cancel
                          </button>
                          <button
                            disabled={!canRetry}
                            onClick={() => onRetryDownload(job.id)}
                            className="border border-[#45475a] px-2 py-1 text-[11px] text-[#a6e3a1] hover:bg-[#a6e3a1] hover:text-[#0f0f14] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            retry
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </Panel>
      <ConfirmDialog
        open={queueConfirmAction === "cancel-all"}
        title="Cancelar Todos Os Downloads Ativos?"
        message="Isso vai cancelar todos os jobs em queued/downloading/retry_wait da fila atual."
        confirmLabel="Cancelar tudo"
        cancelLabel="Voltar"
        variant="danger"
        busy={queueConfirmBusy}
        onCancel={() => setQueueConfirmAction(null)}
        onConfirm={() => void handleConfirmQueueAction()}
      />
      <ConfirmDialog
        open={queueConfirmAction === "clear-monitor"}
        title="Limpar Monitor Da Fila?"
        message="Isso remove do monitor os registros finalizados (completed/failed/cancelled). Nao apaga arquivos baixados."
        confirmLabel="Limpar monitor"
        cancelLabel="Voltar"
        variant="success"
        busy={queueConfirmBusy}
        onCancel={() => setQueueConfirmAction(null)}
        onConfirm={() => void handleConfirmQueueAction()}
      />
    </div>
  );
}
