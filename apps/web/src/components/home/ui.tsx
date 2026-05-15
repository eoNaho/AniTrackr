"use client";

import React from "react";

// ── types ─────────────────────────────────────────────────────────────────────
export type DownloadStatus = string;

export type AnimeView = {
  id: string;
  title: string;
  altTitle: string | null;
  provider: string;
  quality: string;
  downloaded: number;
  total: number;
  missing: number;
  synopsis: string;
  path: string;
  status: DownloadStatus;
  sizeGb: number;
  tags: string[];
  posterUrl: string | null;
  asciiArt: string | null;
  progress: number;
  year: number | null;
  rating: number | null;
};

// ── helpers ───────────────────────────────────────────────────────────────────
export function generateBar(current: number, total: number, length = 14): string {
  if (!Number.isFinite(total) || total <= 0) return `[${"░".repeat(length)}]`;
  const filled = Math.round((Math.min(total, Math.max(0, current)) / total) * length);
  return `[${"█".repeat(filled)}${"░".repeat(length - filled)}]`;
}

export function statusColor(status: DownloadStatus): string {
  const s = status?.toLowerCase() ?? "";
  if (s === "downloaded") return "text-[#a6e3a1]";
  if (s === "downloading") return "text-[#89dceb]";
  if (s === "queued") return "text-[#f9e2af]";
  if (s === "retry_wait") return "text-[#fab387]";
  if (s === "failed") return "text-[#f38ba8]";
  if (s === "cancelled") return "text-[#bac2de]";
  if (s === "missing" || s === "paused") return "text-[#f38ba8]";
  return "text-[#6c7086]";
}

export function statusBadgeClass(status: DownloadStatus): string {
  const s = status?.toLowerCase() ?? "";
  if (s === "downloaded") return "bg-[#a6e3a1] text-[#0f0f14]";
  if (s === "downloading") return "bg-[#89dceb] text-[#0f0f14]";
  if (s === "queued") return "bg-[#f9e2af] text-[#0f0f14]";
  if (s === "retry_wait") return "bg-[#fab387] text-[#0f0f14]";
  if (s === "failed") return "bg-[#f38ba8] text-[#0f0f14]";
  if (s === "cancelled") return "bg-[#bac2de] text-[#0f0f14]";
  if (s === "missing" || s === "paused") return "bg-[#f38ba8] text-[#0f0f14]";
  return "border border-[#45475a] text-[#bac2de]";
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export function Panel({
  title,
  focused,
  children,
  className = "",
}: {
  title: string;
  focused?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative flex flex-col border bg-[#1a1a24] pt-4 ${
        focused
          ? "border-[#cba6f7] shadow-[0_0_8px_rgba(203,166,247,.14)]"
          : "border-[#45475a]"
      } ${className}`}
    >
      <div
        className={`absolute -top-0.5 left-4 z-50 bg-[#0f0f14] px-2 text-[12px] font-bold leading-none select-none ${
          focused ? "text-[#a6e3a1]" : "text-[#cba6f7]"
        }`}
      >
        {title}
      </div>
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden w-full">
        {children}
      </div>
    </section>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[11px] font-bold uppercase ${className}`}>
      {children}
    </span>
  );
}

// ── StatBox ───────────────────────────────────────────────────────────────────
export function StatBox({
  label,
  value,
  command,
}: {
  label: string;
  value: string | number;
  command: string;
}) {
  return (
    <div className="border border-[#45475a] bg-black/20 p-3">
      <div className="mb-1 text-[11px] uppercase text-[#6c7086]">{label}</div>
      <div className="flex items-end justify-between gap-1">
        <span className="text-2xl font-extrabold text-[#e0e0ed]">{value}</span>
        <span className="text-xs text-[#89dceb]">{command}</span>
      </div>
    </div>
  );
}

