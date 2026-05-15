"use client";

import React, { useEffect, useState, useCallback } from "react";
import { fetchAnimeEpisodes, markEpisodeWatched, type AnimeEpisode } from "@/lib/api";

const statusColor: Record<string, string> = {
  downloaded: "text-[#a6e3a1]",
  downloading: "text-[#89dceb]",
  queued: "text-[#f9e2af]",
  missing: "text-[#6c7086]",
  retry_wait: "text-[#f9e2af]",
  failed: "text-[#f38ba8]",
};

const statusIcon: Record<string, string> = {
  downloaded: "✓",
  downloading: "↓",
  queued: "◷",
  missing: "○",
  retry_wait: "↺",
  failed: "✕",
};

interface Props {
  animeId: string;
}

export function EpisodeList({ animeId }: Props) {
  const [episodes, setEpisodes] = useState<AnimeEpisode[]>([]);
  const [missingCount, setMissingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAnimeEpisodes(animeId);
      setEpisodes(data.episodes);
      setMissingCount(data.missingCount);
    } catch {
      setEpisodes([]);
    } finally {
      setLoading(false);
    }
  }, [animeId]);

  useEffect(() => { void load(); }, [load]);

  async function handleToggleWatched(ep: AnimeEpisode) {
    setToggling(ep.number);
    try {
      await markEpisodeWatched(animeId, ep.number, ep.watched === 0);
      setEpisodes((prev) =>
        prev.map((e) => e.number === ep.number ? { ...e, watched: ep.watched === 0 ? 1 : 0 } : e)
      );
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return (
      <div className="py-4 text-center text-[12px] text-[#6c7086]">
        carregando episódios...
      </div>
    );
  }

  if (!episodes.length) {
    return (
      <div className="py-4 text-center text-[12px] text-[#6c7086]">
        Nenhum episódio registrado.{" "}
        <span className="text-[#cba6f7]">Inicie um download para rastrear.</span>
      </div>
    );
  }

  const watchedCount = episodes.filter((e) => e.watched).length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] text-[#6c7086]">
        <span>
          <span className="text-[#a6e3a1] font-bold">{watchedCount}</span> assistidos ·{" "}
          <span className="text-[#f38ba8] font-bold">{missingCount}</span> faltando ·{" "}
          {episodes.length} total
        </span>
        <button onClick={load} className="text-[#6c7086] hover:text-[#cba6f7] text-[11px]">↻</button>
      </div>
      <div className="grid grid-cols-3 gap-[2px] md:grid-cols-4 xl:grid-cols-6">
        {episodes.map((ep) => {
          const color = statusColor[ep.status] ?? "text-[#6c7086]";
          const icon = statusIcon[ep.status] ?? "○";
          const isWatched = ep.watched === 1;
          return (
            <button
              key={ep.id}
              title={ep.title ? `Ep ${ep.number}: ${ep.title}${ep.isFiller ? " [filler]" : ""}` : `Ep ${ep.number}`}
              onClick={() => ep.status === "downloaded" && handleToggleWatched(ep)}
              disabled={ep.status !== "downloaded" || toggling === ep.number}
              className={`flex items-center gap-1 border px-2 py-[3px] text-[11px] transition-colors ${
                isWatched
                  ? "border-[#a6e3a1]/30 bg-[#a6e3a1]/10 text-[#a6e3a1]"
                  : `border-[#2a2a38] bg-[#0d0d12] ${color}`
              } ${ep.status === "downloaded" ? "cursor-pointer hover:border-[#cba6f7]/50" : "cursor-default"} ${
                ep.isFiller ? "opacity-50" : ""
              }`}
            >
              <span className="font-bold">{icon}</span>
              <span>{ep.number}</span>
              {isWatched && <span className="ml-auto text-[10px]">👁</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[#6c7086]">
        <span><span className="text-[#a6e3a1]">✓</span> baixado</span>
        <span><span className="text-[#89dceb]">↓</span> baixando</span>
        <span><span className="text-[#f9e2af]">◷</span> na fila</span>
        <span><span className="text-[#6c7086]">○</span> faltando</span>
        <span><span className="text-[#f38ba8]">✕</span> falhou</span>
        <span className="opacity-50">⬜ filler</span>
        <span>👁 assistido (clique p/ marcar)</span>
      </div>
    </div>
  );
}
