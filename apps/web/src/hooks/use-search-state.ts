"use client";

import { useCallback, useRef, useState } from "react";
import { fetchMetadataSearch, searchAnime, searchEpisodes, type KitsuMetadata, type ProviderSearchStat, type SearchResult } from "@/lib/api";

export type SearchEpisode = { key: string; number: number; label: string; url: string };

// ── episode/season inference utilities ──────────────────────────────────────

function normalizeAscii(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function parseSafePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return null;
  return n;
}

function parseRomanNumeral(value: string): number | null {
  const roman = value.trim().toUpperCase();
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0, prev = 0;
  for (let i = roman.length - 1; i >= 0; i -= 1) {
    const cur = map[roman[i]];
    if (!cur) return null;
    if (cur < prev) total -= cur; else total += cur;
    prev = cur;
  }
  if (total <= 0 || total > 100) return null;
  return total;
}

const JAPANESE_NUMBER_MAP: Record<string, number> = {
  ichi: 1, ni: 2, san: 3, yon: 4, shi: 4, go: 5,
  roku: 6, nana: 7, shichi: 7, hachi: 8, kyu: 9, ku: 9, juu: 10,
};

export function inferSeasonNumber(...candidates: Array<string | null | undefined>): number {
  for (const rawCandidate of candidates) {
    if (!rawCandidate) continue;
    const candidate = normalizeAscii(rawCandidate);
    const direct =
      candidate.match(/\b(?:season|temporada)\s*(\d{1,2})\b/i)
      ?? candidate.match(/\b(\d{1,2})(?:st|nd|rd|th)\s*season\b/i)
      ?? candidate.match(/\bs(?:eason)?\s*0?(\d{1,2})\b/i)
      ?? candidate.match(/\b(\d{1,2})\s*no\s*shou\b/i);
    if (direct) { const p = parseSafePositiveInt(direct[1]); if (p != null) return p; }
    const roman = candidate.match(/\b(?:season|temporada)\s*([ivxlc]{1,5})\b/i);
    if (roman) { const p = parseRomanNumeral(roman[1]); if (p != null) return p; }
    const jpNoShou = candidate.match(/\b([a-z]+)\s+no\s+shou\b/i);
    if (jpNoShou) { const p = JAPANESE_NUMBER_MAP[jpNoShou[1]]; if (p != null) return p; }
  }
  return 1;
}

function inferEpisodeNumberFromUrl(url: string): number | null {
  if (!url?.trim()) return null;
  const raw = url.trim();
  const rawEpisode = raw.match(/(?:episodio|episode|ep)[-_/ ]*(\d{1,4})(?:\b|$)/i);
  if (rawEpisode) return parseSafePositiveInt(rawEpisode[1]);
  try {
    const parsed = new URL(raw);
    const fromQuery =
      parseSafePositiveInt(parsed.searchParams.get("ep"))
      ?? parseSafePositiveInt(parsed.searchParams.get("episode"))
      ?? parseSafePositiveInt(parsed.searchParams.get("episodio"));
    if (fromQuery != null) return fromQuery;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.length > 0 ? segments[segments.length - 1] : "";
    if (/^\d{1,4}$/.test(last)) return parseSafePositiveInt(last);
  } catch { /* ignore */ }
  return null;
}

function inferEpisodeNumber(episode: { number: number; label: string; url: string }, fallback: number): number {
  const fromUrl = inferEpisodeNumberFromUrl(episode.url);
  if (fromUrl != null) return fromUrl;
  const fromLabel = normalizeAscii(episode.label).match(/\b(?:episodio|episode|ep)\s*\.?\s*(\d{1,4})\b/i);
  if (fromLabel) { const p = parseSafePositiveInt(fromLabel[1]); if (p != null) return p; }
  if (Number.isFinite(episode.number) && episode.number > 0) return episode.number;
  return fallback;
}

function buildEpisodeKey(episode: { number: number; label: string; url: string }, index: number) {
  return `${episode.number}::${episode.url}::${episode.label}::${index}`;
}

// ── hook ────────────────────────────────────────────────────────────────────

