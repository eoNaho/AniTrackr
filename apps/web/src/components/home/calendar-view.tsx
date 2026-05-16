"use client";

import React, { useEffect, useState } from "react";
import { fetchCalendar, type CalendarEntry } from "@/lib/api";

export function CalendarView() {
  const [range, setRange] = useState<"week" | "month">("week");
  const [priority, setPriority] = useState<CalendarEntry[]>([]);
  const [discover, setDiscover] = useState<CalendarEntry[]>([]);
  const [recentlyDetected, setRecentlyDetected] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCalendar(range)
      .then((d) => {
        setPriority(d.priority);
        setDiscover(d.discover);
        setRecentlyDetected(d.recentlyDetected);
      })
      .finally(() => setLoading(false));
  }, [range]);

  const priorityGrouped = groupByDate(priority);
  const discoverGrouped = groupByDate(discover);
  const priorityDates = Object.keys(priorityGrouped).sort();
  const discoverDates = Object.keys(discoverGrouped).sort();
  const isEmpty = priorityDates.length === 0 && discoverDates.length === 0;

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold text-zinc-200">Calendário de lançamentos</h1>
          <p className="text-xs text-zinc-500">
            Mistura sua coleção com lançamentos gerais e prioriza o que você já acompanha.
          </p>
        </div>
        <div className="flex gap-1">
          {(["week", "month"] as const).map((r) => (
            <button
              key={r}
              onClick={() => {
                setLoading(true);
                setRange(r);
              }}
              className={`text-xs px-3 py-1 rounded border transition-colors ${
                range === r
                  ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                  : "border-zinc-700 text-zinc-500 hover:border-zinc-600"
              }`}
            >
              {r === "week" ? "Esta semana" : "Este mês"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Carregando...</div>
      ) : isEmpty ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
          <p className="text-sm text-zinc-400">
            Nenhum lançamento encontrado para {range === "week" ? "esta semana" : "este mês"}.
          </p>
          <p className="mt-2 text-xs text-zinc-600">
            Se sua coleção estiver vazia, esta tela depende dos dados do AniList para mostrar o calendário geral.
          </p>
        </div>
      ) : (
        <>
          <CalendarSection
            title="Prioridade da sua coleção"
            description="Animes já salvos no site aparecem primeiro, com vantagem para os que você marcou para acompanhar ou já começou a baixar."
            dates={priorityDates}
            grouped={priorityGrouped}
            emptyMessage="Nada da sua coleção está previsto nesse período."
          />
          <CalendarSection
            title="Lançamentos gerais"
            description="Aqui entram animes em exibição mesmo que ainda não façam parte da sua biblioteca."
            dates={discoverDates}
            grouped={discoverGrouped}
            emptyMessage="Nenhum lançamento geral adicional encontrado nesse período."
          />
        </>
      )}

      {recentlyDetected.length > 0 && (
        <div className="mt-2 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-300">
            Auto-download
          </h2>
          <p className="mt-1 text-xs text-emerald-100/80">
            {recentlyDetected.length} episódio(s) entraram na fila automaticamente nos últimos 7 dias.
          </p>
        </div>
      )}
    </div>
  );
}

function CalendarSection({
  title,
  description,
  dates,
  grouped,
  emptyMessage,
}: {
  title: string;
  description: string;
  dates: string[];
  grouped: Record<string, CalendarEntry[]>;
  emptyMessage: string;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="mb-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-300">{title}</h2>
        <p className="mt-1 text-xs text-zinc-500">{description}</p>
      </div>

      {dates.length === 0 ? (
        <p className="text-sm text-zinc-500">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {dates.map((date) => (
            <div key={date}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                {formatDate(date)}
              </h3>
              <div className="flex flex-col gap-2">
                {grouped[date].map((entry) => (
                  <CalendarCard key={`${entry.id}-${entry.episode_number ?? "na"}`} entry={entry} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CalendarCard({ entry }: { entry: CalendarEntry }) {
  const autoEligible = entry.is_library && entry.source_url && entry.auto_download === 1;
  const statusLabel =
    entry.watch_status === "watching" ? "Acompanhando"
    : entry.downloaded_count > 0 ? "Já baixado"
    : entry.is_library ? "Na biblioteca"
    : "Novo";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
      {entry.poster_url ? (
        <img
          src={entry.poster_url}
          alt={entry.title}
          className="h-14 w-10 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-14 w-10 flex-shrink-0 rounded bg-zinc-800" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100">{entry.title}</p>
            <p className="text-xs text-zinc-500">
              Ep. {entry.episode_number ?? "?"} · {formatTime(entry.next_release)}
            </p>
          </div>
          <StatusDot status={entry.anilist_status} />
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-300">
            {statusLabel}
          </span>
          {entry.is_library && (
            <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-400">
              {entry.downloaded_count}/{entry.episode_count || "?"} eps
            </span>
          )}
          {autoEligible && (
            <span className="rounded-full border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 text-emerald-300">
              Auto-download ativo
            </span>
          )}
          {!entry.is_library && (
            <span className="rounded-full border border-sky-800/60 bg-sky-950/30 px-2 py-0.5 text-sky-300">
              Fora da biblioteca
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function groupByDate(entries: CalendarEntry[]): Record<string, CalendarEntry[]> {
  return entries.reduce((acc, e) => {
    const date = e.next_release.split("T")[0];
    if (!acc[date]) acc[date] = [];
    acc[date].push(e);
    return acc;
  }, {} as Record<string, CalendarEntry[]>);
}

function formatDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "RELEASING" ? "bg-green-500"
    : status === "FINISHED" ? "bg-zinc-600"
    : "bg-yellow-500";
  return <span className={`mt-1 inline-block h-2 w-2 rounded-full ${color}`} />;
}
