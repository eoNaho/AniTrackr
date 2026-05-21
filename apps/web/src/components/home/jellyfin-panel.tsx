"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchJellyfinStatus,
  fetchJellyfinLibraries,
  testJellyfinConnection,
  refreshJellyfinLibrary,
  fetchJellyfinReadiness,
  saveConfig,
  fetchConfig,
  type JellyfinStatus,
  type JellyfinLibrary,
  type JellyfinReadiness,
  type JellyfinTestResult,
} from "@/lib/api";
import { Panel } from "./ui";

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

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
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

function StatusDot({ ok, label }: { ok: boolean | null; label: string }) {
  const color = ok === null ? "text-[#6c7086]" : ok ? "text-[#a6e3a1]" : "text-[#f38ba8]";
  const dot = ok === null ? "○" : ok ? "●" : "✕";
  return (
    <span className={`text-[11px] font-mono ${color}`}>
      {dot} {label}
    </span>
  );
}

export function JellyfinPanel({ className }: { className?: string }) {
  const MASK = "***";

  const [cfg, setCfg] = useState({
    jellyfin_enabled: "false",
    jellyfin_base_url: "",
    jellyfin_api_key: "",
    jellyfin_library_id: "",
    jellyfin_auto_refresh: "false",
    jellyfin_refresh_mode: "series",
    jellyfin_request_timeout_ms: "10000",
  });
  const [apiKeyMasked, setApiKeyMasked] = useState(true);

  const [status, setStatus] = useState<JellyfinStatus | null>(null);
  const [libraries, setLibraries] = useState<JellyfinLibrary[]>([]);
  const [readiness, setReadiness] = useState<JellyfinReadiness | null>(null);
  const [testResult, setTestResult] = useState<JellyfinTestResult | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // F11: ref para limpar o timer do "Salvo!" no unmount
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); }, []);

  const loadAll = useCallback(async () => {
    try {
      const [configData, statusData, readinessData] = await Promise.all([
        fetchConfig(),
        fetchJellyfinStatus().catch(() => null),
        fetchJellyfinReadiness().catch(() => null),
      ]);
      setCfg((prev) => ({
        ...prev,
        jellyfin_enabled: configData.jellyfin_enabled ?? "false",
        jellyfin_base_url: configData.jellyfin_base_url ?? "",
        jellyfin_api_key: configData.jellyfin_api_key ?? "",
        jellyfin_library_id: configData.jellyfin_library_id ?? "",
        jellyfin_auto_refresh: configData.jellyfin_auto_refresh ?? "false",
        jellyfin_refresh_mode: configData.jellyfin_refresh_mode ?? "series",
        jellyfin_request_timeout_ms: configData.jellyfin_request_timeout_ms ?? "10000",
      }));
      if (statusData) setStatus(statusData);
      if (readinessData) setReadiness(readinessData);
    } catch {
      // silencioso
    }
  }, []);

  useEffect(() => { setTimeout(() => void loadAll(), 0); }, [loadAll]);

  function set(key: string, value: string) {
    setCfg((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    // F26: trocar a URL invalida as bibliotecas carregadas do servidor anterior
    if (key === "jellyfin_base_url") setLibraries([]);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveConfig(cfg);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
      const statusData = await fetchJellyfinStatus().catch(() => null);
      if (statusData) setStatus(statusData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const apiKeyPayload = cfg.jellyfin_api_key === MASK ? undefined : cfg.jellyfin_api_key;
      const saveRes = await saveConfig({
        jellyfin_enabled: cfg.jellyfin_enabled,
        jellyfin_base_url: cfg.jellyfin_base_url,
        ...(apiKeyPayload !== undefined ? { jellyfin_api_key: apiKeyPayload } : {}),
        jellyfin_request_timeout_ms: cfg.jellyfin_request_timeout_ms,
      } as Record<string, string>);
      // F12: Se enviamos uma API key nova mas não foi salva, avisar em vez de testar com chave antiga
      if (apiKeyPayload && !saveRes.updated?.includes("jellyfin_api_key")) {
        setError("A API Key não pôde ser salva antes do teste (verifique se o valor é válido). Tente salvar manualmente primeiro.");
        return;
      }
      const result = await testJellyfinConnection();
      setTestResult(result);
      const statusData = await fetchJellyfinStatus().catch(() => null);
      if (statusData) setStatus(statusData);
    } catch (e) {
      setTestResult({ ok: false, connected: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function handleLoadLibraries() {
    setLoadingLibraries(true);
    setError(null);
    try {
      const res = await fetchJellyfinLibraries();
      if (res.ok && res.libraries) {
        setLibraries(res.libraries);
      } else {
        setError(res.message ?? "Falha ao carregar bibliotecas");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingLibraries(false);
    }
  }

  async function handleRefreshLibrary() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await refreshJellyfinLibrary(cfg.jellyfin_library_id || undefined);
      if (!res.ok) setError(res.message);
      else {
        const statusData = await fetchJellyfinStatus().catch(() => null);
        if (statusData) setStatus(statusData);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  const isEnabled = cfg.jellyfin_enabled === "true";

  return (
    <Panel title="[JELLYFIN]" className={className}>
      <div className="p-3">

        {/* Toggle habilitado */}
        <div className="mb-4">
          <Toggle
            value={isEnabled}
            onChange={(v) => set("jellyfin_enabled", v ? "true" : "false")}
            label="Ativar integração Jellyfin"
          />
        </div>

        {/* Status rápido */}
        {status && (
          <div className="mb-4 flex flex-wrap gap-3 border border-[#1e2030] p-2">
            <StatusDot ok={status.configured} label="configurado" />
            <StatusDot ok={status.autoRefresh ? true : null} label="auto-refresh" />
            {status.pendingRefreshes > 0 && (
              <span className="text-[11px] text-[#f9e2af]">⏳ {status.pendingRefreshes} refresh(es) pendentes</span>
            )}
            {status.lastError && (
              <span className="text-[11px] text-[#f38ba8] break-all">✕ {status.lastError}</span>
            )}
            {status.lastRefreshAt && (
              <span className="text-[11px] text-[#6c7086]">último refresh: {new Date(status.lastRefreshAt).toLocaleString("pt-BR")}</span>
            )}
          </div>
        )}

        {/* Campos de configuração */}
        <Field label="URL do servidor">
          <input
            className={inputCls}
            value={cfg.jellyfin_base_url}
            onChange={(e) => set("jellyfin_base_url", e.target.value)}
            placeholder="http://192.168.1.100:8096"
            disabled={!isEnabled}
          />
        </Field>

        <Field label="API Key">
          <div className="flex gap-1">
            <input
              className={inputCls}
              type={apiKeyMasked ? "password" : "text"}
              value={cfg.jellyfin_api_key}
              onChange={(e) => set("jellyfin_api_key", e.target.value)}
              placeholder="cole sua API Key aqui"
              disabled={!isEnabled}
            />
            <button
              type="button"
              onClick={() => setApiKeyMasked((v) => !v)}
              className="border border-[#45475a] px-2 text-[10px] text-[#6c7086] hover:text-[#cba6f7] hover:border-[#cba6f7] transition-colors"
            >
              {apiKeyMasked ? "ver" : "ocultar"}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-[#6c7086]">
            Gerar em: Jellyfin → Dashboard → API Keys
          </p>
        </Field>

        <Field label="Biblioteca alvo">
          <div className="flex gap-1">
            <select
              className={selectCls}
              value={cfg.jellyfin_library_id}
              onChange={(e) => set("jellyfin_library_id", e.target.value)}
              disabled={!isEnabled}
            >
              <option value="">(selecione uma biblioteca)</option>
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name} [{lib.collectionType}]
                </option>
              ))}
            </select>
            <Btn onClick={handleLoadLibraries} disabled={!isEnabled || loadingLibraries}>
              {loadingLibraries ? "..." : "carregar"}
            </Btn>
          </div>
          {cfg.jellyfin_library_id && libraries.length === 0 && (
            <p className="mt-1 text-[10px] text-[#6c7086]">ID salvo: {cfg.jellyfin_library_id}</p>
          )}
        </Field>

        <Field label="Modo de refresh">
          <select
            className={selectCls}
            value={cfg.jellyfin_refresh_mode}
            onChange={(e) => set("jellyfin_refresh_mode", e.target.value)}
            disabled={!isEnabled}
          >
            <option value="series">Por série (recomendado)</option>
            <option value="library">Biblioteca completa</option>
            <option value="none">Desativado</option>
          </select>
        </Field>

        <Field label="Timeout (ms)">
          <input
            className={inputCls}
            type="number"
            min="1000"
            max="60000"
            step="1000"
            value={cfg.jellyfin_request_timeout_ms}
            onChange={(e) => set("jellyfin_request_timeout_ms", e.target.value)}
            disabled={!isEnabled}
          />
        </Field>

        <div className="mb-4">
          <Toggle
            value={cfg.jellyfin_auto_refresh === "true"}
            onChange={(v) => set("jellyfin_auto_refresh", v ? "true" : "false")}
            label="Refresh automático após download"
          />
        </div>

        {/* Resultado do teste */}
        {testResult && (
          <div className={`mb-3 p-2 text-[11px] border ${testResult.ok ? "border-[#a6e3a1] text-[#a6e3a1]" : "border-[#f38ba8] text-[#f38ba8]"}`}>
            {testResult.ok
              ? `✓ ${testResult.message} — ${testResult.serverName} v${testResult.version}`
              : `✕ ${testResult.message}`}
          </div>
        )}

        {/* Readiness */}
        {readiness && (
          <div className="mb-3 border border-[#1e2030] p-2 space-y-1">
            <p className="text-[10px] text-[#6c7086] uppercase tracking-wider mb-1">Prontidão da biblioteca</p>
            <div className="flex flex-wrap gap-2">
              <StatusDot ok={readiness.mediaPathAccessible} label="media_path acessível" />
              <StatusDot ok={readiness.enabledNamingScheme === "jellyfin"} label="naming=jellyfin" />
              <StatusDot ok={readiness.seriesWithoutTvshowNfo === 0} label={`tvshow.nfo (${readiness.seriesWithoutTvshowNfo} faltando)`} />
              <StatusDot ok={readiness.episodesMissingNfoTotal === 0} label={`ep.nfo (${readiness.episodesMissingNfoTotal} faltando)`} />
              <StatusDot ok={readiness.missingPoster === 0} label={`poster (${readiness.missingPoster} faltando)`} />
            </div>
            <p className={`text-[11px] font-bold mt-2 ${readiness.readyForJellyfin ? "text-[#a6e3a1]" : "text-[#f9e2af]"}`}>
              {readiness.readyForJellyfin ? "✓ Biblioteca pronta para Jellyfin" : "⚠ Biblioteca tem pendências"}
            </p>
          </div>
        )}

        {error && (
          <p className="mb-3 text-[11px] text-[#f38ba8]">✕ {error}</p>
        )}

        {/* Ações */}
        <div className="flex flex-wrap gap-2">
          <Btn onClick={handleSave} variant="primary" disabled={saving}>
            {saving ? "salvando..." : saved ? "✓ salvo" : "salvar"}
          </Btn>
          <Btn onClick={handleTest} disabled={!isEnabled || testing}>
            {testing ? "testando..." : "testar conexão"}
          </Btn>
          <Btn onClick={handleRefreshLibrary} variant="success" disabled={!isEnabled || refreshing}>
            {refreshing ? "..." : "refresh agora"}
          </Btn>
        </div>

      </div>
    </Panel>
  );
}
