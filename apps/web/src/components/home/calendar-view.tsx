"use client";

import React, { useEffect, useState } from "react";
import { fetchCalendar, type CalendarEntry } from "@/lib/api";
import { Panel, TuiButton, TuiEmpty, TuiInfoBox, TuiSection } from "./ui";

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
    <div className="grid h-full min-h-0 gap-[14px] overflow-hidden xl:grid-cols-[320px_1fr]">
      <Panel title="Calendario :: Scheduler" focused className="min-h-0">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#cba6f7]">release.timeline()</div>
            <p className="mt-1 text-[12px] text-[#6c7086]">
              Mistura biblioteca local com lancamentos gerais e destaca o que importa primeiro.
            </p>
          </div>

          <div className="grid gap-2">
            <TuiInfoBox label="Range" value={range === "week" ? "7D" : "30D"} tone="info" />
            <TuiInfoBox label="Priority Days" value={priorityDates.length} tone="success" />
            <TuiInfoBox label="Discover Days" value={discoverDates.length} tone="warning" />
            <TuiInfoBox label="Auto Queue" value={recentlyDetected.length} tone={recentlyDetected.length > 0 ? "success" : "default"} />
          </div>

          <div className="flex flex-wrap gap-2">
            {(["week", "month"] as const).map((item) => (
              <TuiButton
                key={item}
                onClick={() => {
                  setLoading(true);
                  setRange(item);
                }}
                variant={range === item ? "primary" : "default"}
              >
                {item === "week" ? "esta semana" : "este mes"}
              </TuiButton>
            ))}
          </div>

          {recentlyDetected.length > 0 ? (
            <TuiSection
              title="Auto Download"
              subtitle={`${recentlyDetected.length} episodio(s) entraram na fila automaticamente nos ultimos 7 dias.`}
            >
              <div className="px-4 py-3 text-[12px] text-[#a6e3a1]">scheduler.enqueue() confirmed</div>
            </TuiSection>
          ) : (
            <TuiEmpty>Sem episodios recentes detectados pelo auto-download.</TuiEmpty>
          )}
        </div>
      </Panel>

      <Panel title="Timeline :: Release Feed" className="min-h-0">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          {loading ? (
            <TuiEmpty>Carregando calendario...</TuiEmpty>
          ) : isEmpty ? (
            <TuiEmpty>
              Nenhum lancamento encontrado para {range === "week" ? "esta semana" : "este mes"}.
            </TuiEmpty>
          ) : (
            <>
              <CalendarSection
                title="Prioridade Da Biblioteca"
                description="Titulos ja salvos aparecem primeiro e recebem mais peso quando fazem parte do fluxo ativo."
                dates={priorityDates}
                grouped={priorityGrouped}
                emptyMessage="Nada da sua biblioteca esta previsto nesse periodo."
              />
              <CalendarSection
                title="Descoberta Geral"
                description="Lancamentos em exibicao mesmo quando ainda estao fora da biblioteca."
                dates={discoverDates}
                grouped={discoverGrouped}
                emptyMessage="Nenhum lancamento adicional encontrado nesse periodo."
              />
            </>
          )}
        </div>
      </Panel>
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
    <TuiSection title={title} subtitle={description}>
      <div className="p-4">
        {dates.length === 0 ? (
          <TuiEmpty>{emptyMessage}</TuiEmpty>
        ) : (
          <div className="flex flex-col gap-4">
            {dates.map((date) => (
              <div key={date}>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#89dceb]">
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
      </div>
    </TuiSection>
  );
}

function CalendarCard({ entry }: { entry: CalendarEntry }) {
  const autoEligible = entry.is_library && entry.source_url && entry.auto_download === 1;
  const statusLabel =
    entry.watch_status === "watching" ? "acompanhando"
    : entry.downloaded_count > 0 ? "baixado"
    : entry.is_library ? "na biblioteca"
    : "novo";

  return (
    <div className="flex items-center gap-3 border border-[#45475a] bg-[#11111a] p-3">
      {entry.poster_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.poster_url}
          alt={entry.title}
          className="h-14 w-10 flex-shrink-0 border border-[#45475a] object-cover"
        />
      ) : (
        <div className="h-14 w-10 flex-shrink-0 border border-dashed border-[#45475a] bg-black/20" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[#e0e0ed]">{entry.title}</p>
            <p className="text-xs text-[#6c7086]">
              EP {entry.episode_number ?? "?"} :: {formatTime(entry.next_release)}
            </p>
          </div>
          <StatusDot status={entry.anilist_status} />
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase">
          <span className="border border-[#45475a] px-2 py-0.5 text-[#bac2de]">{statusLabel}</span>
          {entry.is_library ? (
            <span className="border border-[#45475a] px-2 py-0.5 text-[#6c7086]">
              {entry.downloaded_count}/{entry.episode_count || "?"} eps
            </span>
          ) : null}
          {autoEligible ? (
            <span className="border border-[#a6e3a1] bg-[#a6e3a1]/10 px-2 py-0.5 text-[#a6e3a1]">
              auto-download
            </span>
          ) : null}
          {!entry.is_library ? (
            <span className="border border-[#89dceb] bg-[#89dceb]/10 px-2 py-0.5 text-[#89dceb]">
              fora da biblioteca
            </span>
          ) : null}
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
    status === "RELEASING" ? "bg-[#a6e3a1]"
    : status === "FINISHED" ? "bg-[#6c7086]"
    : "bg-[#f9e2af]";
  return <span className={`mt-1 inline-block h-2 w-2 ${color}`} />;
}
