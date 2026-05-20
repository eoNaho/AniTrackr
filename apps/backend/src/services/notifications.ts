/**
 * Webhook notifications — Discord, Gotify, ou HTTP genérico.
 * Lê config do banco a cada chamada para refletir mudanças sem reiniciar.
 */

import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";

function getWebhookCfg() {
  const rows = db.query<{ key: string; value: string }, []>(
    `SELECT key, value FROM config WHERE key IN ('webhook_enabled','webhook_url','webhook_type')`
  ).all();
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: m.webhook_enabled === "true",
    url: m.webhook_url?.trim() || "",
    type: (m.webhook_type || "discord") as "discord" | "gotify" | "generic",
  };
}

function discordPayload(title: string, description: string, color: number) {
  return JSON.stringify({
    embeds: [{ title, description, color, footer: { text: "AniTrackr" } }],
  });
}

async function dispatch(url: string, type: string, title: string, description: string, color: number) {
  let body: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (type === "discord") {
    body = discordPayload(title, description, color);
  } else if (type === "gotify") {
    body = JSON.stringify({ title, message: description, priority: 5 });
  } else {
    body = JSON.stringify({ title, message: description });
  }

  const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
}

export async function notifyDownloadComplete(animeTitle: string, episode: number, season: number) {
  const cfg = getWebhookCfg();
  if (!cfg.enabled || !cfg.url) return;
  try {
    const title = "✅ Download completo";
    const description = `**${animeTitle}** — S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    await dispatch(cfg.url, cfg.type, title, description, 0xa6e3a1);
  } catch (err) {
    logger.warn("notifications", `webhook failed: ${err}`);
  }
}

export async function notifyDownloadFailed(animeTitle: string, episode: number, season: number, errorCode: string) {
  const cfg = getWebhookCfg();
  if (!cfg.enabled || !cfg.url) return;
  try {
    const title = "❌ Download falhou";
    const description = `**${animeTitle}** — S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}\nErro: \`${errorCode}\``;
    await dispatch(cfg.url, cfg.type, title, description, 0xf38ba8);
  } catch (err) {
    logger.warn("notifications", `webhook failed: ${err}`);
  }
}

export async function testWebhook(url: string, type: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await dispatch(url, type, "🔔 Teste AniTrackr", "Webhook configurado com sucesso!", 0xcba6f7);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
