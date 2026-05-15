/**
 * Cliente para qBittorrent Web API v2.
 * Docs: https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)
 */

import db from "../db/index.ts";

function getConfig(key: string): string {
  return db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key)?.value ?? "";
}

interface QBTorrentInfo {
  hash: string;
  name: string;
  state: string;
  progress: number;
  dlspeed: number;
  upspeed: number;
  num_seeds: number;
  num_leechs: number;
  size: number;
  downloaded: number;
  save_path: string;
  category: string;
  tags: string;
  added_on: number;
  completion_on: number;
  eta: number;
  ratio: number;
  completed: number;
  content_path: string;
}

export type { QBTorrentInfo };

export type QBState =
  | "downloading" | "uploading" | "stalledDL" | "stalledUP"
  | "pausedDL" | "pausedUP" | "queuedDL" | "queuedUP"
  | "checkingDL" | "checkingUP" | "checkingResumeData"
  | "error" | "missingFiles" | "unknown" | "moving";

// Mapeia estado qBittorrent para status interno
export function mapQBState(state: string): "downloading" | "completed" | "paused" | "failed" | "queued" {
  switch (state) {
    case "downloading":
    case "stalledDL":
    case "checkingDL":
    case "moving":
      return "downloading";
    case "uploading":
    case "stalledUP":
    case "checkingUP":
      return "completed";
    case "pausedDL":
      return "paused";
    case "pausedUP":
      return "completed";
    case "queuedDL":
      return "queued";
    case "error":
    case "missingFiles":
      return "failed";
    default:
      return "downloading";
  }
}

let sessionCookie = "";
let authBypass = false;
let lastLogin = 0;
const SESSION_TTL_MS = 55 * 60 * 1000;

async function getBase(): Promise<string> {
  return (getConfig("qbittorrent_host") || "http://localhost:8080").replace(/\/$/, "");
}

async function ensureAuth(): Promise<boolean> {
  if ((sessionCookie || authBypass) && Date.now() - lastLogin < SESSION_TTL_MS) return true;

  const base = await getBase();
  const username = getConfig("qbittorrent_username") || "admin";
  const password = getConfig("qbittorrent_password") || "adminadmin";

  try {
    const resp = await fetch(`${base}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      signal: AbortSignal.timeout(5_000),
    });

    const setCookie = resp.headers.get("set-cookie") ?? "";
    const sidMatch = setCookie.match(/SID=([^;]+)/);
    if (sidMatch) {
      sessionCookie = `SID=${sidMatch[1]}`;
      lastLogin = Date.now();
      return true;
    }

    const text = await resp.text();
    if (text.trim() === "Ok.") {
      authBypass = true;
      lastLogin = Date.now();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const base = await getBase();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (sessionCookie) headers["Cookie"] = sessionCookie;

  const resp = await fetch(`${base}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  // Se 403, tenta re-auth
  if (resp.status === 403) {
    sessionCookie = "";
    const ok = await ensureAuth();
    if (!ok) throw new Error("qBittorrent: autenticação falhou");
    headers["Cookie"] = sessionCookie;
    return fetch(`${base}${path}`, { ...options, headers, signal: AbortSignal.timeout(10_000) });
  }

  return resp;
}

export async function qbtIsEnabled(): Promise<boolean> {
  return getConfig("qbittorrent_enabled") === "true";
}

export async function qbtConnect(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const ok = await ensureAuth();
    if (!ok) return { ok: false, error: "Login falhou" };

    const resp = await apiFetch("/api/v2/app/version");
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const version = await resp.text();
    return { ok: true, version: version.trim() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function qbtAddMagnet(
  magnetLink: string,
  options: { savePath?: string; category?: string; tags?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  await ensureAuth();
  const savePath = options.savePath || getConfig("qbittorrent_save_path") || getConfig("download_path");

  const form = new URLSearchParams();
  form.set("urls", magnetLink);
  if (savePath) form.set("savepath", savePath);
  if (options.category) form.set("category", options.category);
  if (options.tags) form.set("tags", options.tags);
  form.set("sequentialDownload", "false");

  try {
    const resp = await apiFetch("/api/v2/torrents/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const text = await resp.text();
    if (text.trim() === "Ok.") return { ok: true };
    return { ok: false, error: text };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function qbtAddTorrentUrl(
  torrentUrl: string,
  options: { savePath?: string; category?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  await ensureAuth();
  const savePath = options.savePath || getConfig("qbittorrent_save_path") || getConfig("download_path");

  const form = new URLSearchParams();
  form.set("urls", torrentUrl);
  if (savePath) form.set("savepath", savePath);
  if (options.category) form.set("category", options.category);

  try {
    const resp = await apiFetch("/api/v2/torrents/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const text = await resp.text();
    if (text.trim() === "Ok.") return { ok: true };
    return { ok: false, error: text };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function qbtGetTorrents(hashes?: string[]): Promise<QBTorrentInfo[]> {
  await ensureAuth();
  let url = "/api/v2/torrents/info";
  if (hashes?.length) {
    const safeHashes = hashes.filter((h) => /^[a-fA-F0-9]{40}$/.test(h));
    if (safeHashes.length) url += `?hashes=${safeHashes.join("|")}`;
  }

  try {
    const resp = await apiFetch(url);
    if (!resp.ok) return [];
    return (await resp.json()) as QBTorrentInfo[];
  } catch {
    return [];
  }
}

export async function qbtGetTorrent(hash: string): Promise<QBTorrentInfo | null> {
  const list = await qbtGetTorrents([hash]);
  return list[0] ?? null;
}

export async function qbtPause(hash: string): Promise<boolean> {
  await ensureAuth();
  const form = new URLSearchParams({ hashes: hash });
  try {
    const resp = await apiFetch("/api/v2/torrents/pause", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function qbtResume(hash: string): Promise<boolean> {
  await ensureAuth();
  const form = new URLSearchParams({ hashes: hash });
  try {
    const resp = await apiFetch("/api/v2/torrents/resume", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function qbtDelete(hash: string, deleteFiles = false): Promise<boolean> {
  await ensureAuth();
  const form = new URLSearchParams({
    hashes: hash,
    deleteFiles: String(deleteFiles),
  });
  try {
    const resp = await apiFetch("/api/v2/torrents/delete", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function qbtGetCategories(): Promise<string[]> {
  await ensureAuth();
  try {
    const resp = await apiFetch("/api/v2/torrents/categories");
    if (!resp.ok) return [];
    const data = await resp.json() as Record<string, unknown>;
    return Object.keys(data);
  } catch {
    return [];
  }
}
