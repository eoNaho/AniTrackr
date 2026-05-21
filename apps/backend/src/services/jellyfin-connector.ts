import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";

function cfg(key: string): string {
  return db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key)?.value ?? "";
}

function isEnabled(): boolean {
  return cfg("jellyfin_enabled") === "true";
}

function buildHeaders(): Record<string, string> {
  return {
    "X-Emby-Authorization": `MediaBrowser Token="${cfg("jellyfin_api_key")}"`,
    "Content-Type": "application/json",
  };
}

function baseUrl(): string {
  return cfg("jellyfin_base_url").replace(/\/+$/, "");
}

function timeout(): number {
  return parseInt(cfg("jellyfin_request_timeout_ms") || "10000", 10);
}

function persistCfg(key: string, value: string) {
  db.run(
    `INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export interface JellyfinTestResult {
  ok: boolean;
  connected: boolean;
  serverName?: string;
  version?: string;
  message: string;
}

export interface JellyfinLibrary {
  id: string;
  name: string;
  collectionType: string;
}

export interface JellyfinStatus {
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  libraryId: string;
  autoRefresh: boolean;
  lastTestAt: string | null;
  lastRefreshAt: string | null;
  pendingRefreshes: number;
  lastError: string | null;
}

export async function testConnection(): Promise<JellyfinTestResult> {
  if (!isEnabled()) {
    return { ok: false, connected: false, message: "Integração Jellyfin desabilitada" };
  }

  const url = baseUrl();
  if (!url) return { ok: false, connected: false, message: "URL do servidor não configurada" };
  if (!cfg("jellyfin_api_key")) return { ok: false, connected: false, message: "API Key não configurada" };

  try {
    const res = await fetch(`${url}/System/Info`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(timeout()),
    });

    if (res.status === 401) {
      return { ok: false, connected: false, message: "API Key inválida ou sem permissão" };
    }
    if (!res.ok) {
      return { ok: false, connected: false, message: `Servidor retornou HTTP ${res.status}` };
    }

    const data = await res.json() as { ServerName?: string; Version?: string };
    persistCfg("jellyfin_last_test_at", new Date().toISOString());
    persistCfg("jellyfin_last_error", "");
    logger.info("jellyfin_connector", `Conexão OK: ${data.ServerName} v${data.Version}`);

    return {
      ok: true,
      connected: true,
      serverName: data.ServerName,
      version: data.Version,
      message: "Conexão validada com sucesso",
    };
  } catch (err) {
    const msg = String(err).includes("timed out") || String(err).includes("timeout")
      ? "Timeout ao conectar com servidor"
      : `Erro de rede: ${String(err).split("\n")[0]}`;
    persistCfg("jellyfin_last_error", msg);
    logger.warn("jellyfin_connector", `Falha na conexão: ${err}`);
    return { ok: false, connected: false, message: msg };
  }
}

export async function getLibraries(): Promise<{ ok: boolean; libraries?: JellyfinLibrary[]; message?: string }> {
  if (!isEnabled()) return { ok: false, message: "Integração Jellyfin desabilitada" };
  const url = baseUrl();
  if (!url) return { ok: false, message: "URL do servidor não configurada" };

  try {
    const res = await fetch(`${url}/Library/VirtualFolders`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(timeout()),
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };

    const data = await res.json() as Array<{
      ItemId?: string; Id?: string; Name?: string; CollectionType?: string;
    }>;

    return {
      ok: true,
      libraries: data.map((lib) => ({
        id: lib.ItemId ?? lib.Id ?? "",
        name: lib.Name ?? "(sem nome)",
        collectionType: lib.CollectionType ?? "mixed",
      })),
    };
  } catch (err) {
    logger.warn("jellyfin_connector", `getLibraries failed: ${err}`);
    return { ok: false, message: String(err).split("\n")[0] };
  }
}

export async function refreshLibrary(libraryId?: string): Promise<{ ok: boolean; message: string }> {
  if (!isEnabled()) return { ok: false, message: "Integração Jellyfin desabilitada" };
  const url = baseUrl();
  if (!url) return { ok: false, message: "URL do servidor não configurada" };

  const targetId = libraryId ?? cfg("jellyfin_library_id");

  try {
    const endpoint = targetId
      ? `${url}/Items/${targetId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default`
      : `${url}/Library/Refresh`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(),
      signal: AbortSignal.timeout(timeout()),
    });

    if (!res.ok && res.status !== 204) {
      return { ok: false, message: `HTTP ${res.status}` };
    }

    persistCfg("jellyfin_last_refresh_at", new Date().toISOString());
    logger.info("jellyfin_connector", `Library refresh triggered (id=${targetId || "all"})`);
    return { ok: true, message: "Refresh da biblioteca disparado" };
  } catch (err) {
    logger.warn("jellyfin_connector", `refreshLibrary failed: ${err}`);
    return { ok: false, message: String(err).split("\n")[0] };
  }
}

export async function refreshSeries(seriesPath: string): Promise<{ ok: boolean; matched: boolean; message: string }> {
  if (!isEnabled()) return { ok: false, matched: false, message: "Integração Jellyfin desabilitada" };
  const url = baseUrl();
  if (!url) return { ok: false, matched: false, message: "URL do servidor não configurada" };

  try {
    const searchRes = await fetch(
      `${url}/Items?Path=${encodeURIComponent(seriesPath)}&Recursive=true&Fields=Path&Limit=1`,
      { headers: buildHeaders(), signal: AbortSignal.timeout(timeout()) }
    );

    if (searchRes.ok) {
      const data = await searchRes.json() as { Items?: Array<{ Id: string }> };
      const itemId = data.Items?.[0]?.Id;
      if (itemId) {
        const refreshRes = await fetch(
          `${url}/Items/${itemId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default`,
          { method: "POST", headers: buildHeaders(), signal: AbortSignal.timeout(timeout()) }
        );
        if (refreshRes.ok || refreshRes.status === 204) {
          persistCfg("jellyfin_last_refresh_at", new Date().toISOString());
          logger.info("jellyfin_connector", `Series refresh triggered (path=${seriesPath})`);
          return { ok: true, matched: true, message: "Refresh da série disparado" };
        }
      }
    }

    // Série não encontrada no Jellyfin — fallback para biblioteca completa
    logger.warn("jellyfin_connector", `Série não encontrada via path="${seriesPath}" — fallback para refresh completo da biblioteca`);
    const libResult = await refreshLibrary();
    return { ...libResult, matched: false };
  } catch (err) {
    logger.warn("jellyfin_connector", `refreshSeries failed: ${err}`);
    return { ok: false, matched: false, message: String(err).split("\n")[0] };
  }
}

export function getStatus(): JellyfinStatus {
  const url = cfg("jellyfin_base_url");
  const apiKey = cfg("jellyfin_api_key");

  const pendingRefreshes = db.query<{ count: number }, []>(
    `SELECT COUNT(*) as count FROM pending_jellyfin_refreshes WHERE status IN ('pending', 'processing')`
  ).get()?.count ?? 0;

  return {
    enabled: cfg("jellyfin_enabled") === "true",
    configured: !!(url && apiKey),
    baseUrl: url,
    libraryId: cfg("jellyfin_library_id"),
    autoRefresh: cfg("jellyfin_auto_refresh") === "true",
    lastTestAt: cfg("jellyfin_last_test_at") || null,
    lastRefreshAt: cfg("jellyfin_last_refresh_at") || null,
    pendingRefreshes,
    lastError: cfg("jellyfin_last_error") || null,
  };
}
