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

export async function searchAnime(query: string, source = "all") {
  const params = new URLSearchParams({ q: query, source });
  return requestJson<{ source: string; total?: number; results: SearchResult[] }>(`/api/search?${params.toString()}`);
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
      tags: payload.tags ?? [],
    }),
  });
  if (!response.ok) throw new Error(`Create library anime failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; id: string }>;
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
    results: { id: string; title: string; magnetLink: string; torrentUrl: string; size: string; seeders: number; leechers: number; group: string; resolution: string; infoHash: string }[];
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
  if (!response.ok) throw new Error(`Auto-schedule run failed: ${response.status}`);
  return response.json() as Promise<{ ok: boolean; message: string }>;
}
