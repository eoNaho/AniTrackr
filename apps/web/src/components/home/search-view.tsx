"use client";

import React from "react";
import { Panel } from "./ui";
import type { KitsuMetadata, SearchResult, ProviderSearchStat } from "@/lib/api";

type Episode = { key: string; number: number; label: string; url: string };

type Props = {
  query: string;
  onQueryChange: (v: string) => void;
  source: string;
  onSourceChange: (v: string) => void;
  onSearch: () => void;
  isBusy: boolean;

  results: SearchResult[];
  providerStats: Record<string, ProviderSearchStat> | null;
  selectedResult: SearchResult | null;
  onSelectResult: (r: SearchResult) => void;

  kitsuMeta: KitsuMetadata | null;
  isLoadingMeta: boolean;

  episodes: Episode[];
  selectedEpisodes: string[];
  onToggleEpisode: (episodeKey: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  isLoadingEpisodes: boolean;

  downloadPath: string; // read-only — configurar em Settings
  onQueueSelected: () => void;
};

export function SearchView({
  query, onQueryChange, source, onSourceChange, onSearch, isBusy,
  results, providerStats, selectedResult, onSelectResult,
  kitsuMeta, isLoadingMeta,
  episodes, selectedEpisodes, onToggleEpisode, onSelectAll, onClearAll, isLoadingEpisodes,
  downloadPath,
  onQueueSelected,
}: Props) {
  const canQueue = !isBusy && !!selectedResult && selectedEpisodes.length > 0 && downloadPath.trim().length > 0;

  return (
    <div className="flex flex-1 flex-col gap-[20px] overflow-hidden">
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
            <optgroup label="── PT-BR ──">
              <option value="animefire">animefire</option>
              <option value="goyabu">goyabu</option>
              <option value="animedrive">animedrive</option>
              <option value="superflix">superflix</option>
              <option value="dattebayo">dattebayo</option>
            </optgroup>
            <optgroup label="── EN ──">
              <option value="allanime">allanime</option>
              <option value="nineanime">9anime</option>
            </optgroup>
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

      {/* ── Results + Detail ── */}
      <div className="grid min-h-0 flex-1 gap-[14px] md:grid-cols-[280px_1fr]">
        {/* Resultados */}
        <Panel title="Resultados" className="min-h-0">
          {/* Provider stats — mostra quantos resultados cada fonte retornou */}
          {providerStats && Object.keys(providerStats).length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-[#232330] px-3 py-2 text-[10px]">
              {Object.entries(providerStats).map(([name, stat]) => (
                <span key={name} className="flex items-center gap-1">
                  <span
                    className={
                      stat.status === "ok" ? "text-[#a6e3a1]"
                      : stat.status === "skipped" ? "text-[#f38ba8]"
                      : "text-[#6c7086]"
                    }
                  >
                    {stat.status === "ok" ? "●" : stat.status === "skipped" ? "✕" : "○"}
                  </span>
                  <span className={stat.status === "ok" ? "text-[#bac2de]" : "text-[#45475a]"}>
                    {name}
                    {stat.status === "ok" && <span className="text-[#6c7086]"> {stat.count}</span>}
                    {stat.status === "skipped" && <span className="text-[#f38ba8]"> off</span>}
                  </span>
                </span>
              ))}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {results.length === 0 ? (
              <div className="px-4 py-6 text-[12px] text-[#6c7086]">
                {providerStats ? "Nenhum provider retornou resultados." : "Digite e pressione BUSCAR ou Enter."}
              </div>
            ) : (
              results.map((r, i) => (
                <button
                  key={r.url ?? r.id ?? `${r.title}-${i}`}
                  onClick={() => onSelectResult(r)}
                  className={`w-full border-b border-[#232330] px-3 py-2 text-left hover:bg-white/5 ${
                    selectedResult?.title === r.title ? "bg-[#cba6f7] text-[#0f0f14]" : ""
                  }`}
                >
                  <div className="truncate text-[13px] font-bold">{r.title}</div>
                  <div className="text-[11px] opacity-70">{r.provider ?? source}</div>
                </button>
              ))
            )}
          </div>
        </Panel>

        {/* Detalhes */}
        <Panel
          title={selectedResult ? `Detalhes :: ${selectedResult.title}` : "Detalhes :: Selecione um resultado"}
          focused={!!selectedResult}
          className="min-h-0"
        >
          {!selectedResult ? (
            <div className="flex h-full items-center justify-center text-[13px] text-[#6c7086]">
              ← Selecione um resultado para ver detalhes
            </div>
          ) : (
            <div className="grid flex-1 min-h-0 gap-4 overflow-y-auto p-4 lg:grid-cols-[200px_1fr]">
              {/* Coluna esquerda: poster + stats */}
              <div className="flex flex-col gap-3">
                {isLoadingMeta ? (
                  <div className="flex min-h-[160px] items-center justify-center border border-dashed border-[#45475a] text-[12px] text-[#6c7086]">
                    carregando...
                  </div>
                ) : kitsuMeta?.posterUrl ? (
                  <div className="border border-dashed border-[#45475a] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={kitsuMeta.posterUrl} alt={kitsuMeta.title} className="w-full object-cover" style={{ maxHeight: 200 }} />
                  </div>
                ) : (
                  <div className="flex min-h-[120px] items-center justify-center border border-dashed border-[#45475a] text-[11px] text-[#6c7086]">
                    sem poster
                  </div>
                )}

                {kitsuMeta && (
                  <div className="border border-[#45475a] bg-black/20 p-3 text-[12px] space-y-1">
                    <div><span className="text-[#6c7086]">RATING: </span><span className="text-[#f9e2af] font-bold">{kitsuMeta.rating ? kitsuMeta.rating.toFixed(1) : "—"}</span></div>
                    <div><span className="text-[#6c7086]">YEAR: </span><span className="text-[#89dceb]">{kitsuMeta.year ?? "—"}</span></div>
                    <div><span className="text-[#6c7086]">TYPE: </span><span className="text-[#cba6f7]">{kitsuMeta.subtype ?? "—"}</span></div>
                    <div><span className="text-[#6c7086]">EPS: </span><span className="text-[#a6e3a1] font-bold">{kitsuMeta.episodeCount ?? "?"}</span></div>
                    <div><span className="text-[#6c7086]">STATUS: </span><span className="text-[#bac2de]">{kitsuMeta.status ?? "—"}</span></div>
                  </div>
                )}
              </div>

              {/* Coluna direita: título, sinopse, episódios, fila */}
              <div className="flex min-w-0 flex-col gap-3">
                <div>
                  <div className="mb-1 text-[11px] uppercase text-[#6c7086]">
                    {isLoadingMeta ? "buscando metadados kitsu..." : "metadata :: kitsu"}
                  </div>
                  <h2 className="truncate text-xl font-extrabold text-[#cba6f7]">
                    {kitsuMeta?.title ?? selectedResult.title}
                  </h2>
                  {kitsuMeta?.altTitle && <p className="truncate text-[12px] text-[#6c7086]">{kitsuMeta.altTitle}</p>}
                </div>

                {kitsuMeta?.synopsis && (
                  <div>
                    <div className="mb-1 text-[12px] font-bold text-[#89dceb]">-- SYNOPSIS --</div>
                    <p className="border-l-2 border-[#45475a] bg-black/20 px-3 py-2 text-[12px] leading-[1.6] text-[#6c7086] line-clamp-4">
                      {kitsuMeta.synopsis}
                    </p>
                  </div>
                )}

                {/* Episódios */}
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
                  <div className="max-h-[180px] overflow-auto border border-[#45475a] bg-black/20 p-2">
                    {isLoadingEpisodes ? (
                      <div className="py-3 text-center text-[12px] text-[#6c7086]">carregando episódios...</div>
                    ) : episodes.length === 0 ? (
                      <div className="py-3 text-center text-[12px] text-[#6c7086]">Nenhum episódio encontrado</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 md:grid-cols-3">
                        {episodes.map((ep) => (
                          <label key={ep.key} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[12px] hover:text-[#cba6f7]">
                            <input
                              type="checkbox"
                              checked={selectedEpisodes.includes(ep.key)}
                              onChange={() => onToggleEpisode(ep.key)}
                              className="accent-[#cba6f7]"
                            />
                            <span>{ep.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Guard de download path */}
                {downloadPath.trim().length === 0 && (
                  <p className="rounded border border-[#f9e2af]/30 bg-[#f9e2af]/5 px-3 py-2 text-[12px] text-[#f9e2af]">
                    ⚠ Pasta de download não configurada.{" "}
                    <span className="text-[#cba6f7]">Configure em [⚙ config]</span> antes de baixar.
                  </p>
                )}

                {/* Botão de fila */}
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
