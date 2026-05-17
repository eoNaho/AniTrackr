"use client";

import React, { useEffect, useMemo, useState } from "react";
import { batchDownloadSubtitles, fetchMissingSubtitles } from "@/lib/api";
import type { AnimeView } from "./ui";
import { Panel, TuiButton, TuiEmpty, TuiInfoBox, TuiSection, TuiSelect } from "./ui";

type Props = {
  selectedAnime: AnimeView | null;
};

type MissingSubtitleItem = {
  anime_id: string;
  anime_title: string;
  episode_number: number;
  season: number;
  file_path: string;
};

export function SubtitlesView({ selectedAnime }: Props) {
  const [missing, setMissing] = useState<MissingSubtitleItem[]>([]);
  const [language, setLanguage] = useState("pt-BR");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetchMissingSubtitles()
      .then((data) => setMissing(data.missing as MissingSubtitleItem[]))
      .catch((err) => {
        setMissing([]);
        setError((err as Error).message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const selectedMissing = useMemo(() => {
    if (!selectedAnime) return [];
    return missing.filter((item) => item.anime_id === selectedAnime.id);
  }, [missing, selectedAnime]);

  async function handleBatchDownload() {
    if (!selectedAnime) return;
    setRunning(true);
    setStatus(null);
    try {
      const result = await batchDownloadSubtitles(selectedAnime.id, language);
      setStatus(`subtitle batch finished: ${result.downloaded}/${result.total} downloaded`);
      refresh();
    } catch (error) {
      setStatus(`subtitle batch failed: ${(error as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 gap-[14px] overflow-hidden xl:grid-cols-[0.95fr_1.05fr]">
      <Panel title="Subtitles :: Recovery Queue" focused className="min-h-0">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          <div className="grid gap-2 md:grid-cols-3">
            <TuiInfoBox label="Missing Subs" value={missing.length} tone="warning" />
            <TuiInfoBox label="Selected Anime" value={selectedAnime ? selectedMissing.length : 0} tone="info" />
            <TuiInfoBox label="Language" value={language} tone="success" />
          </div>

          <TuiSection
            title="Batch Download"
            subtitle="Escaneia episodios baixados sem arquivo de legenda e dispara a recuperacao em lote."
          >
            <div className="space-y-4 p-4">
              {!selectedAnime ? (
                <TuiEmpty>Selecione um anime na biblioteca antes de iniciar o lote.</TuiEmpty>
              ) : (
                <>
                  <div className="border border-[#45475a] bg-[#11111a] p-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[#6c7086]">target</div>
                    <div className="mt-1 text-[16px] font-bold text-[#e0e0ed]">{selectedAnime.title}</div>
                    <div className="mt-1 text-[12px] text-[#6c7086]">
                      {selectedMissing.length} episodio(s) faltando legenda para este titulo.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TuiSelect value={language} onChange={setLanguage}>
                      {["pt-BR", "pt", "en"].map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </TuiSelect>
                    <TuiButton onClick={() => void handleBatchDownload()} disabled={running} variant="info">
                      {running ? "running..." : "download missing subtitles"}
                    </TuiButton>
                    <TuiButton onClick={refresh}>refresh</TuiButton>
                  </div>
                </>
              )}
              {status ? <div className="text-[12px] text-[#89dceb]">{status}</div> : null}
            </div>
          </TuiSection>
        </div>
      </Panel>

      <Panel title="Subtitles :: Missing Files" className="min-h-0">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          {loading ? (
            <TuiEmpty>Scanning subtitle coverage...</TuiEmpty>
          ) : error ? (
            <TuiEmpty>{error}</TuiEmpty>
          ) : missing.length === 0 ? (
            <TuiEmpty>No missing subtitle files were detected.</TuiEmpty>
          ) : (
            <div className="flex flex-col gap-2">
              {missing.map((item) => {
                const isSelected = selectedAnime?.id === item.anime_id;
                return (
                  <div
                    key={`${item.anime_id}-${item.season}-${item.episode_number}`}
                    className={`border p-3 ${
                      isSelected
                        ? "border-[#89dceb] bg-[#89dceb]/10"
                        : "border-[#45475a] bg-[#11111a]"
                    }`}
                  >
                    <div className="text-sm text-[#e0e0ed]">{item.anime_title}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[#6c7086]">
                      season {item.season} :: episode {item.episode_number}
                    </div>
                    <div className="mt-2 truncate font-mono text-[11px] text-[#8b90a8]">{item.file_path}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
