const DEFAULT_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || "";

function getBackendUrl() {
  if (DEFAULT_BACKEND_URL) return DEFAULT_BACKEND_URL.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getBackendUrl()}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function requestJsonWithBodyError<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const errorMessage =
    payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : null;

  if (!response.ok) {
    throw new Error(errorMessage || `Backend request failed: ${response.status} ${response.statusText}`);
  }

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return payload as T;
}

export type BackendHealth = {
  status: string;
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  env?: {
    hasOpenSubtitlesKey?: boolean;
  };
};

export type BackendProvider = {
  key?: string;
  id?: string;
  name: string;
  supportsSearch?: boolean;
  supportsEpisodes?: boolean;
  notes?: string;
};

export type LibraryAnime = {
  id: string;
  title: string;
  titleRomaji: string | null;
  titleEnglish: string | null;
  altTitle: string | null;
  synopsis: string | null;
  posterUrl: string | null;
  coverUrl: string | null;
  asciiArt: string | null;
  episodeCount: number;
  downloadedCount: number;
  downloadStatus: string;
  quality: string;
  provider: string;
  sizeGb: number;
  localPath: string;
  nextRelease: string | null;
  tags: string[];
  progress: number;
  missingEpisodes: number;
  year: number | null;
  rating: number | null;
  kitsuId: string | null;
  watchStatus: WatchStatus;
};

export type LibrarySummary = {
  totalTitles: number;
  totalEpisodes: number;
  downloadedEpisodes: number;
  missingEpisodes: number;
  totalStorageGb: number;
  byStatus: Record<string, number>;
};

export type SearchResult = {
  id?: string;
  title: string;
  url?: string;
  imageUrl?: string;
  provider?: string;
  allAnimeId?: string;
  episodeCount?: number;
};

export type KitsuMetadata = {
  kitsuId: string;
  title: string;
  altTitle: string | null;
  synopsis: string | null;
  posterUrl: string | null;
  rating: number | null;
  status: string | null;
  episodeCount: number | null;
  year: number | null;
  subtype: string | null;
};

export type DownloadJob = {
  id: string;
  animeId: string;
  animeTitle: string;
  episodeNumber: number;
  season: number;
  status: string;
  progress: number;
  speedKbps: number;
  totalBytes: number;
  downloadedBytes: number;
  filePath: string;
  provider: string;
  quality: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMsg: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
};

export type DownloadsResponse = {
  active: number;
  total: number;
  jobs: DownloadJob[];
};

export type DownloadStreamEvent =
  | { type: "connected"; ts: number }
  | { type: "snapshot"; jobs: DownloadJob[]; ts: number }
  | { type: "progress"; jobs: DownloadJob[]; activeCount?: number; ts: number }
  | { type: "enqueued"; animeId: string; count: number; ts: number }
  | { type: "cancelled"; jobId: string; ts: number }
  | { type: "retried"; jobId: string; ts: number }
  | { type: "retry-batch"; requested: number; retried: number; ts: number }
  | { type: "batch-enqueued"; totalQueued: number; ts: number }
  | { type: "ping"; ts: number };

export async function fetchBackendHealth() {
  return requestJson<BackendHealth>("/health");
}

export async function fetchSearchProviders() {
  return requestJson<{ providers: BackendProvider[] }>("/api/search/providers");
}

export async function fetchLibrary() {
  return requestJson<{ total: number; totalStorageGb: number; animes: LibraryAnime[] }>("/api/library");
}

export async function fetchLibrarySummary() {
  return requestJson<LibrarySummary>("/api/library/stats/summary");
}

export async function fetchDownloadStats() {
  return requestJson<Record<string, number | string | unknown[]>>("/api/downloads/stats");
}

export async function fetchDownloads(status?: string) {
  const params = status ? `?${new URLSearchParams({ status }).toString()}` : "";
  return requestJson<DownloadsResponse>(`/api/downloads${params}`);
}

