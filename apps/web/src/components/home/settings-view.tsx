"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchConfig,
  fetchProviderHealth,
  resetProviderCircuit,
  saveConfig,
  testQbtConnection,
  fetchDownloadHistory,
  fetchAutoScheduleStatus,
  triggerAutoSchedule,
  fetchQueueProfiles,
  activateQueueProfile,
  updateQueueProfile,
  createQueueProfile,
  deleteQueueProfile,
  fetchUpdateCheck,
  forceUpdateCheck,
  getBackupExportUrl,
  fetchBackupList,
  testWebhookNotification,
  restoreBackup,
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  fetchApiKeyAudit,
  type ApiKey,
  type CreatedApiKey,
  type ProviderHealthEntry,
  type QbtConnectionStatus,
  type DownloadHistoryMonth,
  type DownloadHistoryProvider,
  type QueueProfile,
  type UpdateCheckResult,
} from "@/lib/api";
import { Panel } from "./ui";

// ── Input Components ──────────────────────────────────────────────────────────

const inputCls =
  "w-full bg-[#0d0d12] border border-[#45475a] text-[#e0e0ed] px-2 py-[5px] text-[12px] outline-none focus:border-[#cba6f7] transition-colors font-mono";
const labelCls = "block text-[11px] text-[#6c7086] mb-1 uppercase tracking-wider";
const selectCls =
  "w-full bg-[#0d0d12] border border-[#45475a] text-[#e0e0ed] px-2 py-[5px] text-[12px] outline-none focus:border-[#cba6f7] transition-colors font-mono cursor-pointer";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`flex items-center gap-2 text-[12px] font-bold transition-colors ${value ? "text-[#a6e3a1]" : "text-[#6c7086]"}`}
    >
      <span className="text-[16px] leading-none">{value ? "●" : "○"}</span>
      {label}
    </button>
  );
}