// ── AnimeRow ──────────────────────────────────────────────────────────────────
export function AnimeRow({
  anime,
  index,
  selected,
  onSelect,
}: {
  anime: AnimeView;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const bar = generateBar(anime.downloaded, anime.total);
  return (
    <button
      onClick={onSelect}
      className={`grid w-full grid-cols-[20px_1fr_auto] items-center gap-2 px-3 py-2 text-left text-[13px] ${
        selected
          ? "bg-[#cba6f7] font-bold text-[#0f0f14]"
          : "text-[#e0e0ed] hover:bg-white/5"
      }`}
    >
      <span className={selected ? "text-[#0f0f14]" : "text-[#cba6f7] opacity-0"}>▶</span>
      <span className="min-w-0 truncate">
        <span className={selected ? "text-[#0f0f14]" : "text-[#6c7086]"}>
          #{String(index + 1).padStart(2, "0")}
        </span>{" "}
        {anime.title}
      </span>
      <span className="hidden items-center gap-2 tabular-nums md:flex text-[12px]">
        <span className={selected ? "text-[#0f0f14]" : statusColor(anime.status)}>
          {anime.status}
        </span>
        <span className={selected ? "text-[#0f0f14]" : "text-[#a6e3a1]"}>{bar}</span>
        <span className={selected ? "text-[#0f0f14]" : "text-[#6c7086]"}>
          {anime.downloaded}/{anime.total}
        </span>
      </span>
    </button>
  );
}

// ── ActionBtn ─────────────────────────────────────────────────────────────────
export function ActionBtn({
  kbd,
  label,
  onClick,
  disabled,
}: {
  kbd: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-left text-[#e0e0ed] hover:bg-[#cba6f7] hover:text-[#0f0f14] disabled:opacity-40 disabled:cursor-not-allowed px-1 py-0.5"
    >
      <span className="inline-block px-1.5 py-0.5 text-[11px] font-bold uppercase bg-[#f38ba8] text-[#0f0f14] mr-1">
        {kbd}
      </span>
      {label}
    </button>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "success" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  const palette =
    variant === "danger"
      ? {
          accentText: "text-[#f38ba8]",
          cancelHover: "hover:border-[#f38ba8] hover:text-[#f38ba8]",
          confirmBtn:
            "border border-[#f38ba8] bg-[#f38ba8]/10 text-[#f38ba8] hover:bg-[#f38ba8] hover:text-[#0f0f14]",
        }
      : variant === "success"
      ? {
          accentText: "text-[#a6e3a1]",
          cancelHover: "hover:border-[#a6e3a1] hover:text-[#a6e3a1]",
          confirmBtn:
            "border border-[#a6e3a1] bg-[#a6e3a1]/10 text-[#a6e3a1] hover:bg-[#a6e3a1] hover:text-[#0f0f14]",
        }
      : {
          accentText: "text-[#cba6f7]",
          cancelHover: "hover:border-[#cba6f7] hover:text-[#cba6f7]",
          confirmBtn:
            "border border-[#cba6f7] bg-[#cba6f7]/10 text-[#cba6f7] hover:bg-[#cba6f7] hover:text-[#0f0f14]",
        };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-[520px] border border-[#45475a] bg-[#0f0f14] p-4 shadow-[0_20px_50px_rgba(0,0,0,.8)]">
        <div className={`mb-2 text-[11px] font-bold uppercase tracking-wider ${palette.accentText}`}>[confirm action]</div>
        <h3 className="mb-3 text-[16px] font-extrabold text-[#cba6f7]">{title}</h3>
        <div className="border-l-2 border-[#45475a] bg-black/20 px-3 py-2 text-[13px] leading-[1.6] text-[#bac2de]">
          {message}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`border border-[#45475a] px-3 py-2 text-[12px] font-bold uppercase text-[#6c7086] ${palette.cancelHover} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`${palette.confirmBtn} px-3 py-2 text-[12px] font-bold uppercase disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {busy ? "processando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
