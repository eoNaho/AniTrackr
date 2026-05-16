"use client";

import React, { useEffect, useState } from "react";
import { fetchIntegrity, type IntegrityReport } from "@/lib/api";

export function IntegrityView() {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetchIntegrity().then(setReport).finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold text-zinc-200">Integridade da Biblioteca</h1>
        <button
          onClick={refresh}
          className="text-xs px-3 py-1 rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500"
        >
          Reverificar
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Verificando biblioteca...</div>
      ) : !report ? (
        <div className="text-sm text-red-400">Falha ao verificar integridade.</div>
      ) : (
        <>
          <div
            className={`p-3 rounded border ${
              report.summary.hasIssues
                ? "border-yellow-800 bg-yellow-950/20 text-yellow-400"
                : "border-green-800 bg-green-950/20 text-green-400"
            }`}
          >
            <p className="text-sm font-bold">
              {report.summary.hasIssues
                ? `${report.summary.totalIssues} problema(s) encontrado(s)`
                : "Biblioteca íntegra — nenhum problema detectado"}
            </p>
          </div>

          <IssueSection
            title="Arquivos Ausentes no Disco"
            count={report.orphanedFiles.count}
            description="Episódios com status 'downloaded' no banco mas sem arquivo correspondente no disco."
            items={report.orphanedFiles.items.map((i) => `Ep ${i.number} — ${i.file_path}`)}
          />

          <IssueSection
            title="Episódios Duplicados"
            count={report.duplicateEpisodes.count}
            description="Mesmo episódio registrado mais de uma vez para o mesmo anime e temporada."
            items={report.duplicateEpisodes.items.map((i) => `S${i.season}E${i.number} (${i.count}×)`)}
          />

          <IssueSection
            title="Sem Poster"
            count={report.missingMetadata.noPoster.count}
            description="Animes sem imagem de capa — podem afetar a exibição na biblioteca."
            items={report.missingMetadata.noPoster.items.map((i) => i.title)}
          />

          <IssueSection
            title="Sem Sinopse"
            count={report.missingMetadata.noSynopsis.count}
            description="Animes sem descrição — use 'Enriquecer' para buscar via AniList."
            items={report.missingMetadata.noSynopsis.items.map((i) => i.title)}
          />
        </>
      )}
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
    <section className="border border-zinc-800 rounded">
      <button
        onClick={() => count > 0 && setExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <div>
          <p className="text-xs font-bold text-zinc-300">{title}</p>
          <p className="text-xs text-zinc-600 mt-0.5">{description}</p>
        </div>
        <span
          className={`text-sm font-mono font-bold flex-shrink-0 ml-4 ${
            count > 0 ? "text-yellow-400" : "text-green-400"
          }`}
        >
          {count}
        </span>
      </button>

      {expanded && items.length > 0 && (
        <div className="border-t border-zinc-800 p-3 flex flex-col gap-1">
          {items.slice(0, 20).map((item, i) => (
            <p key={i} className="text-xs text-zinc-500 font-mono truncate">
              {item}
            </p>
          ))}
          {items.length > 20 && (
            <p className="text-xs text-zinc-600">... e mais {items.length - 20}</p>
          )}
        </div>
      )}
    </section>
  );
}
