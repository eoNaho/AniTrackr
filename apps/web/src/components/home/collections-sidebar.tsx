"use client";

import React, { useEffect, useState } from "react";
import { fetchCollections, type CollectionsData } from "@/lib/api";

const LABELS: Record<keyof CollectionsData, string> = {
  releasing: "Em lançamento",
  complete: "Completos",
  withRecentFailures: "Com falhas",
  unwatched: "Não assistidos",
  incompleteMetadata: "Metadata incompleta",
  paused: "Pausados",
};

interface Props {
  onFilter: (ids: string[] | null) => void;
  activeFilter: string | null;
}

export function CollectionsSidebar({ onFilter, activeFilter }: Props) {
  const [data, setData] = useState<CollectionsData | null>(null);

  useEffect(() => {
    let active = true;
    fetchCollections()
      .then((payload) => {
        if (!active) return;
        setData(payload);
      })
      .catch(() => {
        if (!active) return;
        setData(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!data) return null;

  function select(key: keyof CollectionsData) {
    if (activeFilter === key) {
      onFilter(null);
      return;
    }
    const items = data![key] as Array<{ id: string }>;
    onFilter(items.map((i) => i.id));
  }

  return (
    <div className="flex flex-col gap-0.5 py-2">
      <p className="text-xs uppercase tracking-widest text-zinc-600 px-3 pb-1">Coleções</p>
      {(Object.keys(data) as Array<keyof CollectionsData>).map((key) => {
        const items = data![key] as unknown[];
        const isActive = activeFilter === key;
        return (
          <button
            key={key}
            onClick={() => select(key)}
            className={`w-full text-left text-xs px-3 py-1.5 flex justify-between items-center rounded transition-colors ${
              isActive
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
          >
            <span>{LABELS[key]}</span>
            <span className={`font-mono ${isActive ? "text-zinc-300" : "text-zinc-600"}`}>
              {items.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}
