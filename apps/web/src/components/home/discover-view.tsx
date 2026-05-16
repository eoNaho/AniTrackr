"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  deleteAnimeRules,
  fetchAnimeRules,
  fetchCollections,
  fetchFranchise,
  fetchFranchises,
  fetchRandomDiscover,
  fetchRecommendations,
  saveAnimeRules,
  updateWatchStatus,
  type AnimeRule,
  type CollectionsData,
  type DiscoverRandomPick,
  type FranchiseData,
  type WatchStatus,
} from "@/lib/api";
import { Panel, TuiButton, TuiEmpty, TuiInfoBox, TuiInput, TuiSection, TuiSelect } from "./ui";
import type { AnimeView } from "./ui";

type Props = {
  selectedAnime: AnimeView | null;
  onRefreshLibrary: () => Promise<void>;
  onOpenSearch: (title: string) => Promise<void> | void;
};

const WATCH_STATUS_OPTIONS: WatchStatus[] = ["none", "planned", "watching", "paused", "completed", "dropped"];
const RANDOM_MODES = [
  { value: "mixed", label: "mixed" },
  { value: "releasing", label: "releasing" },
  { value: "backlog", label: "backlog" },
  { value: "hidden", label: "hidden gems" },
] as const;

type RuleDraft = {
  preferredProvider: string;
  preferredQuality: string;
  preferredDownloadType: string;
  preferredLanguage: string;
  autoDownload: number;
  queuePriority: number;
};

const EMPTY_RULES: RuleDraft = {
  preferredProvider: "",
  preferredQuality: "",
  preferredDownloadType: "",
  preferredLanguage: "",
  autoDownload: 1,
  queuePriority: 0,
};

function mapRules(rule: AnimeRule | null): RuleDraft {
  if (!rule) return EMPTY_RULES;
  return {
    preferredProvider: rule.preferred_provider ?? "",
    preferredQuality: rule.preferred_quality ?? "",
    preferredDownloadType: rule.preferred_download_type ?? "",
    preferredLanguage: rule.preferred_language ?? "",
    autoDownload: rule.auto_download ?? 1,
    queuePriority: rule.queue_priority ?? 0,
  };
}

