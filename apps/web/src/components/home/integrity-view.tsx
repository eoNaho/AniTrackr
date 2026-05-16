"use client";

import React, { useEffect, useState } from "react";
import { fetchIntegrity, type IntegrityReport } from "@/lib/api";
import { Panel, TuiButton, TuiEmpty, TuiInfoBox, TuiSection } from "./ui";

export function IntegrityView() {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetchIntegrity().then(setReport).finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="grid h-full min-h-0 gap-[14px] overflow-hidden xl:grid-cols-[320px_1fr]">
      <Panel title="Integrity :: Audit Shell" focused className="min-h-0">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#cba6f7]">library.audit()</div>
            <TuiButton onClick={refresh}>recheck</TuiButton>
          </div>

          {loading ? (
            <TuiEmpty>Scanning library...</TuiEmpty>
          ) : !report ? (
            <TuiEmpty className="text-[#f38ba8]">Could not verify integrity.</TuiEmpty>
          ) : (
            <>
              <div className="grid gap-2">
                <TuiInfoBox label="Total Issues" value={report.summary.totalIssues} tone={report.summary.hasIssues ? "warning" : "success"} />
                <TuiInfoBox label="Orphaned Files" value={report.orphanedFiles.count} tone={report.orphanedFiles.count > 0 ? "danger" : "success"} />
                <TuiInfoBox label="Duplicate Eps" value={report.duplicateEpisodes.count} tone={report.duplicateEpisodes.count > 0 ? "warning" : "success"} />
              </div>
              <TuiSection
                title="Summary"
                subtitle={report.summary.hasIssues ? "Integrity checks found actionable drift." : "Library looks clean."}
              >
                <div className={`px-4 py-3 text-[12px] ${report.summary.hasIssues ? "text-[#f9e2af]" : "text-[#a6e3a1]"}`}>
                  {report.summary.hasIssues ? `${report.summary.totalIssues} issue(s) found` : "No structural issues detected"}
                </div>
              </TuiSection>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Integrity :: Findings" className="min-h-0">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          {loading ? (
            <TuiEmpty>Scanning library...</TuiEmpty>
          ) : !report ? (
            <TuiEmpty className="text-[#f38ba8]">Could not verify integrity.</TuiEmpty>
          ) : (
            <>
              <IssueSection
                title="Orphaned Files"
                count={report.orphanedFiles.count}
                description="Episodes marked as downloaded in the database but missing on disk."
                items={report.orphanedFiles.items.map((item) => `EP ${item.number} :: ${item.file_path}`)}
              />
              <IssueSection
                title="Duplicate Episodes"
                count={report.duplicateEpisodes.count}
                description="The same episode was registered more than once for the same title and season."
                items={report.duplicateEpisodes.items.map((item) => `S${item.season}E${item.number} (${item.count}x)`)}
              />
              <IssueSection
                title="Missing Posters"
                count={report.missingMetadata.noPoster.count}
                description="Titles without cover art."
                items={report.missingMetadata.noPoster.items.map((item) => item.title)}
              />
              <IssueSection
                title="Missing Synopses"
                count={report.missingMetadata.noSynopsis.count}
                description="Titles without a summary."
                items={report.missingMetadata.noSynopsis.items.map((item) => item.title)}
              />
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

function IssueSection({
  title,
  count,
  description,
  items,
}: {
  title: string;
  count: number;
  description: string;
  items: string[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <TuiSection title={`${title} :: ${count}`} subtitle={description}>
      <div className="p-4">
        <button
          onClick={() => count > 0 && setExpanded((value) => !value)}
          className="flex w-full items-center justify-between border border-[#45475a] bg-[#11111a] px-3 py-3 text-left"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#bac2de]">{title}</p>
            <p className="mt-0.5 text-xs text-[#6c7086]">{description}</p>
          </div>
          <span className={`ml-4 shrink-0 font-mono text-sm font-bold ${count > 0 ? "text-[#f9e2af]" : "text-[#a6e3a1]"}`}>
            {count}
          </span>
        </button>

        {expanded && items.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1 border border-t-0 border-[#45475a] bg-black/10 p-3">
            {items.slice(0, 20).map((item, index) => (
              <p key={index} className="truncate font-mono text-xs text-[#8b90a8]">
                {item}
              </p>
            ))}
            {items.length > 20 ? <p className="text-xs text-[#6c7086]">... and {items.length - 20} more</p> : null}
          </div>
        ) : null}
      </div>
    </TuiSection>
  );
}