function Btn({
  onClick,
  children,
  variant = "default",
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "primary" | "danger" | "success";
  disabled?: boolean;
}) {
  const cls = {
    default: "border-[#45475a] text-[#6c7086] hover:border-[#cba6f7] hover:text-[#cba6f7]",
    primary: "border-[#cba6f7] bg-[#cba6f7] text-[#0f0f14] hover:opacity-90",
    danger: "border-[#f38ba8] text-[#f38ba8] hover:bg-[#f38ba8] hover:text-[#0f0f14]",
    success: "border-[#a6e3a1] text-[#a6e3a1] hover:bg-[#a6e3a1] hover:text-[#0f0f14]",
  }[variant];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`border px-3 py-[5px] text-[11px] font-bold uppercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {children}
    </button>
  );
}

// ── Stats Dashboard ───────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function StatsPanel() {
  const [byMonth, setByMonth] = useState<DownloadHistoryMonth[]>([]);
  const [byProvider, setByProvider] = useState<DownloadHistoryProvider[]>([]);
  const [totals, setTotals] = useState<{ total: number; completed: number; failed: number; total_bytes: number } | null>(null);
  const [autoSched, setAutoSched] = useState<{ active: boolean; intervalHours: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hist, sched] = await Promise.allSettled([fetchDownloadHistory(), fetchAutoScheduleStatus()]);
      if (hist.status === "fulfilled") {
        setByMonth(hist.value.byMonth);
        setByProvider(hist.value.byProvider);
        setTotals(hist.value.totals);
      }
      if (sched.status === "fulfilled") setAutoSched(sched.value);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function handleRunNow() {
    setRunning(true);
    setRunError(null);
    try {
      await triggerAutoSchedule();
      await load();
    } catch (e) {
      setRunError((e as Error).message);
    }
    finally { setRunning(false); }
  }

  const maxMonthCount = Math.max(1, ...byMonth.map((m) => m.count));

  return (
    <Panel title="[ESTATÍSTICAS]" className="xl:col-span-2">
      <div className="p-3 text-[12px]">
        {/* Totais */}
        {totals && (
          <div className="mb-4 grid grid-cols-4 gap-2">
            {[
              { label: "total", value: totals.total, color: "text-[#e0e0ed]" },
              { label: "concluídos", value: totals.completed, color: "text-[#a6e3a1]" },
              { label: "falharam", value: totals.failed, color: "text-[#f38ba8]" },
              { label: "baixado", value: fmtBytes(totals.total_bytes), color: "text-[#89dceb]" },
            ].map(({ label, value, color }) => (
              <div key={label} className="border border-[#2a2a38] bg-[#0d0d12] p-2 text-center">
                <div className="text-[11px] text-[#6c7086] uppercase">{label}</div>
                <div className={`mt-1 text-[15px] font-extrabold ${color}`}>{value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {/* Gráfico por mês */}
          <div>
            <div className="mb-2 text-[11px] font-bold text-[#89dceb] uppercase">downloads / mês</div>
            {loading ? (
              <div className="text-[#6c7086]">carregando...</div>
            ) : byMonth.length === 0 ? (
              <div className="text-[#6c7086]">sem dados ainda</div>
            ) : (
              <div className="space-y-1">
                {byMonth.slice(0, 8).map((m) => {
                  const pct = Math.round((m.count / maxMonthCount) * 100);
                  return (
                    <div key={m.month} className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-[#6c7086]">{m.month}</span>
                      <div className="flex-1 h-4 bg-[#1a1a2e] border border-[#2a2a38]">
                        <div
                          className="h-full bg-[#cba6f7]/60 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-[#e0e0ed]">{m.count}</span>
                      <span className="w-16 shrink-0 text-right text-[#6c7086]">{fmtBytes(m.total_bytes)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Por provider */}
          <div>
            <div className="mb-2 text-[11px] font-bold text-[#89dceb] uppercase">por provider</div>
            {byProvider.length === 0 ? (
              <div className="text-[#6c7086]">sem dados ainda</div>
            ) : (
              <div className="space-y-1">
                {byProvider.map((p) => {
                  const total = p.completed + p.failed;
                  const rate = total > 0 ? Math.round((p.completed / total) * 100) : 0;
                  return (
                    <div key={p.provider} className="flex items-center justify-between border border-[#2a2a38] bg-[#0d0d12] px-2 py-1">
                      <span className="text-[#e0e0ed] uppercase">[{p.provider}]</span>
                      <div className="flex gap-3 text-[11px]">
                        <span className="text-[#a6e3a1]">{p.completed} ok</span>
                        <span className="text-[#f38ba8]">{p.failed} fail</span>
                        <span className={rate >= 80 ? "text-[#a6e3a1]" : rate >= 50 ? "text-[#f9e2af]" : "text-[#f38ba8]"}>
                          {rate}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Auto-schedule */}
        <div className="mt-4 border-t border-[#45475a] pt-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-bold text-[#cba6f7] uppercase">[AUTO-SCHEDULE]</span>
              {autoSched && (
                <span className="ml-2 text-[11px] text-[#6c7086]">
                  — verifica séries em lançamento a cada {autoSched.intervalHours}h
                  <span className={`ml-2 font-bold ${autoSched.active ? "text-[#a6e3a1]" : "text-[#f38ba8]"}`}>
                    {autoSched.active ? "● ativo" : "✕ inativo"}
                  </span>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Btn onClick={load} disabled={loading}>{loading ? "..." : "↻"}</Btn>
              <Btn onClick={handleRunNow} disabled={running} variant="success">
                {running ? "verificando..." : "verificar agora"}
              </Btn>
            </div>
          </div>
          {runError && (
            <div className="mt-2 text-[11px] text-[#f38ba8]">
              {runError}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ── Provider Health ───────────────────────────────────────────────────────────

function ProviderHealthPanel() {
  const [health, setHealth] = useState<Record<string, ProviderHealthEntry>>({});
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProviderHealth();
      setHealth(data.providers);
    } catch {
      setHealth({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const KNOWN_PROVIDERS = ["animefire", "goyabu", "allanime", "nineanime", "animedrive", "superflix", "dattebayo"];

  async function handleReset(name: string) {
    setResetting(name);
    try {
      await resetProviderCircuit(name);
      await load();
    } finally {
      setResetting(null);
    }
  }

  const stateColor = (state: string) => {
    if (state === "closed") return "text-[#a6e3a1]";
    if (state === "open") return "text-[#f38ba8]";
    return "text-[#f9e2af]";
  };

  const stateIcon = (state: string) => {
    if (state === "closed") return "●";
    if (state === "open") return "✕";
    return "◐";
  };

  return (
    <Panel title="[PROVIDERS / HEALTH]" className="h-full">
      <div className="p-3 text-[12px]">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[#6c7086]">circuit breaker status</span>
          <Btn onClick={load} disabled={loading}>{loading ? "..." : "↻ refresh"}</Btn>
        </div>
        <div className="space-y-2">
          {KNOWN_PROVIDERS.map((name) => {
            const h = health[name];
            if (!h) {
              return (
                <div key={name} className="flex items-center justify-between border border-[#2a2a38] bg-[#0d0d12] px-2 py-[6px]">
                  <span className="text-[#6c7086] uppercase">[{name}]</span>
                  <span className="text-[#a6e3a1] text-[11px]">● closed</span>
                </div>
              );
            }
            return (
              <div key={name} className="border border-[#2a2a38] bg-[#0d0d12] px-2 py-[6px]">
                <div className="flex items-center justify-between">
                  <span className="text-[#e0e0ed] uppercase font-bold">[{name}]</span>
                  <div className="flex items-center gap-2">
                    <span className={`font-bold uppercase ${stateColor(h.state)}`}>
                      {stateIcon(h.state)} {h.state}
                    </span>
                    {h.state !== "closed" && (
                      <Btn
                        onClick={() => handleReset(name)}
                        disabled={resetting === name}
                        variant="danger"
                      >
                        {resetting === name ? "..." : "reset"}
                      </Btn>
                    )}
                  </div>
                </div>
                {h.failures > 0 && (
                  <div className="mt-1 text-[11px] text-[#6c7086]">
                    falhas: <span className="text-[#f38ba8]">{h.failures}</span>
                    {h.lastFailureAt && ` · última: ${new Date(h.lastFailureAt).toLocaleTimeString("pt-BR", { hour12: false })}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface SettingsViewProps {
  onSaved?: () => void;
}

type ConfigState = Record<string, string>;

const DEFAULTS: ConfigState = {
  download_path: "",
  quality: "1080p",
  provider: "animefire",
  max_concurrent: "3",
  naming_scheme: "jellyfin",
  prefer_sub: "true",
  allow_simulated_downloads: "false",
  yt_dlp_path: "yt-dlp",
  ffmpeg_path: "ffmpeg",
  auto_retry_enabled: "true",
  retry_max_attempts: "3",
  retry_base_delay_seconds: "20",
  retry_max_delay_seconds: "900",
  qbittorrent_enabled: "false",
  qbittorrent_host: "http://localhost:8080",
  qbittorrent_username: "admin",
  qbittorrent_password: "adminadmin",
  qbittorrent_save_path: "",
  nyaa_preferred_group: "SubsPlease",
  nyaa_preferred_resolution: "1080p",
  nyaa_default_category: "1_2",
  // OpenSubtitles
  opensubtitles_api_key: "",
  opensubtitles_username: "",
  opensubtitles_password: "",
  // Auto-legenda
  auto_subtitle_enabled: "false",
  // Webhook
  webhook_enabled: "false",
  webhook_url: "",
  webhook_type: "discord",
  // Disco
  disk_alert_threshold_gb: "2",
};

// ── API Keys ──────────────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<string, string> = {
  "search:read":   "Buscar animes",
  "library:read":  "Ler biblioteca",
  "downloads:read":"Ver downloads",
  "queue:write":   "Enfileirar downloads",
  "config:read":   "Ler configurações",
  "admin":         "Acesso total",
};

