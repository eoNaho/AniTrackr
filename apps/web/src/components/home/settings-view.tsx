"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  fetchConfig,
  fetchProviderHealth,
  resetProviderCircuit,
  saveConfig,
  testQbtConnection,
  type ProviderHealthEntry,
  type QbtConnectionStatus,
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

  useEffect(() => { void load(); }, [load]);

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
                  <span className="text-[#6c7086] text-[11px]">● closed (sem dados)</span>
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
  allow_simulated_downloads: "true",
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
};

export function SettingsView({ onSaved }: SettingsViewProps) {
  const [cfg, setCfg] = useState<ConfigState>({ ...DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qbtStatus, setQbtStatus] = useState<QbtConnectionStatus | null>(null);
  const [qbtTesting, setQbtTesting] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchConfig()
      .then((data) => setCfg({ ...DEFAULTS, ...data }))
      .catch(() => {})
      .finally(() => setLoading(false));
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
      setTimeout(() => setSaved(false), 2000);
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
        <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 auto-rows-min">

          {/* Download */}
          <Panel title="[DOWNLOAD]">
            <div className="p-3">
              <Field label="pasta de destino">
                <input
                  className={inputCls}
                  value={cfg.download_path}
                  onChange={(e) => set("download_path", e.target.value)}
                  placeholder="C:\Usuarios\...\Anime"
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
                  placeholder="http://localhost:8080"
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

          {/* Provider Health */}
          <ProviderHealthPanel />

          {/* Info / Atalhos */}
          <Panel title="[ATALHOS]">
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