export function useSearchState(pushLog: (module: string, text: string) => void) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSource, setSearchSource] = useState("all");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchProviderStats, setSearchProviderStats] = useState<Record<string, ProviderSearchStat> | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [kitsuMeta, setKitsuMeta] = useState<KitsuMetadata | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [episodes, setEpisodes] = useState<SearchEpisode[]>([]);
  const [selectedEpisodes, setSelectedEpisodes] = useState<string[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);

  const selectVersionRef = useRef(0);

  const runSearch = useCallback(async (rawQuery: string, sourceOverride?: string) => {
    const effectiveQuery = rawQuery.trim();
    const effectiveSource = sourceOverride ?? searchSource;
    if (effectiveQuery.length < 2) return;
    setSearchResults([]);
    setSearchProviderStats(null);
    setSelectedResult(null);
    setKitsuMeta(null);
    setEpisodes([]);
    setSelectedEpisodes([]);
    try {
      const res = await searchAnime(effectiveQuery, effectiveSource);
      setSearchResults(res.results ?? []);
      setSearchProviderStats(res.providerStats ?? null);
      pushLog("search", `"${effectiveQuery}" -> ${res.results?.length ?? 0} resultados`);
    } catch (e) {
      pushLog("search", `erro: ${(e as Error).message}`);
    }
  }, [searchSource, pushLog]);

  const handleSelectResult = useCallback(async (result: SearchResult) => {
    selectVersionRef.current += 1;
    const version = selectVersionRef.current;

    setSelectedResult(result);
    setEpisodes([]);
    setSelectedEpisodes([]);
    setKitsuMeta(null);
    setIsLoadingMeta(true);
    setIsLoadingEpisodes(true);

    fetchMetadataSearch(result.title.split(" [")[0].split(" ·")[0], "kitsu")
      .then((res) => {
        if (selectVersionRef.current !== version) return;
        if (res.results?.length) {
          setKitsuMeta(res.results[0]);
          pushLog("meta", `kitsu: ${res.results[0].title}`);
        } else {
          pushLog("meta", "kitsu: sem resultado");
        }
      })
      .catch(() => { if (selectVersionRef.current === version) pushLog("meta", "kitsu: falha"); })
      .finally(() => { if (selectVersionRef.current === version) setIsLoadingMeta(false); });

    if (result.provider === "nyaa") {
      const nyaaEp: SearchEpisode = {
        key: `nyaa::${result.id ?? result.url ?? "0"}`,
        number: 1,
        label: "▼ Adicionar ao qBittorrent",
        url: result.url ?? "",
      };
      setEpisodes([nyaaEp]);
      setSelectedEpisodes([nyaaEp.key]);
      setIsLoadingEpisodes(false);
      return;
    }

    searchEpisodes({ provider: result.provider ?? "all", url: result.url, allAnimeId: result.allAnimeId ?? result.id })
      .then((res) => {
        if (selectVersionRef.current !== version) return;
        const eps: SearchEpisode[] = (res.episodes ?? [])
          .map((episode, index) => {
            const normalized = { ...episode, number: inferEpisodeNumber(episode, index + 1), label: episode.label || `Episódio ${index + 1}` };
            return { ...normalized, key: buildEpisodeKey(normalized, index) };
          })
          .sort((a, b) => a.number - b.number);
        setEpisodes(eps);
        setSelectedEpisodes(eps.slice(0, 1).map((e) => e.key));
        pushLog("search", `${result.title}: ${res.total} eps`);
      })
      .catch((e) => { if (selectVersionRef.current === version) pushLog("search", `eps erro: ${(e as Error).message}`); })
      .finally(() => { if (selectVersionRef.current === version) setIsLoadingEpisodes(false); });
  }, [pushLog]);

  const toggleEpisode = useCallback((key: string) => {
    setSelectedEpisodes((cur) => cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  }, []);

  const selectAllEpisodes = useCallback(() => {
    setEpisodes((eps) => { setSelectedEpisodes(eps.map((e) => e.key)); return eps; });
  }, []);

  const clearAllEpisodes = useCallback(() => { setSelectedEpisodes([]); }, []);

  return {
    searchQuery, setSearchQuery,
    searchSource, setSearchSource,
    searchResults,
    searchProviderStats,
    selectedResult,
    kitsuMeta,
    isLoadingMeta,
    episodes,
    selectedEpisodes,
    isLoadingEpisodes,
    runSearch,
    handleSelectResult,
    toggleEpisode,
    selectAllEpisodes,
    clearAllEpisodes,
  };
}