export async function cancelDownloadById(id: string) {
  const response = await fetch(`${getBackendUrl()}/api/downloads/${id}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Cancel download failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean }>;
}

export async function cancelAllDownloads() {
  const response = await fetch(`${getBackendUrl()}/api/downloads/all`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Cancel all downloads failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; cancelled: number }>;
}

export async function clearQueueMonitor() {
  const response = await fetch(`${getBackendUrl()}/api/downloads/monitor`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Clear queue monitor failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; removed: number; remaining: number }>;
}

export async function retryDownloadById(id: string) {
  const response = await fetch(`${getBackendUrl()}/api/downloads/${id}/retry`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Retry download failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean }>;
}

export async function retryFailedDownloads(limit = 25) {
  const response = await fetch(`${getBackendUrl()}/api/downloads/retry-failed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ limit }),
  });
  if (!response.ok) throw new Error(`Retry failed downloads failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; requested: number; retried: number }>;
}

export function openDownloadStream(
  onEvent: (payload: DownloadStreamEvent) => void,
  onStatus?: (state: "open" | "error") => void
) {
  const stream = new EventSource(`${getBackendUrl()}/api/downloads/stream`);

  const parseMessage = (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as DownloadStreamEvent;
      onEvent(payload);
    } catch {
      // ignore malformed event
    }
  };

  stream.addEventListener("downloads", (event) => {
    parseMessage(event as MessageEvent<string>);
  });
  stream.addEventListener("connected", (event) => {
    parseMessage(event as MessageEvent<string>);
    onStatus?.("open");
  });
  stream.addEventListener("snapshot", (event) => {
    parseMessage(event as MessageEvent<string>);
  });
  stream.addEventListener("ping", () => {
    onStatus?.("open");
  });

  stream.onerror = () => {
    onStatus?.("error");
  };

  return () => {
    stream.close();
  };
}

export async function queueMissingEpisodes(animeId: string) {
  const response = await fetch(`${getBackendUrl()}/api/queue/missing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ animeId }),
  });
  if (!response.ok) throw new Error(`Queue missing failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; queued: number }>;
}

export async function queueMissingForAll() {
  const response = await fetch(`${getBackendUrl()}/api/queue/missing-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(`Queue missing-all failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; totalQueued: number }>;
}

export async function scanAnimeById(id: string) {
  const response = await fetch(`${getBackendUrl()}/api/library/${id}/scan`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Scan failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; foundFiles?: number }>;
}

export async function deleteLibraryAnime(id: string) {
  const response = await fetch(`${getBackendUrl()}/api/library/${id}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Delete anime failed: ${response.status}`);
  return response.json() as Promise<{ ok?: boolean; error?: string }>;
}

export type ProviderSearchStat = { count: number; status: "ok" | "empty" | "skipped" };

export async function searchAnime(query: string, source = "all") {
  const params = new URLSearchParams({ q: query, source });
  return requestJson<{
    source: string;
    total?: number;
    results: SearchResult[];
    providerStats?: Record<string, ProviderSearchStat>;
  }>(`/api/search?${params.toString()}`);
}

export async function searchEpisodes(input: { url?: string; provider?: string; allAnimeId?: string }) {
  const params = new URLSearchParams();
  if (input.url) params.set("url", input.url);
  if (input.provider) params.set("provider", input.provider);
  if (input.allAnimeId) params.set("allAnimeId", input.allAnimeId);
  return requestJson<{ provider: string; total: number; episodes: { number: number; label: string; url: string }[] }>(
    `/api/search/episodes?${params.toString()}`
  );
}

export async function createLibraryAnime(payload: {
  title: string;
  provider: string;
  sourceUrl?: string;
  episodeCount?: number;
  localPath?: string;
  posterUrl?: string;
  synopsis?: string;
  year?: number | null;
  rating?: number | null;
  kitsuId?: string;
  seasonNumber?: number;
  tags?: string[];
}) {
  const response = await fetch(`${getBackendUrl()}/api/library`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      title: payload.title,
      provider: payload.provider,
      sourceUrl: payload.sourceUrl ?? null,
      episodeCount: payload.episodeCount ?? 0,
      localPath: payload.localPath ?? "",
      quality: "1080p",
      posterUrl: payload.posterUrl ?? null,
      synopsis: payload.synopsis ?? null,
      year: payload.year ?? null,
      rating: payload.rating ?? null,
      kitsuId: payload.kitsuId ?? null,
      seasonNumber: payload.seasonNumber ?? null,
      tags: payload.tags ?? [],
    }),
  });
  if (!response.ok) throw new Error(`Create library anime failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; id: string; reused?: boolean }>;
}

export async function fetchMetadataSearch(q: string, source = "kitsu") {
  const params = new URLSearchParams({ q, source });
  return requestJson<{ source: string; results: KitsuMetadata[] }>(`/api/metadata/search?${params.toString()}`);
}

export async function fetchConfig() {
  return requestJson<Record<string, string>>("/api/config");
}

