"use client";

import React, { useCallback, useEffect, useState } from "react";
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
  downloaded: "OK",
  downloading: "DL",
  queued: "Q",
  missing: "--",
  retry_wait: "RT",
  failed: "ER",
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

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function handleToggleWatched(ep: AnimeEpisode) {
    setToggling(ep.number);
    try {
      await markEpisodeWatched(animeId, ep.number, ep.watched === 0);
      setEpisodes((prev) =>
        prev.map((item) => (item.number === ep.number ? { ...item, watched: ep.watched === 0 ? 1 : 0 } : item))
      );
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return <div className="py-4 text-center text-[12px] text-[#6c7086]">Loading episodes...</div>;
  }

  if (!episodes.length) {
    return (
      <div className="py-4 text-center text-[12px] text-[#6c7086]">
        No tracked episodes yet. <span className="text-[#cba6f7]">Start a download to populate this grid.</span>
      </div>
    );
  }

  const watchedCount = episodes.filter((episode) => episode.watched).length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] text-[#6c7086]">
        <span>
          <span className="font-bold text-[#a6e3a1]">{watchedCount}</span> watched ·{" "}
          <span className="font-bold text-[#f38ba8]">{missingCount}</span> missing · {episodes.length} total
        </span>
        <button onClick={() => void load()} className="text-[11px] text-[#6c7086] hover:text-[#cba6f7]">
          refresh
        </button>
      </div>
      <div className="grid grid-cols-3 gap-[2px] md:grid-cols-4 xl:grid-cols-6">
        {episodes.map((ep) => {
          const color = statusColor[ep.status] ?? "text-[#6c7086]";
          const icon = statusIcon[ep.status] ?? "--";
          const isWatched = ep.watched === 1;
          return (
            <button
              key={ep.id}
              title={ep.title ? `Ep ${ep.number}: ${ep.title}${ep.isFiller ? " [filler]" : ""}` : `Ep ${ep.number}`}
              onClick={() => ep.status === "downloaded" && void handleToggleWatched(ep)}
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
              {isWatched && <span className="ml-auto text-[10px]">seen</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[#6c7086]">
        <span><span className="text-[#a6e3a1]">OK</span> downloaded</span>
        <span><span className="text-[#89dceb]">DL</span> downloading</span>
        <span><span className="text-[#f9e2af]">Q</span> queued</span>
        <span><span className="text-[#6c7086]">--</span> missing</span>
        <span><span className="text-[#f38ba8]">ER</span> failed</span>
        <span className="opacity-50">filler dimmed</span>
        <span>click a downloaded episode to toggle watched</span>
      </div>
    </div>
  );
}
