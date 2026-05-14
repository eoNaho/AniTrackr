"use client";

import React from "react";
import { Panel } from "./ui";
import type { KitsuMetadata, SearchResult } from "@/lib/api";

type Episode = { number: number; label: string; url: string };

type Props = {
  // search inputs
  query: string;
  onQueryChange: (v: string) => void;
  source: string;
  onSourceChange: (v: string) => void;
  onSearch: () => void;
  isBusy: boolean;

  // results
  results: SearchResult[];
  selectedResult: SearchResult | null;
  onSelectResult: (r: SearchResult) => void;

  // kitsu metadata
  kitsuMeta: KitsuMetadata | null;
  isLoadingMeta: boolean;

  // episodes
  episodes: Episode[];
  selectedEpisodes: number[];
  onToggleEpisode: (n: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  isLoadingEpisodes: boolean;

  // download path
  downloadPath: string;
  onDownloadPathChange: (v: string) => void;
  quality: string;
  onQualityChange: (v: string) => void;
  maxConcurrent: string;
  onMaxConcurrentChange: (v: string) => void;
  namingScheme: string;
  onNamingSchemeChange: (v: string) => void;
  ytDlpPath: string;
  onYtDlpPathChange: (v: string) => void;
  ffmpegPath: string;
  onFfmpegPathChange: (v: string) => void;
  allowSimulatedDownloads: string;
  onAllowSimulatedDownloadsChange: (v: string) => void;
  onSavePath: () => void;

  // queue
  onQueueSelected: () => void;
};

export function SearchView({
  query, onQueryChange, source, onSourceChange, onSearch, isBusy,
  results, selectedResult, onSelectResult,
  kitsuMeta, isLoadingMeta,
  episodes, selectedEpisodes, onToggleEpisode, onSelectAll, onClearAll, isLoadingEpisodes,
  downloadPath, onDownloadPathChange,
  quality, onQualityChange,
  maxConcurrent, onMaxConcurrentChange,
  namingScheme, onNamingSchemeChange,
  ytDlpPath, onYtDlpPathChange,
  ffmpegPath, onFfmpegPathChange,
  allowSimulatedDownloads, onAllowSimulatedDownloadsChange,
  onSavePath,
  onQueueSelected,
}: Props) {
  const canQueue = !isBusy && !!selectedResult && selectedEpisodes.length > 0 && downloadPath.trim().length > 0;

  return (
    <div className="flex flex-1 flex-col gap-[20px] overflow-visible">
      {/* ── Search bar ── */}
      <Panel title="Search :: Buscar Anime">
        <div className="flex flex-col gap-2 p-3 md:flex-row">
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="Digite o nome do anime..."
            className="flex-1 border border-[#45475a] bg-black/20 px-3 py-2 text-[13px] text-[#e0e0ed] placeholder-[#6c7086] outline-none focus:border-[#cba6f7]"
          />
          <select
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
            className="border border-[#45475a] bg-[#0f0f14] px-2 py-2 text-[13px] text-[#e0e0ed] outline-none focus:border-[#cba6f7]"
          >
            <option value="all">all providers</option>
            <option value="animefire">animefire</option>
            <option value="goyabu">goyabu</option>
            <option value="allanime">allanime</option>
          </select>
          <button
            onClick={onSearch}
            disabled={isBusy || query.trim().length < 2}
            className="border border-[#45475a] px-4 py-2 text-[13px] font-bold text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#0f0f14] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBusy ? "..." : "BUSCAR"}
          </button>
        </div>
      </Panel>

      {/* ── Results list + Metadata detail ── */}
      <div className="grid flex-1 gap-[14px] overflow-hidden md:grid-cols-[280px_1fr]">
        {/* Left: results */}
        <Panel title="Resultados" className="flex flex-col min-h-0">
          <div className="flex-1 overflow-auto">
            {results.length === 0 ? (
              <div className="px-4 py-6 text-[12px] text-[#6c7086]">
                Nenhum resultado. Digite e pressione BUSCAR ou Enter.
              </div>
            ) : (
              results.map((r, i) => (
                <button
                  key={`${r.title}-${i}`}
                  onClick={() => onSelectResult(r)}
                  className={`w-full border-b border-[#232330] px-3 py-2 text-left hover:bg-white/5 ${
                    selectedResult?.title === r.title
                      ? "bg-[#cba6f7] text-[#0f0f14]"
                      : ""
                  }`}
                >
                  <div className="truncate text-[13px] font-bold">{r.title}</div>
                  <div className="text-[11px] opacity-70">{r.provider ?? source}</div>
                </button>
              ))
            )}
          </div>
        </Panel>

        {/* Right: Kitsu metadata + episodes + path + queue */}
        <Panel
          title={selectedResult ? `Detalhes :: ${selectedResult.title}` : "Detalhes :: Selecione um resultado"}
          focused={!!selectedResult}
          className="flex flex-col min-h-0"
        >
          {!selectedResult ? (
            <div className="flex h-full items-center justify-center text-[13px] text-[#6c7086]">
              ← Selecione um resultado para ver detalhes
            </div>
          ) : (
            <div className="grid h-full gap-4 overflow-auto p-4 lg:grid-cols-[200px_1fr]">
              {/* Left column: poster + meta numbers */}
              <div className="flex flex-col gap-3">
                {isLoadingMeta ? (
                  <div className="flex min-h-[160px] items-center justify-center border border-dashed border-[#45475a] text-[12px] text-[#6c7086]">
                    carregando...
                  </div>
                ) : kitsuMeta?.posterUrl ? (
                  <div className="border border-dashed border-[#45475a] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={kitsuMeta.posterUrl}
                      alt={kitsuMeta.title}
                      className="w-full object-cover"
                      style={{ maxHeight: 200 }}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-[120px] items-center justify-center border border-dashed border-[#45475a] text-[11px] text-[#6c7086]">
                    sem poster
                  </div>
                )}

                {kitsuMeta && (
                  <div className="border border-[#45475a] bg-black/20 p-3 text-[12px] space-y-1">
                    <div>
                      <span className="text-[#6c7086]">RATING: </span>
                      <span className="text-[#f9e2af] font-bold">
                        {kitsuMeta.rating ? kitsuMeta.rating.toFixed(1) : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#6c7086]">YEAR: </span>
                      <span className="text-[#89dceb]">{kitsuMeta.year ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-[#6c7086]">TYPE: </span>
                      <span className="text-[#cba6f7]">{kitsuMeta.subtype ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-[#6c7086]">EPS: </span>
                      <span className="text-[#a6e3a1] font-bold">
                        {kitsuMeta.episodeCount ?? "?"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#6c7086]">STATUS: </span>
                      <span className="text-[#bac2de]">{kitsuMeta.status ?? "—"}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Right column: title, synopsis, episodes, path, queue */}
              <div className="flex min-w-0 flex-col gap-3">
                <div>
                  <div className="mb-1 text-[11px] uppercase text-[#6c7086]">
                    {isLoadingMeta ? "buscando metadados kitsu..." : "metadata :: kitsu"}
                  </div>
                  <h2 className="truncate text-xl font-extrabold text-[#cba6f7]">
                    {kitsuMeta?.title ?? selectedResult.title}
                  </h2>
                  {kitsuMeta?.altTitle && (
                    <p className="truncate text-[12px] text-[#6c7086]">{kitsuMeta.altTitle}</p>
                  )}
                </div>

                {kitsuMeta?.synopsis && (
                  <div>
                    <div className="mb-1 text-[12px] font-bold text-[#89dceb]">-- SYNOPSIS --</div>
                    <p className="border-l-2 border-[#45475a] bg-black/20 px-3 py-2 text-[12px] leading-[1.6] text-[#6c7086] line-clamp-5">
                      {kitsuMeta.synopsis}
                    </p>
                  </div>
                )}

                {/* Episodes */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-[#89dceb]">
                    <span>
                      -- EPISÓDIOS{" "}
                      {episodes.length > 0 && (
                        <span className="text-[#6c7086] font-normal">
                          ({selectedEpisodes.length}/{episodes.length} selecionados)
                        </span>
                      )}
                    </span>
                    {episodes.length > 0 && (
                      <span className="flex gap-2 text-[11px] font-normal">
                        <button onClick={onSelectAll} className="text-[#cba6f7] hover:underline">todos</button>
                        <button onClick={onClearAll} className="text-[#6c7086] hover:underline">nenhum</button>
                      </span>
                    )}
                  </div>
                  <div className="max-h-[160px] overflow-auto border border-[#45475a] bg-black/20 p-2">
                    {isLoadingEpisodes ? (
                      <div className="py-3 text-center text-[12px] text-[#6c7086]">
                        carregando episódios...
                      </div>
                    ) : episodes.length === 0 ? (
                      <div className="py-3 text-center text-[12px] text-[#6c7086]">
                        Nenhum episódio encontrado
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 md:grid-cols-3">
                        {episodes.map((ep) => (
                          <label
                            key={ep.number}
                            className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[12px] hover:text-[#cba6f7]"
                          >
                            <input
                              type="checkbox"
                              checked={selectedEpisodes.includes(ep.number)}
                              onChange={() => onToggleEpisode(ep.number)}
                              className="accent-[#cba6f7]"
                            />
                            <span>{ep.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Download path */}
                <div>
                  <div className="mb-1 text-[12px] font-bold text-[#89dceb]">-- CONFIG DOWNLOAD --</div>
                  <div className="flex gap-2 mb-2">
                    <input
                      value={downloadPath}
                      onChange={(e) => onDownloadPathChange(e.target.value)}
                      placeholder="/downloads/anime  ou  C:\Anime"
                      className="flex-1 border border-[#45475a] bg-black/20 px-2 py-2 text-[12px] text-[#e0e0ed] placeholder-[#6c7086] outline-none focus:border-[#cba6f7]"
                    />
                    <button
                      onClick={onSavePath}
                      className="border border-[#45475a] px-3 py-1 text-[12px] text-[#89dceb] hover:bg-[#89dceb] hover:text-[#0f0f14]"
                    >
                      Salvar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input value={quality} onChange={(e) => onQualityChange(e.target.value)} placeholder="quality (ex: 1080p)" className="border border-[#45475a] bg-black/20 px-2 py-2 text-[12px]" />
                    <input value={maxConcurrent} onChange={(e) => onMaxConcurrentChange(e.target.value)} placeholder="max_concurrent (ex: 3)" className="border border-[#45475a] bg-black/20 px-2 py-2 text-[12px]" />
                    <select value={namingScheme} onChange={(e) => onNamingSchemeChange(e.target.value)} className="border border-[#45475a] bg-black/20 px-2 py-2 text-[12px]">
                      <option value="jellyfin">naming: jellyfin</option>
                      <option value="plex">naming: plex</option>
                      <option value="simple">naming: simple</option>
                    </select>
                    <select value={allowSimulatedDownloads} onChange={(e) => onAllowSimulatedDownloadsChange(e.target.value)} className="border border-[#45475a] bg-black/20 px-2 py-2 text-[12px]">
                      <option value="false">simulated_downloads: false</option>
                      <option value="true">simulated_downloads: true</option>
                    </select>
                    <input value={ytDlpPath} onChange={(e) => onYtDlpPathChange(e.target.value)} placeholder="yt_dlp_path (ex: yt-dlp)" className="border border-[#45475a] bg-black/20 px-2 py-2 text-[12px]" />
                    <input value={ffmpegPath} onChange={(e) => onFfmpegPathChange(e.target.value)} placeholder="ffmpeg_path (ex: ffmpeg)" className="border border-[#45475a] bg-black/20 px-2 py-2 text-[12px]" />
                  </div>
                  {downloadPath.trim().length === 0 && (
                    <p className="mt-1 text-[11px] text-[#f38ba8]">
                      ⚠ Defina a pasta antes de baixar
                    </p>
                  )}
                </div>

                {/* Queue button */}
                <button
                  onClick={onQueueSelected}
                  disabled={!canQueue}
                  className="mt-auto border border-[#cba6f7] bg-[#cba6f7]/10 px-4 py-3 text-[13px] font-bold text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#0f0f14] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isBusy
                    ? "aguarde..."
                    : `▶ ENFILEIRAR ${selectedEpisodes.length} EPISÓDIO${selectedEpisodes.length !== 1 ? "S" : ""}`}
                </button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