export async function saveConfig(data: Record<string, string>) {
  const response = await fetch(`${getBackendUrl()}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Config save failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; updated: string[] }>;
}

export type ProviderHealthEntry = {
  state: "closed" | "open" | "half-open";
  failures: number;
  lastFailureAt: string;
  lastSuccessAt: string;
};

export async function fetchProviderHealth() {
  return requestJson<{ providers: Record<string, ProviderHealthEntry> }>("/api/providers/health");
}

export async function resetProviderCircuit(name: string) {
  const response = await fetch(`${getBackendUrl()}/api/providers/${name}/reset`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Reset circuit failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; message: string }>;
}

export type QbtConnectionStatus = {
  enabled: boolean;
  connected?: boolean;
  ok?: boolean;
  version?: string;
  error?: string;
};

export async function testQbtConnection() {
  return requestJson<QbtConnectionStatus>("/api/torrent/status");
}

export async function searchNyaa(params: { q: string; category?: string; group?: string; resolution?: string; limit?: number }) {
  const p = new URLSearchParams({ q: params.q });
  if (params.category) p.set("category", params.category);
  if (params.group) p.set("group", params.group);
  if (params.resolution) p.set("resolution", params.resolution);
  if (params.limit) p.set("limit", String(params.limit));
  return requestJson<{
    results: {
      id: string;
      title: string;
      magnetLink: string;
      torrentUrl: string;
      size: string;
      seeders: number;
      leechers: number;
      group: string;
      resolution: string;
      infoHash: string;
      releaseType: "raw" | "subbed" | "dubbed" | "unknown";
    }[];
    total: number;
    query: string;
  }>(`/api/nyaa/search?${p.toString()}`);
}

export async function addTorrent(payload: {
  magnetLink?: string;
  torrentUrl?: string;
  animeId?: string;
  episodeNumber?: number;
  season?: number;
  infoHash?: string;
}) {
  const response = await fetch(`${getBackendUrl()}/api/torrent/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Add torrent failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; jobId?: string; error?: string }>;
}

