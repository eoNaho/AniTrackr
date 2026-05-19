"use client";

import React, { useCallback, useEffect, useState } from "react";
import { fetchDownloadFailures, type ClassifiedFailure, type FailureCategory, type FailuresResponse } from "@/lib/api";

const CATEGORY_LABELS: Record<FailureCategory, string> = {
  auth_error:      "Auth / Anti-bot",
  source_broken:   "Fonte quebrada",
  network_timeout: "Timeout de rede",
  provider_drift:  "Provider drift",
  invalid_file:    "Arquivo inválido",
  unknown:         "Desconhecido",
};

const CATEGORY_COLOR: Record<FailureCategory, string> = {
  auth_error:      "text-[#f38ba8]",
  source_broken:   "text-[#fab387]",
  network_timeout: "text-[#f9e2af]",
  provider_drift:  "text-[#f38ba8]",
  invalid_file:    "text-[#fab387]",
  unknown:         "text-[#6c7086]",
};

const SEVERITY_COLOR: Record<string, string> = {
  high:   "text-[#f38ba8]",
  medium: "text-[#f9e2af]",
  low:    "text-[#a6e3a1]",
};

interface Props {
  className?: string;
}

export function FailureIntelligencePanel({ className = "" }: Props) {
  const [data, setData] = useState<FailuresResponse | null>(null);
  const [window, setWindow] = useState<"1d" | "7d">("1d");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ClassifiedFailure | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchDownloadFailures(window));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [window]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!data || data.total === 0) return null;

  const grouped = Object.entries(data.summary).sort(([, a], [, b]) => b.count - a.count);

  return (
    <section className={`border border-[#2a2a38] bg-[#0b0b11] text-[11px] ${className}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5"
      >
        <div className="flex items-center gap-3">
          <span className="font-bold uppercase tracking-widest text-[#f38ba8]">FAILURE INTELLIGENCE</span>
          <span className="text-[#6c7086]">—</span>
          <span className="text-[#f38ba8] font-bold">{data.total} falha{data.total !== 1 ? "s" : ""}</span>
          <span className="text-[#45475a]">{data.window}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Category pills */}
          {grouped.slice(0, 3).map(([cat, info]) => (
            <span key={cat} className={`${CATEGORY_COLOR[cat as FailureCategory]} tabular-nums`}>
              {CATEGORY_LABELS[cat as FailureCategory] ?? cat} ×{info.count}
            </span>
          ))}
          <span className="text-[#6c7086] ml-1">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#1a1a2e] px-4 py-3 flex flex-col gap-3">
          {/* Window toggle + refresh */}
          <div className="flex items-center gap-2">
            {(["1d", "7d"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`border px-2 py-1 text-[10px] font-bold uppercase ${window === w ? "border-[#cba6f7] text-[#cba6f7]" : "border-[#45475a] text-[#6c7086]"}`}
              >
                {w === "1d" ? "24h" : "7 dias"}
              </button>
            ))}
            <button
              onClick={() => void load()}
              disabled={loading}
              className="border border-[#45475a] px-2 py-1 text-[10px] text-[#6c7086] hover:text-[#cba6f7] disabled:opacity-40"
            >
              {loading ? "..." : "↻"}
            </button>
          </div>

          {/* Summary by category */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {grouped.map(([cat, info]) => (
              <div key={cat} className="flex flex-col gap-0.5">
                <span className="text-[#45475a] uppercase tracking-wider">{CATEGORY_LABELS[cat as FailureCategory] ?? cat}</span>
                <span className={`font-bold text-base ${SEVERITY_COLOR[info.severity]}`}>
                  {info.count}
                  <span className="ml-1 text-[10px] font-normal text-[#6c7086]">{info.severity}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Recent failures list */}
          <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto">
            {data.failures.slice(0, 20).map((f) => (
              <button
                key={f.id}
                onClick={() => setDetail(detail?.id === f.id ? null : f)}
                className="w-full flex items-start gap-2 border border-[#1a1a2e] bg-black/20 px-3 py-2 text-left hover:bg-white/5"
              >
                <span className={`shrink-0 font-bold ${CATEGORY_COLOR[f.classification.category]}`}>
                  {CATEGORY_LABELS[f.classification.category]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[#bac2de]">{f.anime_title}</span>
                <span className="shrink-0 text-[#6c7086]">Ep {f.episode_number}</span>
                <span className="shrink-0 text-[#45475a]">[{f.provider}]</span>
                <span className={`shrink-0 ${SEVERITY_COLOR[f.classification.severity]}`}>●</span>
              </button>
            ))}
          </div>

          {/* Detail drawer */}
          {detail && (
            <div className="border border-[#45475a] bg-black/30 px-3 py-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className={`font-bold uppercase ${CATEGORY_COLOR[detail.classification.category]}`}>
                  {CATEGORY_LABELS[detail.classification.category]}
                </span>
                <button onClick={() => setDetail(null)} className="text-[#6c7086] hover:text-[#e0e0ed]">✕</button>
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                <Info label="CAUSA" value={detail.classification.cause} />
                <Info label="AÇÃO SUGERIDA" value={detail.classification.action} color="text-[#a6e3a1]" />
                <Info label="PROVIDER" value={detail.provider} />
                <Info label="TENTATIVAS" value={`${detail.attempt_count}`} />
              </div>
              {detail.error_msg && (
                <div className="border border-[#2a2a38] bg-black/20 px-2 py-1.5 font-mono text-[10px] text-[#6c7086] break-all">
                  {detail.error_msg.slice(0, 300)}{detail.error_msg.length > 300 ? "…" : ""}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Info({ label, value, color = "text-[#bac2de]" }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-widest text-[#45475a]">{label}</span>
      <span className={`text-[11px] ${color}`}>{value}</span>
    </div>
  );
}
