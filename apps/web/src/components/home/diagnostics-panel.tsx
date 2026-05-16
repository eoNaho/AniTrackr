"use client";

import React, { useEffect, useState } from "react";
import { fetchDiagnostics, type DiagnosticsReport } from "@/lib/api";

export function DiagnosticsPanel() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetchDiagnostics().then(setReport).finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold text-zinc-200">Diagnóstico do Sistema</h1>
        <button
          onClick={refresh}
          className="text-xs px-3 py-1 rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500"
        >
          Atualizar
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Verificando sistema...</div>
      ) : !report ? (
        <div className="text-sm text-red-400">Falha ao buscar diagnóstico.</div>
      ) : (
        <>
          <SummaryBanner summary={report.summary} />
          <ProvidersSection providers={report.providers} />
          <QBittorrentSection qbt={report.qbittorrent} />
          <DownloadPathSection path={report.downloadPath} />
          <RecentFailuresSection failures={report.recentFailures} />
        </>
      )}
    </div>
  );
}

function SummaryBanner({ summary }: { summary: DiagnosticsReport["summary"] }) {
  return (
    <div
      className={`p-3 rounded border ${
        summary.hasIssues
          ? "border-red-800 bg-red-950/30 text-red-400"
          : "border-green-800 bg-green-950/30 text-green-400"
      }`}
    >
      <p className="text-sm font-bold">
        {summary.hasIssues
          ? `${summary.providersDown} provider(s) offline · ${summary.recentFailures} falha(s) recente(s)`
          : "Sistema funcionando normalmente"}
      </p>
    </div>
  );
}

function ProvidersSection({ providers }: { providers: DiagnosticsReport["providers"] }) {
  const all = Object.entries(providers.all);
  return (
    <section>
      <h3 className="text-xs uppercase tracking-widest text-zinc-500 mb-2 font-bold">Providers</h3>
      <div className="flex flex-col gap-1">
        {all.map(([name, h]) => (
          <div key={name} className="flex items-center gap-2 text-xs p-2 bg-zinc-900 rounded">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                h.state === "closed" ? "bg-green-500"
                : h.state === "open" ? "bg-red-500"
                : "bg-yellow-500"
              }`}
            />
            <span className="font-mono text-zinc-300 w-28 truncate">{name}</span>
            <span className={`${h.state === "open" ? "text-red-400" : "text-zinc-600"}`}>
              {h.state}
            </span>
            {h.failures > 0 && (
              <span className="text-zinc-600 ml-auto">{h.failures} falha(s)</span>
            )}
          </div>
        ))}
        {all.length === 0 && (
          <p className="text-xs text-zinc-600">Nenhum provider monitorado ainda.</p>
        )}
      </div>
    </section>
  );
}

function QBittorrentSection({ qbt }: { qbt: DiagnosticsReport["qbittorrent"] }) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-widest text-zinc-500 mb-2 font-bold">qBittorrent</h3>
      <div className="flex items-center gap-2 text-xs p-2 bg-zinc-900 rounded">
        <span
          className={`w-2 h-2 rounded-full ${
            !qbt.enabled ? "bg-zinc-600"
            : qbt.connected ? "bg-green-500"
            : "bg-red-500"
          }`}
        />
        <span className={
          !qbt.enabled ? "text-zinc-500"
          : qbt.connected ? "text-green-400"
          : "text-red-400"
        }>
          {!qbt.enabled ? "Desabilitado" : qbt.connected ? `Conectado (v${qbt.version ?? "?"})` : "Offline"}
        </span>
      </div>
    </section>
  );
}

function DownloadPathSection({ path }: { path: DiagnosticsReport["downloadPath"] }) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-widest text-zinc-500 mb-2 font-bold">Pasta de Downloads</h3>
      <div className="flex items-center gap-2 text-xs p-2 bg-zinc-900 rounded">
        <span className={`w-2 h-2 rounded-full ${path.accessible ? "bg-green-500" : "bg-red-500"}`} />
        <span className={`font-mono truncate ${path.accessible ? "text-zinc-300" : "text-red-400"}`}>
          {path.path || "(não configurado)"}
        </span>
        {!path.accessible && <span className="text-red-400 ml-auto flex-shrink-0">inacessível</span>}
      </div>
    </section>
  );
}

function RecentFailuresSection({ failures }: { failures: DiagnosticsReport["recentFailures"] }) {
  if (!failures.length) return null;
  return (
    <section>
      <h3 className="text-xs uppercase tracking-widest text-zinc-500 mb-2 font-bold">
        Falhas Recentes (24h) — {failures.length}
      </h3>
      <div className="flex flex-col gap-1">
        {failures.slice(0, 10).map((f, i) => (
          <div key={i} className="text-xs p-2 bg-zinc-900 rounded border border-zinc-800">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Ep {f.episode_number}</span>
              <span className="text-red-400 font-mono">{f.last_error_code ?? "UNKNOWN"}</span>
            </div>
            {f.error_msg && (
              <p className="text-zinc-600 mt-0.5 truncate">{f.error_msg}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
