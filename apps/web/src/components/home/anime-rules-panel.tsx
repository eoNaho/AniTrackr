"use client";

import React, { useCallback, useEffect, useState } from "react";
import { fetchAnimeRules, saveAnimeRules, deleteAnimeRules, type AnimeRule } from "@/lib/api";

const QUALITIES = ["", "480p", "720p", "1080p", "2160p"];
const PROVIDERS = ["", "animefire", "goyabu", "animedrive", "superflix", "dattebayo", "allanime", "nineanime"];

interface Props {
  animeId: string;
  animeTitle: string;
}

export function AnimeRulesPanel({ animeId, animeTitle }: Props) {
  const [rule, setRule] = useState<AnimeRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchAnimeRules(animeId);
      setRule(data);
    } catch { /* silent */ }
  }, [animeId]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!rule) return null;

  async function handleSave() {
    if (!rule) return;
    setSaving(true);
    setStatus(null);
    try {
      await saveAnimeRules(animeId, {
        autoDownload:         rule.auto_download,
        preferredProvider:    rule.preferred_provider || null,
        preferredQuality:     rule.preferred_quality || null,
        minQuality:           rule.min_quality || null,
        preferredFansub:      rule.preferred_fansub || null,
        preferredLanguage:    rule.preferred_language || null,
        downloadWindowStart:  rule.download_window_start || null,
        downloadWindowEnd:    rule.download_window_end || null,
        dailyLimit:           rule.daily_limit ?? 0,
        skipFillers:          rule.skip_fillers ?? 0,
        skipRecaps:           rule.skip_recaps ?? 0,
        notes:                rule.notes || null,
      });
      setStatus("Regras salvas.");
    } catch (e) {
      setStatus(`Erro: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setStatus(null);
    try {
      await deleteAnimeRules(animeId);
      await load();
      setStatus("Regras redefinidas.");
    } catch (e) {
      setStatus(`Erro: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const update = (patch: Partial<AnimeRule>) => setRule((r) => r ? { ...r, ...patch } : r);

  return (
    <div className="border border-dashed border-[#45475a] bg-black/20">
      {/* Header (toggle) */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/5"
      >
        <span className="text-[12px] font-bold text-[#89dceb]">-- REGRAS DE DOWNLOAD --</span>
        <span className="flex items-center gap-2 text-[11px]">
          {rule.auto_download === 0 && (
            <span className="text-[#f38ba8] font-bold">AUTO-DL OFF</span>
          )}
          {rule.download_window_start && (
            <span className="text-[#f9e2af]">{rule.download_window_start}–{rule.download_window_end}</span>
          )}
          {(rule.daily_limit ?? 0) > 0 && (
            <span className="text-[#bac2de]">≤{rule.daily_limit}/dia</span>
          )}
          <span className="text-[#6c7086]">{expanded ? "▲" : "▼"}</span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[#232330] px-3 py-3 flex flex-col gap-3">
          {/* Auto-download toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#6c7086] uppercase tracking-wider">Auto-Download</span>
            <button
              onClick={() => update({ auto_download: rule.auto_download ? 0 : 1 })}
              className={`text-[12px] font-bold transition-colors ${rule.auto_download ? "text-[#a6e3a1]" : "text-[#f38ba8]"}`}
            >
              {rule.auto_download ? "● habilitado" : "○ desabilitado"}
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {/* Qualidade mínima */}
            <FieldRow label="Qualidade mínima">
              <select
                value={rule.min_quality ?? ""}
                onChange={(e) => update({ min_quality: e.target.value || null })}
                className={selectCls}
              >
                {QUALITIES.map((q) => <option key={q} value={q}>{q || "qualquer"}</option>)}
              </select>
            </FieldRow>

            {/* Provider preferido */}
            <FieldRow label="Provider preferido">
              <select
                value={rule.preferred_provider ?? ""}
                onChange={(e) => update({ preferred_provider: e.target.value || null })}
                className={selectCls}
              >
                {PROVIDERS.map((p) => <option key={p} value={p}>{p || "padrão"}</option>)}
              </select>
            </FieldRow>

            {/* Fansub preferido */}
            <FieldRow label="Fansub / grupo">
              <input
                value={rule.preferred_fansub ?? ""}
                onChange={(e) => update({ preferred_fansub: e.target.value || null })}
                placeholder="ex.: SubsPlease"
                className={inputCls}
              />
            </FieldRow>

            {/* Limite diário */}
            <FieldRow label="Limite diário (0 = sem limite)">
              <input
                type="number"
                min={0}
                max={50}
                value={rule.daily_limit}
                onChange={(e) => update({ daily_limit: Math.max(0, parseInt(e.target.value) || 0) })}
                className={inputCls}
              />
            </FieldRow>

            {/* Janela de horário */}
            <FieldRow label="Janela — início (HH:MM)">
              <input
                type="time"
                value={rule.download_window_start ?? ""}
                onChange={(e) => update({ download_window_start: e.target.value || null })}
                className={inputCls}
              />
            </FieldRow>

            <FieldRow label="Janela — fim (HH:MM)">
              <input
                type="time"
                value={rule.download_window_end ?? ""}
                onChange={(e) => update({ download_window_end: e.target.value || null })}
                className={inputCls}
              />
            </FieldRow>
          </div>

          {/* Toggles: filler / recap */}
          <div className="flex gap-4 text-[12px]">
            <Toggle
              active={!!rule.skip_fillers}
              label="Pular fillers"
              onChange={(v) => update({ skip_fillers: v ? 1 : 0 })}
            />
            <Toggle
              active={!!rule.skip_recaps}
              label="Pular recaps"
              onChange={(v) => update({ skip_recaps: v ? 1 : 0 })}
            />
          </div>

          {/* Notas */}
          <FieldRow label="Notas (livre)">
            <textarea
              rows={2}
              value={rule.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value || null })}
              className={`${inputCls} resize-none`}
              placeholder={`Notas sobre ${animeTitle}`}
            />
          </FieldRow>

          {/* Ações */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="border border-[#cba6f7] px-3 py-1.5 text-[11px] font-bold uppercase text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#0f0f14] disabled:opacity-40"
            >
              {saving ? "salvando..." : "salvar regras"}
            </button>
            <button
              onClick={() => void handleReset()}
              disabled={saving}
              className="border border-[#45475a] px-3 py-1.5 text-[11px] uppercase text-[#6c7086] hover:border-[#f38ba8] hover:text-[#f38ba8] disabled:opacity-40"
            >
              redefinir
            </button>
            {status && (
              <span className={`text-[11px] ${status.startsWith("Erro") ? "text-[#f38ba8]" : "text-[#a6e3a1]"}`}>
                {status}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── micro-components ──────────────────────────────────────────────────────────

const inputCls =
  "w-full border border-[#45475a] bg-[#0f0f14] px-2 py-1 text-[12px] text-[#e0e0ed] outline-none focus:border-[#cba6f7]";
const selectCls =
  "w-full border border-[#45475a] bg-[#0f0f14] px-2 py-1 text-[12px] text-[#e0e0ed] outline-none focus:border-[#cba6f7] cursor-pointer";

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[#6c7086]">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ active, label, onChange }: { active: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!active)}
      className={`flex items-center gap-1.5 transition-colors ${active ? "text-[#f9e2af]" : "text-[#6c7086]"}`}
    >
      <span>{active ? "●" : "○"}</span>
      <span>{label}</span>
    </button>
  );
}
