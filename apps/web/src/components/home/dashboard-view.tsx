"use client";

import React, { useEffect, useState } from "react";
import { fetchDashboard, fetchDownloadAnalytics, type DashboardAnime, type DashboardData, type DownloadAnalytics } from "@/lib/api";

interface Props {
  onSelectAnime?: (id: string) => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const gb = 1024 ** 3, mb = 1024 ** 2;
  if (bytes >= gb) return `${(bytes / gb).toFixed(1)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function fmtSpeed(kbps: number): string {
  if (!kbps || kbps <= 0) return "—";
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps)} KB/s`;
}

// Mini sparkline usando blocos Unicode
const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
function sparkline(values: number[]): string {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  return values.map((v) => SPARKS[Math.min(SPARKS.length - 1, Math.floor((v / max) * (SPARKS.length - 1)))]).join("");
}

// Preenche os últimos N dias com zeros onde não houver dados
function fillDays(data: { date: string; count: number }[], days: number) {
  const map = new Map(data.map((d) => [d.date, d.count]));
  const result: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push(map.get(key) ?? 0);
  }
  return result;
}

// ── StatsBar ─────────────────────────────────────────────────────────────────

function StatsBar({ analytics }: { analytics: DownloadAnalytics }) {
  const { totals, byProvider, downloadsPerDay } = analytics;
  const spark = sparkline(fillDays(downloadsPerDay, 14));
  const topProvider = byProvider[0]?.provider ?? "—";
  const thisWeek = downloadsPerDay
    .filter((d) => new Date(d.date) >= new Date(Date.now() - 7 * 86400_000))
    .reduce((s, d) => s + d.count, 0);

  return (
    <section className="flex flex-wrap gap-4 border border-[#2a2a38] bg-[#0b0b11] px-4 py-3 text-[11px]">
      <Stat label="TOTAL BAIXADO" value={String(totals.total_count)} sub="episódios" />
      <Stat label="ARMAZENAMENTO" value={fmtBytes(totals.total_bytes)} />
      <Stat label="VELOCIDADE MÉD." value={fmtSpeed(totals.avg_speed_kbps)} />
      <Stat label="ESTA SEMANA" value={String(thisWeek)} sub="episódios" />
      <Stat label="PROVIDER TOP" value={topProvider.toUpperCase()} />
      <div className="flex flex-col gap-1">
        <span className="uppercase tracking-widest text-[#45475a]">14 DIAS</span>
        <span className="font-mono text-[13px] tracking-wider text-[#6c7086]" title="Downloads por dia (últimos 14 dias)">
          {spark || "▁▁▁▁▁▁▁▁▁▁▁▁▁▁"}
        </span>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[80px]">
      <span className="uppercase tracking-widest text-[#45475a]">{label}</span>
      <span className="font-bold text-[#cba6f7]">
        {value}
        {sub && <span className="ml-1 font-normal text-[#6c7086]">{sub}</span>}
      </span>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function DashboardView({ onSelectAnime }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [analytics, setAnalytics] = useState<DownloadAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    Promise.all([fetchDashboard(), fetchDownloadAnalytics().catch(() => null)])
      .then(([dashboard, stats]) => {
        if (!active) return;
        setData(dashboard);
        setAnalytics(stats);
      })
      .catch((err) => {
        if (!active) return;
        setData(null);
        setError((err as Error).message);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-zinc-500">Carregando painel...</div>;
  }

  if (!data) {
    return <div className="p-6 text-sm text-zinc-500">{error ?? "Nenhum dado disponível."}</div>;
  }

  const totalItems =
    data.recentlyDownloaded.length +
    data.inProgress.length +
    data.missingEpisodes.length +
    data.completed.length;

  return (
    <div className="h-full flex flex-col gap-6 overflow-y-auto">
      {analytics && analytics.totals.total_count > 0 && (
        <StatsBar analytics={analytics} />
      )}

      {totalItems === 0 ? (
        <div className="flex flex-col gap-3 p-6">
          <p className="text-sm font-bold text-zinc-400">Painel ainda sem atividade</p>
          <div className="flex flex-col gap-2 text-xs text-zinc-600">
            <p><span className="text-zinc-400">Baixados recentemente</span> — aparece após o primeiro download concluído nos últimos 7 dias.</p>
            <p><span className="text-zinc-400">Em progresso</span> — aparece quando um anime tem alguns episódios baixados mas não todos.</p>
            <p><span className="text-zinc-400">Episódios faltando</span> — aparece em animes rastreados com lacunas na biblioteca.</p>
            <p><span className="text-zinc-400">Completos</span> — aparece quando todos os episódios de um anime foram baixados.</p>
          </div>
          <p className="text-xs text-zinc-600 mt-2">
            Acesse <span className="text-zinc-400">Busca</span> para adicionar animes à biblioteca e iniciar downloads.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8 px-4 pb-4">
          <AnimeRow title="Baixados Recentemente" items={data.recentlyDownloaded} onSelect={onSelectAnime} />
          <AnimeRow title="Em Progresso" items={data.inProgress} onSelect={onSelectAnime} />
          <AnimeRow
            title="Episódios Faltando"
            items={data.missingEpisodes}
            onSelect={onSelectAnime}
            badge={(a) => (a.missing_count ? `${a.missing_count} faltando` : undefined)}
          />
          <AnimeRow title="Completos" items={data.completed} onSelect={onSelectAnime} />
        </div>
      )}
    </div>
  );
}

function AnimeRow({
  title,
  items,
  onSelect,
  badge,
}: {
  title: string;
  items: DashboardAnime[];
  onSelect?: (id: string) => void;
  badge?: (a: DashboardAnime) => string | undefined;
}) {
  if (!items.length) return null;

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">{title}</h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map((anime) => (
          <button
            key={anime.id}
            onClick={() => onSelect?.(anime.id)}
            className="flex-shrink-0 w-28 text-left group"
          >
            {anime.poster_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={anime.poster_url}
                alt={anime.title}
                className="w-28 h-40 object-cover rounded border border-zinc-800 group-hover:border-zinc-600 transition-colors"
              />
            ) : (
              <div className="w-28 h-40 bg-zinc-800 rounded border border-zinc-700 flex items-center justify-center">
                <span className="text-xs text-zinc-600 text-center px-1">{anime.title}</span>
              </div>
            )}
            <p className="text-xs mt-1.5 truncate text-zinc-300 group-hover:text-zinc-100">{anime.title}</p>
            <p className="text-xs text-zinc-600">
              {badge?.(anime) ?? `${anime.downloaded_count}/${anime.episode_count} ep`}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}
