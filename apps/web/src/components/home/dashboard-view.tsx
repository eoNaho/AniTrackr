"use client";

import React, { useEffect, useState } from "react";
import { fetchDashboard, type DashboardAnime, type DashboardData } from "@/lib/api";

interface Props {
  onSelectAnime?: (id: string) => void;
}

export function DashboardView({ onSelectAnime }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboard().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-zinc-500">Carregando painel...</div>;
  }

  if (!data) {
    return <div className="p-6 text-sm text-zinc-500">Nenhum dado disponível.</div>;
  }

  const totalItems =
    data.recentlyDownloaded.length +
    data.inProgress.length +
    data.missingEpisodes.length +
    data.completed.length;

  if (totalItems === 0) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <p className="text-sm font-bold text-zinc-400">Painel ainda sem atividade</p>
        <div className="flex flex-col gap-2 text-xs text-zinc-600">
          <p>
            <span className="text-zinc-400">Baixados recentemente</span> — aparece após o primeiro download concluído nos últimos 7 dias.
          </p>
          <p>
            <span className="text-zinc-400">Em progresso</span> — aparece quando um anime tem alguns episódios baixados mas não todos.
          </p>
          <p>
            <span className="text-zinc-400">Episódios faltando</span> — aparece em animes rastreados com lacunas na biblioteca.
          </p>
          <p>
            <span className="text-zinc-400">Completos</span> — aparece quando todos os episódios de um anime foram baixados.
          </p>
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Acesse <span className="text-zinc-400">Busca</span> para adicionar animes à biblioteca e iniciar downloads.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-4 overflow-y-auto">
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