export async function enqueueEpisodes(payload: {
  animeId: string;
  episodes: number[];
  season?: number;
  sourceUrl?: string;
}) {
  const response = await fetch(`${getBackendUrl()}/api/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Enqueue episodes failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; queued: number }>;
}

// ── Jellyfin NFO ──────────────────────────────────────────────────────────────

export async function generateJellyfinNfo(animeId: string, downloadImages = true) {
  return requestJsonWithBodyError<{
    ok: boolean;
    tvshowNfo: string;
    posterDownloaded: boolean;
    fanartDownloaded: boolean;
    episodesNfo: number;
    errors: string[];
  }>(
    `${getBackendUrl()}/api/jellyfin/nfo/${animeId}?images=${downloadImages}`,
    { method: "POST", headers: { Accept: "application/json" } }
  );
}

export async function generateAllJellyfinNfo(downloadImages = false) {
  return requestJsonWithBodyError<{ ok: boolean; total: number; done: number; errors: number; episodesNfoTotal: number }>(
    `${getBackendUrl()}/api/jellyfin/nfo/all?images=${downloadImages}`,
    { method: "POST", headers: { Accept: "application/json" } }
  );
}

export async function enrichAnimeJikan(animeId: string) {
  return requestJsonWithBodyError<{ ok: boolean; enriched: number; total?: number; message?: string }>(`${getBackendUrl()}/api/metadata/jikan/enrich/${animeId}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
}

export async function enrichAnimeAnilist(animeId: string) {
  return requestJsonWithBodyError<{ ok: boolean; anilistId?: number; title?: string; error?: string }>(`${getBackendUrl()}/api/metadata/enrich/${animeId}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
}

// ── Episodes individuais ───────────────────────────────────────────────────────

export type AnimeEpisode = {
  id: string;
  number: number;
  season: number;
  title: string | null;
  synopsis: string | null;
  aired: string | null;
  durationMin: number | null;
  isFiller: number;
  isRecap: number;
  status: string;
  filePath: string | null;
  fileSizeMb: number;
  watched: number;
  watchProgress: number;
};

export async function fetchAnimeEpisodes(animeId: string, season?: number) {
  const params = season != null ? `?season=${season}` : "";
  return requestJson<{
    animeId: string;
    total: number;
    missingCount: number;
    missing: number[];
    episodes: AnimeEpisode[];
  }>(`/api/library/${animeId}/episodes${params}`);
}

export async function markEpisodeWatched(animeId: string, episodeNumber: number, watched: boolean) {
  const response = await fetch(`${getBackendUrl()}/api/library/${animeId}/episodes/${episodeNumber}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ watched: watched ? 1 : 0 }),
  });
  if (!response.ok) throw new Error(`Mark watched failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean }>;
}

// ── Histórico e dashboard ─────────────────────────────────────────────────────

export type DownloadHistoryMonth = { month: string; count: number; total_bytes: number };
export type DownloadHistoryProvider = { provider: string; completed: number; failed: number };

export async function fetchDownloadHistory() {
  return requestJson<{
    byMonth: DownloadHistoryMonth[];
    byProvider: DownloadHistoryProvider[];
    totals: { total: number; completed: number; failed: number; total_bytes: number };
  }>("/api/downloads/history");
}

// ── Auto-schedule ─────────────────────────────────────────────────────────────

export async function fetchAutoScheduleStatus() {
  return requestJson<{ active: boolean; intervalHours: number }>("/api/auto-schedule/status");
}

export async function triggerAutoSchedule() {
  const response = await fetch(`${getBackendUrl()}/api/auto-schedule/run`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "Auto-schedule indisponivel neste backend (rota /api/auto-schedule/run nao encontrada). Reinicie/atualize o backend."
      );
    }

    let details = "";
    try {
      details = (await response.text()).trim();
    } catch {
      // ignore body parse error
    }

    throw new Error(
      details
        ? `Auto-schedule run failed: ${response.status} - ${details}`
        : `Auto-schedule run failed: ${response.status}`
    );
  }
  return response.json() as Promise<{ ok: boolean; message: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos — novas features
// ─────────────────────────────────────────────────────────────────────────────

export type WatchStatus = "none" | "planned" | "watching" | "paused" | "completed" | "dropped";

export type DiagnosticsReport = {
  providers: {
    all: Record<string, { state: string; failures: number; lastFailureAt: string; lastSuccessAt: string }>;
    open: Array<{ name: string; state: string; failures: number }>;
  };
  recentFailures: Array<{
    anime_id: string; episode_number: number;
    error_msg: string | null; last_error_code: string | null;
  }>;
  qbittorrent: { enabled: boolean; connected: boolean; version: string | null };
  downloadPath: { path: string; accessible: boolean };
  runtime: {
    simulationEnabled: boolean;
    ytDlpPath: string;
    ytDlpAvailable: boolean;
    ffmpegPath: string;
    ffmpegAvailable: boolean;
    realDownloadsReady: boolean;
  };
  summary: { providersDown: number; recentFailures: number; hasIssues: boolean };
};

export type DashboardAnime = {
  id: string; title: string; poster_url: string | null;
  episode_count: number; downloaded_count: number;
  last_download?: string | null; missing_count?: number;
  download_status?: string;
};

export type DashboardData = {
  recentlyDownloaded: DashboardAnime[];
  inProgress: DashboardAnime[];
  missingEpisodes: DashboardAnime[];
  completed: DashboardAnime[];
};

export type CalendarEntry = {
  id: string;
  anilist_id: number | null;
  title: string;
  poster_url: string | null;
  next_release: string;
  season_number: number;
  downloaded_count: number;
  episode_count: number;
  anilist_status: string;
  watch_status: string;
  auto_download: number;
  queue_priority: number;
  is_library: boolean;
  is_tracked: boolean;
  episode_number: number | null;
  source: "library" | "discover";
  provider: string | null;
  source_url: string | null;
};

export type CollectionItem = {
  id: string; title: string; poster_url: string | null;
  downloaded_count?: number; episode_count?: number;
};

export type CollectionsData = {
  releasing: CollectionItem[];
  complete: CollectionItem[];
  withRecentFailures: CollectionItem[];
  unwatched: CollectionItem[];
  incompleteMetadata: Array<{ id: string; title: string }>;
  paused: CollectionItem[];
};

export type AnimeRule = {
  anime_id: string;
  preferred_provider?: string | null;
  preferred_quality?: string | null;
  preferred_download_type?: string | null;
  preferred_language?: string | null;
  auto_download?: number;
  queue_priority?: number;
};

export type AnimeRuleInput = {
  preferredProvider?: string | null;
  preferredQuality?: string | null;
  preferredDownloadType?: string | null;
  preferredLanguage?: string | null;
  autoDownload?: number;
  queuePriority?: number;
};

export type FranchiseEntry = {
  id: string; title: string; season_number: number;
  poster_url: string | null; episode_count: number;
  downloaded_count: number; download_status: string;
  anilist_status: string; year: number | null; watch_status: string;
};

export type FranchiseData = {
  seriesTitle: string;
  entries: FranchiseEntry[];
  totalSeasons: number;
};

export type IntegrityReport = {
  orphanedFiles: { count: number; items: Array<{ id: string; anime_id: string; number: number; file_path: string }> };
  duplicateEpisodes: { count: number; items: Array<{ anime_id: string; number: number; season: number; count: number }> };
  missingMetadata: {
    noPoster: { count: number; items: Array<{ id: string; title: string }> };
    noSynopsis: { count: number; items: Array<{ id: string; title: string }> };
  };
  summary: { totalIssues: number; hasIssues: boolean };
};

export type Recommendation = {
  anilistId: number;
  title: string | null;
  titleRomaji: string;
  relationType: string;
  format: string;
};

export type DiscoverRandomPick = {
  anilistId: number;
  malId: number | null;
  title: string;
  titleRomaji: string;
  titleEnglish: string | null;
  titleNative: string | null;
  synopsis: string | null;
  posterUrl: string | null;
  bannerUrl: string | null;
  rating: number | null;
  meanScore: number | null;
  status: string;
  episodeCount: number | null;
  episodeLength: number | null;
  format: string;
  season: string | null;
  year: number | null;
  startDate: { year: number | null; month: number | null; day: number | null };
  genres: string[];
  tags: string[];
  studios: string[];
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  popularity: number;
  trailer: { id: string; site: string } | null;
  isAdult: boolean;
  relations: Array<{ type: string; id: number; title: string; format: string }>;
};

export type DownloadHistoryInsights = {
  byMonth: Array<{ month: string; count: number; total_bytes: number }>;
  byProvider: Array<{ provider: string; completed: number; failed: number; success_rate: number }>;
  totals: { total: number; completed: number; failed: number; total_bytes: number };
  autoScheduleCount: number;
  volumeByMonth: Array<{ month: string; size_gb: number }>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Funções — novas features
// ─────────────────────────────────────────────────────────────────────────────

export const fetchDashboard = () =>
  requestJson<DashboardData>("/api/dashboard");

export const fetchCollections = () =>
  requestJson<CollectionsData>("/api/collections");

export const fetchCalendar = (range: "week" | "month" = "week") =>
  requestJson<{ range: string; priority: CalendarEntry[]; discover: CalendarEntry[]; recentlyDetected: unknown[] }>(
    `/api/calendar?range=${range}`
  );

export const fetchDiagnostics = () =>
  requestJson<DiagnosticsReport>("/api/diagnostics");

export const fetchDownloadHistoryInsights = () =>
  requestJson<DownloadHistoryInsights>("/api/downloads/history");

export const fetchAnimeRules = (animeId: string) =>
  requestJson<AnimeRule>(`/api/library/${animeId}/rules`);

export const saveAnimeRules = (animeId: string, rules: AnimeRuleInput) =>
  requestJsonWithBodyError<{ ok: boolean }>(`${getBackendUrl()}/api/library/${animeId}/rules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rules),
  });