function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["search:read", "library:read", "downloads:read"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [auditKeyId, setAuditKeyId] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<{ route: string; status_code: number; duration_ms: number; created_at: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApiKeys();
      setKeys(res.keys);
      setAvailableScopes(res.availableScopes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggleScope(scope: string) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  async function handleCreate() {
    if (!label.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const key = await createApiKey(label.trim(), selectedScopes, expiresAt || undefined);
      setNewKey(key);
      setLabel("");
      setExpiresAt("");
      setSelectedScopes(["search:read", "library:read", "downloads:read"]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    await revokeApiKey(id).catch(() => {});
    await load();
  }

  async function handleAudit(id: string) {
    if (auditKeyId === id) { setAuditKeyId(null); return; }
    setAuditKeyId(id);
    const res = await fetchApiKeyAudit(id).catch(() => ({ logs: [] }));
    setAuditLogs(res.logs);
  }

  function handleCopy() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey.key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  const statusColor = (s: string) =>
    s === "active" ? "text-[#a6e3a1]" : s === "expired" ? "text-[#f9e2af]" : "text-[#f38ba8]";

  return (
    <Panel title="[API KEYS]" className="md:col-span-2 xl:col-span-3">
      <div className="p-3 space-y-4">
        {/* Chave recém-criada */}
        {newKey && (
          <div className="border border-[#a6e3a1]/40 bg-[#a6e3a1]/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-[#a6e3a1]">✓ Chave criada — guarde agora, não será exibida novamente</span>
              <button onClick={() => setNewKey(null)} className="text-[#6c7086] hover:text-[#e0e0ed] text-[14px]">✕</button>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all bg-black/30 px-2 py-1.5 text-[11px] font-mono text-[#cba6f7] select-all">
                {newKey.key}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 border border-[#45475a] px-3 py-1.5 text-[11px] text-[#bac2de] hover:border-[#cba6f7] hover:text-[#cba6f7]"
              >
                {copied ? "✓ copiado" : "copiar"}
              </button>
            </div>
            <p className="text-[11px] text-[#6c7086]">
              Use: <code className="text-[#89dceb]">Authorization: Bearer {newKey.key.slice(0, 18)}...</code>
            </p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {/* Formulário de criação */}
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#cba6f7]">Nova chave</div>
            <div>
              <label className={labelCls}>nome da chave</label>
              <input
                className={inputCls}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="bot-discord, script-backup, ..."
                maxLength={80}
              />
            </div>
            <div>
              <label className={labelCls}>escopos</label>
              <div className="space-y-1">
                {availableScopes.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 cursor-pointer text-[12px]">
                    <input
                      type="checkbox"
                      checked={selectedScopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      className="accent-[#cba6f7]"
                    />
                    <span className="font-mono text-[#89dceb]">{scope}</span>
                    <span className="text-[#6c7086]">— {SCOPE_LABELS[scope] ?? scope}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>expiração (opcional)</label>
              <input
                type="date"
                className={inputCls}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            {error && <p className="text-[11px] text-[#f38ba8]">{error}</p>}
            <button
              onClick={() => void handleCreate()}
              disabled={creating || !label.trim() || !selectedScopes.length}
              className="border border-[#cba6f7] bg-[#cba6f7] px-4 py-1.5 text-[12px] font-bold text-[#0f0f14] hover:opacity-90 disabled:opacity-40"
            >
              {creating ? "gerando..." : "gerar API key"}
            </button>
          </div>

          {/* Lista de chaves */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#cba6f7] mb-2">
              Chaves existentes {loading && <span className="text-[#6c7086]">(carregando...)</span>}
            </div>
            {keys.length === 0 && !loading && (
              <p className="text-[12px] text-[#6c7086]">Nenhuma chave criada ainda.</p>
            )}
            <div className="space-y-2">
              {keys.map((key) => (
                <div key={key.id} className="border border-[#2a2a38] bg-[#0d0d12] p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-[#e0e0ed] truncate">{key.label}</span>
                        <span className={`text-[10px] font-bold uppercase ${statusColor(key.status)}`}>{key.status}</span>
                      </div>
                      <div className="text-[11px] font-mono text-[#6c7086]">{key.prefix}···</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {key.scopes.map((s) => (
                          <span key={s} className="border border-[#45475a] px-1 text-[10px] text-[#89dceb]">{s}</span>
                        ))}
                      </div>
                      <div className="mt-1 text-[10px] text-[#6c7086]">
                        criada {new Date(key.createdAt).toLocaleDateString("pt-BR")}
                        {key.lastUsedAt && ` · uso ${new Date(key.lastUsedAt).toLocaleDateString("pt-BR")}`}
                        {key.expiresAt && ` · expira ${new Date(key.expiresAt).toLocaleDateString("pt-BR")}`}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => void handleAudit(key.id)}
                        className="border border-[#45475a] px-2 py-0.5 text-[10px] text-[#6c7086] hover:border-[#89dceb] hover:text-[#89dceb]"
                      >
                        log
                      </button>
                      {key.status === "active" && (
                        <button
                          onClick={() => void handleRevoke(key.id)}
                          className="border border-[#45475a] px-2 py-0.5 text-[10px] text-[#6c7086] hover:border-[#f38ba8] hover:text-[#f38ba8]"
                        >
                          revogar
                        </button>
                      )}
                    </div>
                  </div>
                  {auditKeyId === key.id && (
                    <div className="mt-2 border-t border-[#2a2a38] pt-2 space-y-0.5 max-h-32 overflow-y-auto">
                      {auditLogs.length === 0 ? (
                        <p className="text-[10px] text-[#6c7086]">Sem registros ainda.</p>
                      ) : auditLogs.map((log, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <span className={log.status_code >= 400 ? "text-[#f38ba8]" : "text-[#a6e3a1]"}>{log.status_code}</span>
                          <span className="font-mono text-[#6c7086]">{log.route}</span>
                          <span className="ml-auto text-[#45475a]">{log.duration_ms}ms</span>
                          <span className="text-[#45475a]">{new Date(log.created_at).toLocaleTimeString("pt-BR")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-[#45475a] pt-2 text-[11px] text-[#6c7086]">
          Use <code className="text-[#89dceb]">Authorization: Bearer &lt;key&gt;</code> em bots, scripts e integrações externas.
          Docs: <code className="text-[#6c7086]">docs/api-publica.md</code>
        </div>
      </div>
    </Panel>
  );
}

// ── Webhook Notifications ─────────────────────────────────────────────────────

function WebhookPanel({ cfg, set, setBool, className }: { cfg: ConfigState; set: (k: string, v: string) => void; setBool: (k: string, v: boolean) => void; className?: string }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function handleTest() {
    if (!cfg.webhook_url) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testWebhookNotification(cfg.webhook_url, cfg.webhook_type || "discord");
      setTestResult(res.ok ? "✓ webhook enviado com sucesso" : `✗ ${res.error ?? "falhou"}`);
    } catch (e) {
      setTestResult(`✗ ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Panel title="[NOTIFICAÇÕES WEBHOOK]" className={className}>
      <div className="p-3">
        <div className="mb-3">
          <Toggle value={cfg.webhook_enabled === "true"} onChange={(v) => setBool("webhook_enabled", v)} label="ativar notificações webhook" />
        </div>
        <Field label="URL do webhook">
          <input
            className={inputCls}
            value={cfg.webhook_url}
            onChange={(e) => set("webhook_url", e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            disabled={cfg.webhook_enabled !== "true"}
          />
        </Field>
        <Field label="tipo">
          <select className={selectCls} value={cfg.webhook_type} onChange={(e) => set("webhook_type", e.target.value)} disabled={cfg.webhook_enabled !== "true"}>
            <option value="discord">Discord</option>
            <option value="gotify">Gotify</option>
            <option value="generic">HTTP genérico</option>
          </select>
        </Field>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleTest()}
            disabled={testing || !cfg.webhook_url}
            className="border border-[#45475a] px-3 py-1 text-[12px] text-[#bac2de] hover:border-[#cba6f7] hover:text-[#cba6f7] disabled:opacity-40"
          >
            {testing ? "enviando..." : "testar agora"}
          </button>
          {testResult && (
            <span className={`text-[12px] ${testResult.startsWith("✓") ? "text-[#a6e3a1]" : "text-[#f38ba8]"}`}>{testResult}</span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-[#6c7086]">
          Notifica ao completar ou falhar permanentemente um download. Suporta Discord (embed), Gotify e qualquer endpoint HTTP POST.
        </p>
      </div>
    </Panel>
  );
}

// ── Backup / Restore ──────────────────────────────────────────────────────────

function BackupPanel() {
  const [backups, setBackups] = useState<{ name: string; sizeKb: number; mtime: string }[]>([]);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchBackupList().then((r) => setBackups(r.backups)).catch(() => {});
  }, []);

  async function handleRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    setRestoreStatus(null);
    try {
      const res = await restoreBackup(file);
      setRestoreStatus(`✓ restaurado: ${res.restored.animes} animes, ${res.restored.episodes} episódios`);
    } catch (err) {
      setRestoreStatus(`✗ ${(err as Error).message}`);
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Panel title="[BACKUP / RESTORE]">
      <div className="p-3 space-y-3">
        <div>
          <p className="text-[12px] text-[#bac2de] mb-2">
            Export JSON inclui biblioteca, episódios, regras e configuração. Backup SQLite automático ocorre semanalmente.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={getBackupExportUrl()}
              download
              className="border border-[#45475a] px-3 py-1 text-[12px] text-[#bac2de] hover:border-[#cba6f7] hover:text-[#cba6f7]"
            >
              exportar JSON
            </a>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={restoring}
              className="border border-[#45475a] px-3 py-1 text-[12px] text-[#bac2de] hover:border-[#f38ba8] hover:text-[#f38ba8] disabled:opacity-40"
            >
              {restoring ? "restaurando..." : "restaurar JSON"}
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={(e) => void handleRestore(e)} />
          </div>
          {restoreStatus && (
            <p className={`mt-2 text-[12px] ${restoreStatus.startsWith("✓") ? "text-[#a6e3a1]" : "text-[#f38ba8]"}`}>{restoreStatus}</p>
          )}
        </div>
        {backups.length > 0 && (
          <div>
            <p className="text-[11px] text-[#6c7086] uppercase tracking-wider mb-1">Backups SQLite automáticos</p>
            <div className="space-y-0.5">
              {backups.map((b) => (
                <div key={b.name} className="flex justify-between text-[11px] text-[#6c7086]">
                  <span className="font-mono">{b.name}</span>
                  <span>{b.sizeKb} KB · {new Date(b.mtime).toLocaleDateString("pt-BR")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── Queue Profiles ────────────────────────────────────────────────────────────

const PROFILE_TYPES = [
  { id: "ytdlp", label: "yt-dlp (direto)" },
  { id: "torrent", label: "Torrent (qBt)" },
];

function QueueProfilesPanel() {
  const [profiles, setProfiles] = useState<QueueProfile[]>([]);
  const [editing, setEditing] = useState<QueueProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setProfiles(await fetchQueueProfiles()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  async function handleActivate(id: string) {
    setBusy(true);
    try { await activateQueueProfile(id); await load(); setStatus(`Perfil ativado: ${id}`); }
    catch (e) { setStatus(`Erro: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      await updateQueueProfile(editing.id, {
        label: editing.label, max_concurrent: editing.max_concurrent,
        speed_limit_kbps: editing.speed_limit_kbps, window_start: editing.window_start,
        window_end: editing.window_end, preferred_type: editing.preferred_type,
        retry_max: editing.retry_max, retry_base_delay_s: editing.retry_base_delay_s,
      });
      await load();
      setEditing(null);
      setStatus("Perfil atualizado.");
    } catch (e) { setStatus(`Erro: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function handleCreate() {
    if (!newLabel.trim()) return;
    setBusy(true);
    try {
      await createQueueProfile({ label: newLabel.trim(), max_concurrent: 3, speed_limit_kbps: 0, window_start: null, window_end: null, preferred_type: "ytdlp", retry_max: 3, retry_base_delay_s: 20 });
      await load();
      setNewLabel("");
      setShowNew(false);
      setStatus("Perfil criado.");
    } catch (e) { setStatus(`Erro: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try { await deleteQueueProfile(id); await load(); setStatus("Perfil removido."); }
    catch (e) { setStatus(`Erro: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const upd = (patch: Partial<QueueProfile>) => setEditing((e) => e ? { ...e, ...patch } : e);

  return (
    <Panel title="[QUEUE PROFILES]" className="md:col-span-2">
      <div className="p-3 text-[12px]">
        {loading ? (
          <div className="text-[#6c7086]">carregando perfis...</div>
        ) : (
          <div className="flex flex-col gap-2">
            {profiles.map((p) => (
              <div key={p.id} className={`border p-3 ${p.is_active ? "border-[#cba6f7] bg-[#cba6f7]/5" : "border-[#45475a] bg-black/10"}`}>
                {editing?.id === p.id ? (
                  /* Edit form */
                  <div className="flex flex-col gap-2">
                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                      <PF label="Nome"><input className={pInputCls} value={editing.label} onChange={(e) => upd({ label: e.target.value })} /></PF>
                      <PF label="Concorrência"><input type="number" min={1} max={20} className={pInputCls} value={editing.max_concurrent} onChange={(e) => upd({ max_concurrent: parseInt(e.target.value) || 1 })} /></PF>
                      <PF label="Tipo preferido">
                        <select className={pInputCls} value={editing.preferred_type} onChange={(e) => upd({ preferred_type: e.target.value })}>
                          {PROFILE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </PF>
                      <PF label="Janela início (HH:MM)"><input type="time" className={pInputCls} value={editing.window_start ?? ""} onChange={(e) => upd({ window_start: e.target.value || null })} /></PF>
                      <PF label="Janela fim (HH:MM)"><input type="time" className={pInputCls} value={editing.window_end ?? ""} onChange={(e) => upd({ window_end: e.target.value || null })} /></PF>
                      <PF label="Retry máx"><input type="number" min={0} max={20} className={pInputCls} value={editing.retry_max} onChange={(e) => upd({ retry_max: parseInt(e.target.value) || 0 })} /></PF>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Btn onClick={() => void handleSaveEdit()} disabled={busy} variant="primary">salvar</Btn>
                      <Btn onClick={() => setEditing(null)} disabled={busy}>cancelar</Btn>
                    </div>
                  </div>
                ) : (
                  /* Display row */
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3">
                      {p.is_active && <span className="text-[10px] font-bold text-[#cba6f7] uppercase">● ativo</span>}
                      <span className={`font-bold ${p.is_active ? "text-[#cba6f7]" : "text-[#e0e0ed]"}`}>{p.label}</span>
                      <span className="text-[#6c7086]">concorrência={p.max_concurrent}</span>
                      {p.window_start && <span className="text-[#f9e2af]">{p.window_start}–{p.window_end}</span>}
                      <span className="text-[#45475a]">{p.preferred_type}</span>
                    </div>
                    <div className="flex gap-1">
                      {!p.is_active && <Btn onClick={() => void handleActivate(p.id)} disabled={busy} variant="success">ativar</Btn>}
                      <Btn onClick={() => setEditing({ ...p })} disabled={busy}>editar</Btn>
                      {!["home", "server", "night"].includes(p.id) && !p.is_active && (
                        <Btn onClick={() => void handleDelete(p.id)} disabled={busy} variant="danger">✕</Btn>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Novo perfil */}
            {showNew ? (
              <div className="flex gap-2 items-center border border-[#45475a] p-2">
                <input className={`${pInputCls} flex-1`} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Nome do perfil" onKeyDown={(e) => e.key === "Enter" && void handleCreate()} autoFocus />
                <Btn onClick={() => void handleCreate()} disabled={busy || !newLabel.trim()} variant="primary">criar</Btn>
                <Btn onClick={() => { setShowNew(false); setNewLabel(""); }} disabled={busy}>cancelar</Btn>
              </div>
            ) : (
              <Btn onClick={() => setShowNew(true)} disabled={busy}>+ novo perfil</Btn>
            )}

            {status && (
              <div className={`text-[11px] ${status.startsWith("Erro") ? "text-[#f38ba8]" : "text-[#a6e3a1]"}`}>{status}</div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

const pInputCls = "w-full border border-[#45475a] bg-[#0d0d12] px-2 py-1 text-[12px] text-[#e0e0ed] outline-none focus:border-[#cba6f7] font-mono";
function PF({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-[10px] uppercase text-[#6c7086] tracking-wider">{label}</span>{children}</div>;
}

// ── Update Panel ──────────────────────────────────────────────────────────────

function UpdatePanel() {
  const [info, setInfo] = useState<UpdateCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCmd, setShowCmd] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const res = force ? await forceUpdateCheck() : await fetchUpdateCheck();
      setInfo(res);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const updateCmd = info?.isDocker
    ? "docker compose pull && docker compose up -d"
    : "git pull && bun install && bun run build";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(updateCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback: show text */ }
  }

  const fmtDate = (iso: string | null) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }); }
    catch { return iso.slice(0, 10); }
  };

  return (
    <Panel title="[ATUALIZAÇÃO]">
      <div className="p-3 text-[12px] flex flex-col gap-3">
        {/* Versão atual */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-[#6c7086] uppercase tracking-wider mb-1">Versão atual</div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#cba6f7]">{info?.current ?? "—"}</span>
              {info?.isDocker && (
                <span className="border border-[#45475a] px-1.5 py-0.5 text-[10px] text-[#89dceb] uppercase">Docker</span>
              )}
            </div>
          </div>
          <Btn onClick={() => void load(true)} disabled={loading}>{loading ? "..." : "↻ verificar"}</Btn>
        </div>

        {/* Status de atualização */}
        {info && !info.error && (
          info.latest ? (
            <div className={`border p-3 flex flex-col gap-2 ${info.hasUpdate ? "border-[#a6e3a1] bg-[#a6e3a1]/5" : "border-[#45475a] bg-black/10"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-[#6c7086] uppercase tracking-wider">Última versão</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`font-bold text-base ${info.hasUpdate ? "text-[#a6e3a1]" : "text-[#bac2de]"}`}>
                      {info.latest}
                    </span>
                    {info.hasUpdate
                      ? <span className="text-[10px] font-bold text-[#a6e3a1] uppercase">● atualização disponível</span>
                      : <span className="text-[10px] text-[#6c7086]">✓ em dia</span>
                    }
                  </div>
                  {info.publishedAt && (
                    <div className="text-[10px] text-[#45475a] mt-0.5">publicada em {fmtDate(info.publishedAt)}</div>
                  )}
                </div>
                {info.releaseUrl && (
                  <a href={info.releaseUrl} target="_blank" rel="noopener noreferrer"
                    className="border border-[#45475a] px-2 py-1 text-[10px] text-[#6c7086] hover:border-[#cba6f7] hover:text-[#cba6f7]">
                    ver release ↗
                  </a>
                )}
              </div>

              {info.body && (
                <div className="border border-[#2a2a38] bg-black/20 px-2 py-2 text-[11px] text-[#6c7086] leading-relaxed whitespace-pre-wrap">
                  {info.body}{info.body.length >= 600 ? "…" : ""}
                </div>
              )}

              {info.hasUpdate && (
                <div>
                  <Btn onClick={() => setShowCmd((v) => !v)} variant="success">
                    {showCmd ? "ocultar comando" : "▶ como atualizar"}
                  </Btn>

                  {showCmd && (
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="text-[11px] text-[#6c7086]">
                        {info.isDocker
                          ? "Execute no host onde o Docker está rodando:"
                          : "Execute no diretório do projeto:"}
                      </div>
                      <div className="flex items-center gap-2 border border-[#45475a] bg-black/30 px-3 py-2">
                        <code className="flex-1 font-mono text-[12px] text-[#a6e3a1] break-all">{updateCmd}</code>
                        <button
                          onClick={() => void handleCopy()}
                          className="shrink-0 border border-[#45475a] px-2 py-1 text-[10px] text-[#6c7086] hover:border-[#cba6f7] hover:text-[#cba6f7]"
                        >
                          {copied ? "✓ copiado" : "copiar"}
                        </button>
                      </div>
                      {info.isDocker && (
                        <div className="text-[10px] text-[#45475a]">
                          O serviço será reiniciado automaticamente após o pull. O banco de dados e configurações são preservados via volume.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[#6c7086]">
              Sem releases publicadas ainda.{" "}
              <a href={`https://github.com/${info.releaseUrl ? new URL(info.releaseUrl).pathname.split("/releases")[0].slice(1) : "eonaho/goanime-trackear"}`}
                target="_blank" rel="noopener noreferrer" className="text-[#cba6f7] hover:underline">
                ver repositório ↗
              </a>
            </div>
          )
        )}

        {info?.error && (
          <div className="text-[11px] text-[#f9e2af]">
            Não foi possível verificar atualizações. Verifique a conexão com GitHub.
          </div>
        )}

        {info?.checkedAt && (
          <div className="text-[10px] text-[#45475a]">
            última verificação: {new Date(info.checkedAt).toLocaleTimeString("pt-BR")}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function SettingsView({ onSaved }: SettingsViewProps) {
  const [cfg, setCfg] = useState<ConfigState>({ ...DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qbtStatus, setQbtStatus] = useState<QbtConnectionStatus | null>(null);
  const [qbtTesting, setQbtTesting] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setLoadError(null);
      fetchConfig()
        .then((data) => setCfg({ ...DEFAULTS, ...data }))
        .catch((e) => setLoadError((e as Error).message))
        .finally(() => setLoading(false));
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  function set(key: string, value: string) {
    setCfg((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function setBool(key: string, value: boolean) {
    set(key, value ? "true" : "false");
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveConfig(cfg);
      setSaved(true);
      onSaved?.();
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestQbt() {
    setQbtTesting(true);
    setQbtStatus(null);
    // Salva host/user/pass antes de testar
    try {
      await saveConfig({
        qbittorrent_enabled: cfg.qbittorrent_enabled,
        qbittorrent_host: cfg.qbittorrent_host,
        qbittorrent_username: cfg.qbittorrent_username,
        qbittorrent_password: cfg.qbittorrent_password,
      });
      const status = await testQbtConnection();
      setQbtStatus(status);
    } catch (e) {
      setQbtStatus({ enabled: false, error: (e as Error).message });
    } finally {
      setQbtTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[#6c7086] text-[13px]">
        carregando configurações...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px]">
        <span className="text-[#f38ba8]">✕ Falha ao carregar configurações</span>
        <span className="text-[11px] text-[#6c7086]">{loadError}</span>
      </div>
    );
  }

  const isQbtEnabled = cfg.qbittorrent_enabled === "true";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="mb-3 flex shrink-0 items-center justify-between text-[12px]">
        <span className="font-bold text-[#cba6f7] tracking-wider">
          [SETTINGS] — configurações do sistema
        </span>
        <div className="flex items-center gap-2">
          {error && <span className="text-[#f38ba8] text-[11px]">✕ {error}</span>}
          {saved && <span className="text-[#a6e3a1] text-[11px]">✓ salvo</span>}
          <Btn onClick={handleSave} disabled={saving} variant="primary">
            {saving ? "salvando..." : "salvar tudo"}
          </Btn>
        </div>
      </div>

      {/* Grid de Seções */}
      <div className="flex min-h-0 flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "#45475a #0d0d12" }}>
        <div className="grid w-full grid-cols-1 gap-3 auto-rows-min grid-flow-row-dense md:grid-cols-2 xl:grid-cols-3">

          {/* API Keys */}
          <ApiKeysPanel />

          {/* Download */}
          <Panel title="[DOWNLOAD]">
            <div className="p-3">
              <Field label="pasta de destino">
                <input
                  className={inputCls}
                  value={cfg.download_path}
                  onChange={(e) => set("download_path", e.target.value)}
                  placeholder="/downloads ou /mnt/media/anime"
                />
              </Field>
              <Field label="qualidade padrão">
                <select className={selectCls} value={cfg.quality} onChange={(e) => set("quality", e.target.value)}>
                  {["2160p", "1080p", "720p", "480p", "best"].map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </Field>
              <Field label="esquema de nomes">
                <select className={selectCls} value={cfg.naming_scheme} onChange={(e) => set("naming_scheme", e.target.value)}>
                  <option value="jellyfin">Jellyfin (Title (Year)/Season XX/...)</option>
                  <option value="plex">Plex (Title (Year)/Season XX/...)</option>
                  <option value="simple">Simples (Title/EpXX)</option>
                </select>
              </Field>
              <Field label="downloads simultâneos">
                <input
                  type="number"
                  className={inputCls}
                  min={1} max={10}
                  value={cfg.max_concurrent}
                  onChange={(e) => set("max_concurrent", e.target.value)}
                />
              </Field>
              <Field label="provider padrão">
                <select className={selectCls} value={cfg.provider} onChange={(e) => set("provider", e.target.value)}>
                  {["animefire", "goyabu", "allanime", "nineanime", "animedrive", "superflix", "dattebayo"].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <div className="flex flex-col gap-2 mt-1">
                <Toggle
                  value={cfg.prefer_sub === "true"}
                  onChange={(v) => setBool("prefer_sub", v)}
                  label="preferir legenda (sub)"
                />
                <Toggle
                  value={cfg.allow_simulated_downloads === "true"}
                  onChange={(v) => setBool("allow_simulated_downloads", v)}
                  label="downloads simulados (dev)"
                />
              </div>
              <div className="mt-3 border-t border-[#45475a] pt-3">
                <label className={labelCls}>alerta de disco baixo (GB livres)</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className={inputCls}
                  value={cfg.disk_alert_threshold_gb}
                  onChange={(e) => set("disk_alert_threshold_gb", e.target.value)}
                />
                <p className="mt-1 text-[11px] text-[#6c7086]">Alerta no log quando espaço livre cair abaixo deste valor. 0 = desativado.</p>
              </div>
            </div>
          </Panel>

          {/* yt-dlp */}
          <Panel title="[YT-DLP / FFMPEG]">
            <div className="p-3">
              <Field label="caminho do yt-dlp">
                <input
                  className={inputCls}
                  value={cfg.yt_dlp_path}
                  onChange={(e) => set("yt_dlp_path", e.target.value)}
                  placeholder="yt-dlp"
                />
              </Field>
              <Field label="caminho do ffmpeg">
                <input
                  className={inputCls}
                  value={cfg.ffmpeg_path}
                  onChange={(e) => set("ffmpeg_path", e.target.value)}
                  placeholder="ffmpeg"
                />
              </Field>
              <div className="mt-4 border-t border-[#45475a] pt-3">
                <div className={`${labelCls} mb-2`}>retry automático</div>
                <Toggle
                  value={cfg.auto_retry_enabled === "true"}
                  onChange={(v) => setBool("auto_retry_enabled", v)}
                  label="ativar retry automático"
                />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>tentativas</label>
                    <input type="number" min={0} max={20} className={inputCls}
                      value={cfg.retry_max_attempts}
                      onChange={(e) => set("retry_max_attempts", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>delay base (s)</label>
                    <input type="number" min={1} className={inputCls}
                      value={cfg.retry_base_delay_seconds}
                      onChange={(e) => set("retry_base_delay_seconds", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>delay máx (s)</label>
                    <input type="number" min={1} className={inputCls}
                      value={cfg.retry_max_delay_seconds}
                      onChange={(e) => set("retry_max_delay_seconds", e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* qBittorrent */}
          <Panel title="[QBITTORRENT]">
            <div className="p-3">
              <div className="mb-3">
                <Toggle
                  value={isQbtEnabled}
                  onChange={(v) => setBool("qbittorrent_enabled", v)}
                  label="habilitar integração qBittorrent"
                />
              </div>
              <Field label="endereço WebUI">
                <input
                  className={inputCls}
                  value={cfg.qbittorrent_host}
                  onChange={(e) => set("qbittorrent_host", e.target.value)}
                  placeholder="http://qbittorrent:8080 (Docker) ou http://localhost:8080"
                  disabled={!isQbtEnabled}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="usuário">
                  <input className={inputCls}
                    value={cfg.qbittorrent_username}
                    onChange={(e) => set("qbittorrent_username", e.target.value)}
                    disabled={!isQbtEnabled} />
                </Field>
                <Field label="senha">
                  <input type="password" className={inputCls}
                    value={cfg.qbittorrent_password}
                    onChange={(e) => set("qbittorrent_password", e.target.value)}
                    disabled={!isQbtEnabled} />
                </Field>
              </div>
              <Field label="pasta de download (vazio = padrão)">
                <input
                  className={inputCls}
                  value={cfg.qbittorrent_save_path}
                  onChange={(e) => set("qbittorrent_save_path", e.target.value)}
                  placeholder="(usa download_path padrão)"
                  disabled={!isQbtEnabled}
                />
              </Field>
              <div className="mt-2 flex items-center gap-2">
                <Btn onClick={handleTestQbt} disabled={qbtTesting || !isQbtEnabled}>
                  {qbtTesting ? "testando..." : "testar conexão"}
                </Btn>
                {qbtStatus && (
                  <span className={`text-[11px] font-bold ${qbtStatus.ok ? "text-[#a6e3a1]" : "text-[#f38ba8]"}`}>
                    {qbtStatus.ok
                      ? `✓ conectado${qbtStatus.version ? ` v${qbtStatus.version}` : ""}`
                      : `✕ ${qbtStatus.error ?? "falha"}`}
                  </span>
                )}
              </div>
              {!isQbtEnabled && (
                <p className="mt-3 text-[11px] text-[#6c7086] leading-relaxed">
                  Com qBittorrent ativo, você pode buscar torrents no Nyaa.si e enviar diretamente ao cliente. O progresso é monitorado automaticamente.
                </p>
              )}
            </div>
          </Panel>

          {/* Nyaa.si */}
          <Panel title="[NYAA.SI — TORRENT]">
            <div className="p-3">
              <p className="mb-3 text-[11px] text-[#6c7086] leading-relaxed">
                Busca automática de torrents no Nyaa.si. Os resultados são ranqueados por grupo e resolução preferidos.
              </p>
              <Field label="grupo preferido">
                <input
                  className={inputCls}
                  value={cfg.nyaa_preferred_group}
                  onChange={(e) => set("nyaa_preferred_group", e.target.value)}
                  placeholder="SubsPlease"
                />
              </Field>
              <Field label="resolução preferida">
                <select className={selectCls} value={cfg.nyaa_preferred_resolution} onChange={(e) => set("nyaa_preferred_resolution", e.target.value)}>
                  {["2160p", "1080p", "720p", "480p"].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="categoria padrão">
                <select className={selectCls} value={cfg.nyaa_default_category} onChange={(e) => set("nyaa_default_category", e.target.value)}>
                  <option value="1_2">Anime — English Translated</option>
                  <option value="1_4">Anime — Raw</option>
                  <option value="1_1">Anime — Anime Music Video</option>
                  <option value="0_0">Tudo</option>
                </select>
              </Field>
              <div className="mt-2 border border-[#2a2a38] bg-[#0d0d12] p-2 text-[11px] text-[#6c7086]">
                <div className="text-[#cba6f7] font-bold mb-1">grupos populares:</div>
                <div className="flex flex-wrap gap-1">
                  {["SubsPlease", "Erai-raws", "HorribleSubs", "Judas", "Yameii"].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => set("nyaa_preferred_group", g)}
                      className={`border px-2 py-[2px] text-[11px] transition-colors ${
                        cfg.nyaa_preferred_group === g
                          ? "border-[#cba6f7] text-[#cba6f7]"
                          : "border-[#45475a] text-[#6c7086] hover:border-[#cba6f7] hover:text-[#cba6f7]"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          {/* Legendas / OpenSubtitles */}
          <Panel title="[LEGENDAS / OPENSUBTITLES]">
            <div className="p-3">
              <div className="mb-3 border border-[#2a2a38] bg-black/20 px-3 py-2 text-[11px] text-[#6c7086] leading-relaxed">
                <span className="text-[#cba6f7] font-bold">API Key</span> é necessária para busca de legendas.{" "}
                <a href="https://www.opensubtitles.com/consumers" target="_blank" rel="noopener noreferrer" className="text-[#89dceb] hover:underline">
                  opensubtitles.com/consumers ↗
                </a>
                <br />
                <span className="text-[#cba6f7] font-bold">Usuário/Senha</span> são opcionais — necessários apenas para mais de 5 downloads/dia.
              </div>
              <Field label="API Key">
                <input
                  className={inputCls}
                  value={cfg.opensubtitles_api_key}
                  onChange={(e) => set("opensubtitles_api_key", e.target.value)}
                  placeholder="cole sua API key aqui"
                  type="password"
                  autoComplete="off"
                />
              </Field>
              <Field label="Usuário (opcional)">
                <input
                  className={inputCls}
                  value={cfg.opensubtitles_username}
                  onChange={(e) => set("opensubtitles_username", e.target.value)}
                  placeholder="seu login no OpenSubtitles"
                  autoComplete="off"
                />
              </Field>
              <Field label="Senha (opcional)">
                <input
                  className={inputCls}
                  value={cfg.opensubtitles_password}
                  onChange={(e) => set("opensubtitles_password", e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  autoComplete="off"
                />
              </Field>
              {cfg.opensubtitles_api_key && (
                <div className="mt-1 text-[11px] text-[#a6e3a1]">✓ API Key configurada</div>
              )}
              <div className="mt-3 border-t border-[#45475a] pt-3">
                <Toggle
                  value={cfg.auto_subtitle_enabled === "true"}
                  onChange={(v) => setBool("auto_subtitle_enabled", v)}
                  label="baixar legenda automática após download (providers inglês)"
                />
                <p className="mt-1 text-[11px] text-[#6c7086]">
                  Ativa para allanime e nineanime. Requer API Key configurada acima.
                </p>
              </div>
            </div>
          </Panel>

          {/* Backup — ocupa col 3 da linha NYAA+LEGENDAS */}
          <BackupPanel />

          {/* Webhook — col-span-2 para dar espaço ao campo de URL */}
          <WebhookPanel cfg={cfg} set={set} setBool={setBool} className="md:col-span-2" />

          {/* Atualização — col 3 da linha do Webhook */}
          <UpdatePanel />

          {/* Queue Profiles */}
          <QueueProfilesPanel />

          {/* Estatísticas e Auto-schedule */}
          <StatsPanel />

          {/* Provider Health */}
          <ProviderHealthPanel />

          {/* Info / Atalhos */}
          <Panel title="[ATALHOS]" className="md:col-span-2">
            <div className="p-3 text-[12px] text-[#6c7086] space-y-2">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {[
                  ["Tab", "trocar aba"],
                  ["↑ / k", "navegar cima"],
                  ["↓ / j", "navegar baixo"],
                  ["d", "fila: eps faltando"],
                  ["b", "fila: todos os animes"],
                  ["s", "escanear biblioteca"],
                  ["r", "atualizar dados"],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="font-bold text-[#cba6f7] min-w-[40px]">{key}</span>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-[#45475a] pt-3 text-[11px]">
                <div className="text-[#cba6f7] font-bold mb-1">API endpoints úteis:</div>
                {[
                  "/api/nyaa/search?q=titulo",
                  "/api/torrent/status",
                  "/api/providers/health",
                  "/api/metadata/jikan/search?q=titulo",
                ].map((ep) => (
                  <div key={ep} className="font-mono text-[10px] text-[#45475a]">{ep}</div>
                ))}
              </div>
            </div>
          </Panel>

        </div>
      </div>

      {/* Footer com botão save */}
      <div className="mt-2 shrink-0 flex items-center justify-between border-t border-[#45475a] pt-2 text-[11px] text-[#6c7086]">
        <span>as configurações são salvas no SQLite e aplicadas imediatamente</span>
        <Btn onClick={handleSave} disabled={saving} variant="primary">
          {saving ? "salvando..." : "salvar tudo"}
        </Btn>
      </div>
    </div>
  );
}