export function DiscoverView({ selectedAnime, onRefreshLibrary, onOpenSearch }: Props) {
  const [collections, setCollections] = useState<CollectionsData | null>(null);
  const [franchises, setFranchises] = useState<Array<{ series_title: string; season_count: number; total_eps: number; downloaded_count: number }>>([]);
  const [selectedFranchise, setSelectedFranchise] = useState<string>("");
  const [franchiseDetails, setFranchiseDetails] = useState<FranchiseData | null>(null);
  const [recommendations, setRecommendations] = useState<Array<{ anilistId: number; title: string | null; titleRomaji: string; relationType: string; format: string }>>([]);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>((selectedAnime?.watchStatus as WatchStatus) ?? "none");
  const [rules, setRules] = useState<RuleDraft>(EMPTY_RULES);
  const [rulesStatus, setRulesStatus] = useState<string | null>(null);
  const [savingRules, setSavingRules] = useState(false);
  const [randomMode, setRandomMode] = useState<(typeof RANDOM_MODES)[number]["value"]>("mixed");
  const [randomLoading, setRandomLoading] = useState(true);
  const [randomMeta, setRandomMeta] = useState<{ mode: string; genre: string; page: number; total: number } | null>(null);
  const [randomPicks, setRandomPicks] = useState<DiscoverRandomPick[]>([]);
  const [randomError, setRandomError] = useState<string | null>(null);

  useEffect(() => {
    fetchCollections().then(setCollections).catch(() => setCollections(null));
    fetchFranchises()
      .then((data) => {
        setFranchises(data.franchises);
        if (!selectedFranchise && data.franchises.length > 0) {
          setSelectedFranchise(data.franchises[0].series_title);
        }
      })
      .catch(() => setFranchises([]));
  }, [selectedFranchise]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!selectedFranchise) {
        setFranchiseDetails(null);
        return;
      }
      fetchFranchise(selectedFranchise).then(setFranchiseDetails).catch(() => setFranchiseDetails(null));
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedFranchise]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setWatchStatus((selectedAnime?.watchStatus as WatchStatus) ?? "none");
      setRulesStatus(null);

      if (!selectedAnime) {
        setRecommendations([]);
        setRecommendationError(null);
        setRules(EMPTY_RULES);
        return;
      }

      fetchRecommendations(selectedAnime.id)
        .then((data) => {
          setRecommendations(data.recommendations);
          setRecommendationError(null);
        })
        .catch((error) => {
          setRecommendations([]);
          setRecommendationError((error as Error).message);
        });

      fetchAnimeRules(selectedAnime.id)
        .then((rule) => setRules(mapRules(rule)))
        .catch(() => setRules(EMPTY_RULES));
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedAnime]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadRandomPicks(randomMode);
    }, 0);
    return () => clearTimeout(timer);
  }, [randomMode]);

  const collectionRows = useMemo<Array<[string, number]>>(() => {
    if (!collections) return [];
    return [
      ["releasing", collections.releasing.length],
      ["complete", collections.complete.length],
      ["failures", collections.withRecentFailures.length],
      ["unwatched", collections.unwatched.length],
      ["metadata", collections.incompleteMetadata.length],
      ["paused", collections.paused.length],
    ];
  }, [collections]);

  async function loadRandomPicks(mode: string) {
    setRandomLoading(true);
    setRandomError(null);
    try {
      const result = await fetchRandomDiscover(mode, 6);
      setRandomMeta({
        mode: result.mode,
        genre: result.genre,
        page: result.page,
        total: result.total,
      });
      setRandomPicks(result.picks);
    } catch (error) {
      setRandomPicks([]);
      setRandomMeta(null);
      setRandomError((error as Error).message);
    } finally {
      setRandomLoading(false);
    }
  }

  async function handleWatchStatusSave() {
    if (!selectedAnime) return;
    setSavingRules(true);
    setRulesStatus(null);
    try {
      await updateWatchStatus(selectedAnime.id, watchStatus);
      await onRefreshLibrary();
      setRulesStatus("watch status updated");
    } catch (error) {
      setRulesStatus(`could not update watch status: ${(error as Error).message}`);
    } finally {
      setSavingRules(false);
    }
  }

  async function handleRulesSave() {
    if (!selectedAnime) return;
    setSavingRules(true);
    setRulesStatus(null);
    try {
      await saveAnimeRules(selectedAnime.id, rules);
      setRulesStatus("automation rules saved");
    } catch (error) {
      setRulesStatus(`could not save rules: ${(error as Error).message}`);
    } finally {
      setSavingRules(false);
    }
  }

  async function handleRulesReset() {
    if (!selectedAnime) return;
    setSavingRules(true);
    setRulesStatus(null);
    try {
      await deleteAnimeRules(selectedAnime.id);
      setRules(EMPTY_RULES);
      setRulesStatus("automation rules cleared");
    } catch (error) {
      setRulesStatus(`could not clear rules: ${(error as Error).message}`);
    } finally {
      setSavingRules(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 gap-[14px] overflow-hidden xl:grid-cols-[1.08fr_0.92fr]">
      <Panel title="Discover :: Decision Center" focused className="min-h-0">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          {!selectedAnime ? (
            <TuiEmpty>Select an anime in the library to unlock recommendations and strategy controls.</TuiEmpty>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-3">
                <TuiInfoBox label="Provider" value={selectedAnime.provider} tone="info" />
                <TuiInfoBox label="Progress" value={`${selectedAnime.downloaded}/${selectedAnime.total}`} tone="success" />
                <TuiInfoBox label="Missing" value={selectedAnime.missing} tone={selectedAnime.missing > 0 ? "warning" : "success"} />
              </div>

              <TuiSection title="Selected Anime" subtitle="Current library focus for watch strategy, automation and franchise follow-up.">
                <div className="p-4">
                  <div className="text-[18px] font-bold text-[#e0e0ed]">{selectedAnime.title}</div>
                  <div className="mt-1 text-[12px] text-[#6c7086]">
                    Provider: {selectedAnime.provider} :: Progress {selectedAnime.downloaded}/{selectedAnime.total}
                  </div>
                </div>
              </TuiSection>

              <TuiSection title="Watch Strategy" subtitle="Operational status used by scheduling and discover surfaces.">
                <div className="flex flex-wrap items-center gap-2 p-4">
                  <TuiSelect value={watchStatus} onChange={(value) => setWatchStatus(value as WatchStatus)}>
                    {WATCH_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </TuiSelect>
                  <TuiButton onClick={() => void handleWatchStatusSave()} disabled={savingRules} variant="success">
                    save status
                  </TuiButton>
                </div>
              </TuiSection>

              <TuiSection title="Automation Rules" subtitle="Per-anime overrides for provider, quality, language and queue behavior.">
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  <RuleField label="Preferred provider" value={rules.preferredProvider} onChange={(value) => setRules((prev) => ({ ...prev, preferredProvider: value }))} />
                  <RuleField label="Preferred quality" value={rules.preferredQuality} onChange={(value) => setRules((prev) => ({ ...prev, preferredQuality: value }))} />
                  <RuleField label="Download type" value={rules.preferredDownloadType} onChange={(value) => setRules((prev) => ({ ...prev, preferredDownloadType: value }))} />
                  <RuleField label="Preferred language" value={rules.preferredLanguage} onChange={(value) => setRules((prev) => ({ ...prev, preferredLanguage: value }))} />
                  <RuleField
                    label="Queue priority"
                    value={String(rules.queuePriority)}
                    onChange={(value) => setRules((prev) => ({ ...prev, queuePriority: Number(value || 0) }))}
                    type="number"
                  />
                  <label className="flex items-center gap-2 border border-[#45475a] bg-[#11111a] px-3 py-2 text-sm text-[#bac2de]">
                    <input
                      type="checkbox"
                      checked={rules.autoDownload === 1}
                      onChange={(event) => setRules((prev) => ({ ...prev, autoDownload: event.target.checked ? 1 : 0 }))}
                    />
                    auto download when scheduler finds a new episode
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-dashed border-[#45475a] px-4 py-3">
                  <TuiButton onClick={() => void handleRulesSave()} disabled={savingRules} variant="primary">
                    save rules
                  </TuiButton>
                  <TuiButton onClick={() => void handleRulesReset()} disabled={savingRules} variant="danger">
                    clear rules
                  </TuiButton>
                  {rulesStatus ? <span className="self-center text-[12px] text-[#89dceb]">{rulesStatus}</span> : null}
                </div>
              </TuiSection>

              <TuiSection title="What To Add Next" subtitle="Related AniList titles that expand or complete the selected franchise.">
                <div className="flex flex-col gap-2 p-4">
                  {recommendationError ? (
                    <TuiEmpty className="text-[#f9e2af]">{recommendationError}</TuiEmpty>
                  ) : recommendations.length === 0 ? (
                    <TuiEmpty>No recommendations available for the selected anime yet.</TuiEmpty>
                  ) : (
                    recommendations.map((item) => (
                      <div key={`${item.anilistId}-${item.relationType}`} className="border border-[#45475a] bg-[#11111a] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-[#e0e0ed]">{item.title ?? item.titleRomaji}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[#6c7086]">
                              {item.relationType} :: {item.format} :: AniList #{item.anilistId}
                            </div>
                          </div>
                          <TuiButton onClick={() => void onOpenSearch(item.title ?? item.titleRomaji)} variant="info">
                            open in search
                          </TuiButton>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TuiSection>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Discover :: Random Anime Search" className="min-h-0">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          <TuiSection title="Random Anime Search" subtitle="Sorteia animes fora da biblioteca e manda o titulo direto para a busca quando voce quiser baixar.">
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <TuiSelect value={randomMode} onChange={(value) => setRandomMode(value as (typeof RANDOM_MODES)[number]["value"])}>
                  {RANDOM_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </TuiSelect>
                <TuiButton onClick={() => void loadRandomPicks(randomMode)} disabled={randomLoading} variant="primary">
                  {randomLoading ? "rolling..." : "new roll"}
                </TuiButton>
              </div>

              {randomMeta ? (
                <div className="grid gap-2 md:grid-cols-3">
                  <TuiInfoBox label="Mode" value={randomMeta.mode} tone="info" />
                  <TuiInfoBox label="Genre" value={randomMeta.genre} tone="warning" />
                  <TuiInfoBox label="Results" value={`${randomMeta.total} picks`} tone="success" />
                </div>
              ) : null}

              {randomError ? (
                <TuiEmpty className="text-[#f38ba8]">{randomError}</TuiEmpty>
              ) : randomLoading ? (
                <TuiEmpty>Rolling random anime search...</TuiEmpty>
              ) : randomPicks.length === 0 ? (
                <TuiEmpty>No random anime found right now. Try another mode or reroll.</TuiEmpty>
              ) : (
                <div className="flex flex-col gap-2">
                  {randomPicks.map((pick) => (
                    <div key={pick.anilistId} className="border border-[#45475a] bg-[#11111a] p-3">
                      <div className="flex gap-3">
                        {pick.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={pick.posterUrl} alt={pick.title} className="h-24 w-16 border border-[#45475a] object-cover" />
                        ) : (
                          <div className="h-24 w-16 border border-dashed border-[#45475a] bg-black/20" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-[#e0e0ed]">{pick.title}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[#6c7086]">
                                {pick.format} :: {pick.status} :: {pick.year ?? "?"}
                              </div>
                            </div>
                            <TuiButton onClick={() => void onOpenSearch(pick.titleEnglish ?? pick.titleRomaji ?? pick.title)} variant="info">
                              search this anime
                            </TuiButton>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase">
                            <span className="border border-[#45475a] px-2 py-0.5 text-[#f9e2af]">
                              score {pick.rating ? pick.rating.toFixed(1) : "--"}
                            </span>
                            <span className="border border-[#45475a] px-2 py-0.5 text-[#89dceb]">
                              eps {pick.episodeCount ?? "?"}
                            </span>
                            {pick.genres.slice(0, 2).map((genre) => (
                              <span key={genre} className="border border-[#45475a] px-2 py-0.5 text-[#bac2de]">
                                {genre}
                              </span>
                            ))}
                          </div>
                          {pick.synopsis ? (
                            <p className="mt-2 line-clamp-3 text-[12px] leading-[1.5] text-[#8b90a8]">
                              {pick.synopsis}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TuiSection>

          <div className="grid gap-2 md:grid-cols-2">
            {collectionRows.map(([key, count]) => (
              <TuiInfoBox key={key} label={key} value={count} tone="default" />
            ))}
          </div>

          <TuiSection title="Franchise Browser" subtitle="Season groupings already available in the backend.">
            <div className="p-4">
              {franchises.length === 0 ? (
                <TuiEmpty>No franchise groupings available yet.</TuiEmpty>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                  <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto pr-1">
                    {franchises.map((franchise) => (
                      <button
                        key={franchise.series_title}
                        onClick={() => setSelectedFranchise(franchise.series_title)}
                        className={`border px-3 py-2 text-left text-xs ${
                          selectedFranchise === franchise.series_title
                            ? "border-[#cba6f7] bg-[#cba6f7] text-[#0f0f14]"
                            : "border-[#45475a] bg-[#11111a] text-[#bac2de] hover:border-[#cba6f7] hover:text-[#cba6f7]"
                        }`}
                      >
                        <div className="truncate font-medium">{franchise.series_title}</div>
                        <div className="mt-1 text-[11px] opacity-70">
                          {franchise.season_count} season(s) :: {franchise.downloaded_count}/{franchise.total_eps}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="border border-[#45475a] bg-[#11111a] p-3">
                    {!franchiseDetails ? (
                      <TuiEmpty>Pick a franchise to inspect its seasons.</TuiEmpty>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="text-sm font-bold text-[#e0e0ed]">{franchiseDetails.seriesTitle}</div>
                        <div className="text-xs text-[#6c7086]">{franchiseDetails.totalSeasons} season(s)</div>
                        {franchiseDetails.entries.map((entry) => (
                          <div key={entry.id} className="border border-[#45475a] bg-black/10 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm text-[#e0e0ed]">{entry.title}</div>
                                <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[#6c7086]">
                                  season {entry.season_number} :: {entry.downloaded_count}/{entry.episode_count} :: {entry.watch_status}
                                </div>
                              </div>
                              <TuiButton onClick={() => void onOpenSearch(entry.title)} variant="default">
                                search title
                              </TuiButton>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </TuiSection>
        </div>
      </Panel>
    </div>
  );
}

function RuleField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[#8b90a8]">
      <span className="uppercase tracking-[0.14em]">{label}</span>
      <TuiInput type={type} value={value} onChange={onChange} />
    </label>
  );
}