export const deleteAnimeRules = (animeId: string) =>
  requestJsonWithBodyError<{ ok: boolean }>(`${getBackendUrl()}/api/library/${animeId}/rules`, {
    method: "DELETE",
  });

export const fetchFranchises = () =>
  requestJson<{ franchises: Array<{ series_title: string; season_count: number; total_eps: number; downloaded_count: number }> }>(
    "/api/franchise"
  );

export const fetchFranchise = (seriesTitle: string) =>
  requestJson<FranchiseData>(`/api/franchise/${encodeURIComponent(seriesTitle)}`);

export const fetchIntegrity = () =>
  requestJson<IntegrityReport>("/api/integrity");

export const fetchMissingSubtitles = () =>
  requestJson<{ missing: Array<{ anime_id: string; anime_title: string; episode_number: number; season: number; file_path: string }>; total: number }>(
    "/api/subtitles/missing"
  );

export const batchDownloadSubtitles = (animeId: string, language?: string) =>
  requestJsonWithBodyError<{ ok: boolean; total: number; downloaded: number; results: unknown[] }>(
    `${getBackendUrl()}/api/subtitles/batch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ animeId, language }),
    }
  );

export const fetchRecommendations = (basedOn: string) =>
  requestJson<{ basedOn: string; basedOnTitle: string; recommendations: Recommendation[] }>(
    `/api/discover?basedOn=${encodeURIComponent(basedOn)}`
  );

export const fetchRandomDiscover = (mode = "mixed", limit = 6) =>
  requestJson<{
    mode: string;
    genre: string;
    page: number;
    total: number;
    picks: DiscoverRandomPick[];
  }>(`/api/discover/random?mode=${encodeURIComponent(mode)}&limit=${limit}`);

export const updateWatchStatus = (animeId: string, watchStatus: WatchStatus) =>
  requestJsonWithBodyError<{ ok: boolean }>(`${getBackendUrl()}/api/library/${animeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watch_status: watchStatus }),
  });
