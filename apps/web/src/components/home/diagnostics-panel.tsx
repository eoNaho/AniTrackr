"use client";

import React, { useEffect, useState } from "react";
import { fetchDiagnostics, type DiagnosticsReport } from "@/lib/api";
import { Panel, TuiButton, TuiEmpty, TuiInfoBox, TuiSection } from "./ui";

export function DiagnosticsPanel() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetchDiagnostics()
      .then(setReport)
      .catch((err) => {
        setReport(null);
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

  return (
    <div className="grid h-full min-h-0 gap-[14px] overflow-hidden xl:grid-cols-[320px_1fr]">
      <Panel title="Diagnostics :: Runtime Shell" focused className="min-h-0">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#cba6f7]">health.check()</div>
            <TuiButton onClick={refresh}>refresh</TuiButton>
          </div>

          {loading ? (
            <TuiEmpty>Checking runtime...</TuiEmpty>
          ) : !report ? (
            <TuiEmpty className="text-[#f38ba8]">{error ?? "Could not load diagnostics."}</TuiEmpty>
          ) : (
            <>
              <div className="grid gap-2">
                <TuiInfoBox label="Providers Down" value={report.summary.providersDown} tone={report.summary.providersDown > 0 ? "danger" : "success"} />
                <TuiInfoBox label="Recent Failures" value={report.summary.recentFailures} tone={report.summary.recentFailures > 0 ? "warning" : "success"} />
                <TuiInfoBox label="Real Downloads" value={report.runtime.realDownloadsReady ? "READY" : "PENDING"} tone={report.runtime.realDownloadsReady ? "success" : "warning"} />
              </div>
              <TuiSection
                title="Summary"
                subtitle={
                  report.summary.hasIssues
                    ? `${report.summary.providersDown} provider(s) degraded :: ${report.summary.recentFailures} recent failure(s)`
                    : "Runtime looks healthy"
                }
              >
                <div className="px-4 py-3 text-[12px] text-[#6c7086]">
                  Mode: {report.runtime.simulationEnabled ? "simulation fallback enabled" : "real downloads only"}
                </div>
              </TuiSection>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Diagnostics :: Runtime Report" className="min-h-0">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          {loading ? (
            <TuiEmpty>Checking runtime...</TuiEmpty>
          ) : !report ? (
            <TuiEmpty className="text-[#f38ba8]">{error ?? "Could not load diagnostics."}</TuiEmpty>
          ) : (
            <>
              <RuntimeSection runtime={report.runtime} />
              <ProvidersSection providers={report.providers} />
              <QBittorrentSection qbt={report.qbittorrent} />
              <DownloadPathSection path={report.downloadPath} />
              <RecentFailuresSection failures={report.recentFailures} />
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

function RuntimeSection({ runtime }: { runtime: DiagnosticsReport["runtime"] }) {
  const rows = [
    {
      label: "yt-dlp",
      value: runtime.ytDlpPath,
      ok: runtime.ytDlpAvailable,
      okLabel: runtime.ytDlpAvailable ? "available" : "missing",
    },
    {
      label: "ffmpeg",
      value: runtime.ffmpegPath,
      ok: runtime.ffmpegAvailable,
      okLabel: runtime.ffmpegAvailable ? "available" : "missing",
    },
    {
      label: "mode",
      value: runtime.simulationEnabled ? "simulation fallback enabled" : "real downloads only",
      ok: !runtime.simulationEnabled,
      okLabel: runtime.simulationEnabled ? "dev mode" : "strict",
    },
  ];

  return (
    <TuiSection title="Runtime" subtitle="Binary paths and execution mode for the real download stack.">
      <div className="flex flex-col gap-2 p-4">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 border border-[#45475a] bg-[#11111a] p-2 text-xs">
            <span className={`h-2 w-2 ${row.ok ? "bg-[#a6e3a1]" : "bg-[#f9e2af]"}`} />
            <span className="w-20 shrink-0 font-mono text-[#bac2de]">{row.label}</span>
            <span className="min-w-0 flex-1 truncate text-[#8b90a8]">{row.value}</span>
            <span className={row.ok ? "text-[#a6e3a1]" : "text-[#f9e2af]"}>{row.okLabel}</span>
          </div>
        ))}
        <p className={`text-xs ${runtime.realDownloadsReady ? "text-[#a6e3a1]" : "text-[#f9e2af]"}`}>
          {runtime.realDownloadsReady
            ? "Real download prerequisites are ready."
            : "Real downloads are not fully ready yet."}
        </p>
      </div>
    </TuiSection>
  );
}

function ProvidersSection({ providers }: { providers: DiagnosticsReport["providers"] }) {
  const all = Object.entries(providers.all);
  return (
    <TuiSection title="Providers" subtitle="Circuit-breaker state across monitored content sources.">
      <div className="flex flex-col gap-1 p-4">
        {all.map(([name, health]) => (
          <div key={name} className="flex items-center gap-2 border border-[#45475a] bg-[#11111a] p-2 text-xs">
            <span
              className={`h-2 w-2 ${
                health.state === "closed"
                  ? "bg-[#a6e3a1]"
                  : health.state === "open"
                  ? "bg-[#f38ba8]"
                  : "bg-[#f9e2af]"
              }`}
            />
            <span className="w-28 truncate font-mono text-[#bac2de]">{name}</span>
            <span className={health.state === "open" ? "text-[#f38ba8]" : "text-[#8b90a8]"}>{health.state}</span>
            {health.failures > 0 ? <span className="ml-auto text-[#6c7086]">{health.failures} failure(s)</span> : null}
          </div>
        ))}
        {all.length === 0 ? <TuiEmpty>No monitored providers yet.</TuiEmpty> : null}
      </div>
    </TuiSection>
  );
}

function QBittorrentSection({ qbt }: { qbt: DiagnosticsReport["qbittorrent"] }) {
  return (
    <TuiSection title="qBittorrent" subtitle="WebUI status and transport readiness for torrent mode.">
      <div className="p-4">
        <div className="flex items-center gap-2 border border-[#45475a] bg-[#11111a] p-2 text-xs">
          <span
            className={`h-2 w-2 ${
              !qbt.enabled ? "bg-[#6c7086]" : qbt.connected ? "bg-[#a6e3a1]" : "bg-[#f38ba8]"
            }`}
          />
          <span className={!qbt.enabled ? "text-[#6c7086]" : qbt.connected ? "text-[#a6e3a1]" : "text-[#f38ba8]"}>
            {!qbt.enabled ? "Disabled" : qbt.connected ? `Connected (${qbt.version ?? "?"})` : "Offline"}
          </span>
        </div>
      </div>
    </TuiSection>
  );
}

function DownloadPathSection({ path }: { path: DiagnosticsReport["downloadPath"] }) {
  return (
    <TuiSection title="Download Path" subtitle="Filesystem target currently configured for finalized media files.">
      <div className="p-4">
        <div className="flex items-center gap-2 border border-[#45475a] bg-[#11111a] p-2 text-xs">
          <span className={`h-2 w-2 ${path.accessible ? "bg-[#a6e3a1]" : "bg-[#f38ba8]"}`} />
          <span className={`truncate font-mono ${path.accessible ? "text-[#bac2de]" : "text-[#f38ba8]"}`}>
            {path.path || "(not configured)"}
          </span>
          {!path.accessible ? <span className="ml-auto shrink-0 text-[#f38ba8]">unavailable</span> : null}
        </div>
      </div>
    </TuiSection>
  );
}

function RecentFailuresSection({ failures }: { failures: DiagnosticsReport["recentFailures"] }) {
  if (!failures.length) return null;

  return (
    <TuiSection title={`Recent Failures :: ${failures.length}`} subtitle="Latest job failures captured in the last 24 hours.">
      <div className="flex flex-col gap-1 p-4">
        {failures.slice(0, 10).map((failure, index) => (
          <div key={index} className="border border-[#45475a] bg-[#11111a] p-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[#6c7086]">EP {failure.episode_number}</span>
              <span className="font-mono text-[#f38ba8]">{failure.last_error_code ?? "UNKNOWN"}</span>
            </div>
            {failure.error_msg ? <p className="mt-0.5 truncate text-[#8b90a8]">{failure.error_msg}</p> : null}
          </div>
        ))}
      </div>
    </TuiSection>
  );
}
