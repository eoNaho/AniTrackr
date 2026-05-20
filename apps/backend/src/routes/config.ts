import Elysia, { t } from "elysia";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";

type ConfigRow = { key: string; value: string };

const SENSITIVE_KEYS = new Set(["qbittorrent_password", "opensubtitles_password", "jellyfin_api_key"]);
const MASK = "***";

const ALLOWED_KEYS = new Set([
  "download_path", "media_path", "quality", "provider",
  "max_concurrent", "language", "naming_scheme",
  "yt_dlp_path", "ffmpeg_path", "prefer_sub",
  "allow_simulated_downloads",
  "auto_retry_enabled", "retry_max_attempts",
  "retry_base_delay_seconds", "retry_max_delay_seconds",
  // qBittorrent
  "qbittorrent_enabled", "qbittorrent_host",
  "qbittorrent_username", "qbittorrent_password", "qbittorrent_save_path",
  // Nyaa
  "nyaa_preferred_group", "nyaa_preferred_resolution", "nyaa_default_category",
  // OpenSubtitles
  "opensubtitles_api_key", "opensubtitles_username", "opensubtitles_password",
  // Auto-legenda pós-download
  "auto_subtitle_enabled",
  // Webhook notifications
  "webhook_enabled", "webhook_url", "webhook_type",
  // Alertas de disco
  "disk_alert_threshold_gb",
  // Jellyfin connector
  "jellyfin_enabled", "jellyfin_base_url", "jellyfin_api_key",
  "jellyfin_library_id", "jellyfin_auto_refresh", "jellyfin_refresh_mode",
  "jellyfin_request_timeout_ms",
]);

function maskValue(key: string, value: string): string {
  return SENSITIVE_KEYS.has(key) ? MASK : value;
}

export const configRoutes = new Elysia({ prefix: "/config" })
  // GET /api/config — retorna todas as chaves com campos sensíveis mascarados
  .get("/", () => {
    const rows = db.query<ConfigRow, []>(`SELECT key, value FROM config`).all();
    return Object.fromEntries(rows.map((r) => [r.key, maskValue(r.key, r.value)]));
  })

  // GET /api/config/:key
  .get(
    "/:key",
    ({ params }) => {
      const row = db
        .query<ConfigRow, [string]>(`SELECT key, value FROM config WHERE key = ?`)
        .get(params.key);
      if (!row) return { error: `Chave "${params.key}" não encontrada` };
      return { key: row.key, value: maskValue(row.key, row.value) };
    },
    { params: t.Object({ key: t.String() }) }
  )

  // POST /api/config — salva/atualiza múltiplos valores
  .post(
    "/",
    ({ body }) => {
      const upsert = db.prepare(
        `INSERT INTO config (key, value) VALUES ($key, $value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      );
      const updated: string[] = [];
      const skipped: string[] = [];

      for (const [key, value] of Object.entries(body as Record<string, string>)) {
        if (!ALLOWED_KEYS.has(key)) continue;

        // Não sobrescrever senha mascarada
        if (SENSITIVE_KEYS.has(key) && value === MASK) continue;

        // Validar URLs http/https
        if (key === "jellyfin_base_url" && value) {
          try {
            const u = new URL(value);
            if (!["http:", "https:"].includes(u.protocol)) { skipped.push(key); continue; }
          } catch { skipped.push(key); continue; }
        }

        if (key === "qbittorrent_host") {
          try {
            const u = new URL(value);
            if (!["http:", "https:"].includes(u.protocol)) {
              skipped.push(key);
              continue;
            }
          } catch {
            skipped.push(key);
            continue;
          }
        }

        upsert.run({ $key: key, $value: String(value) });
        updated.push(key);
      }

      if (updated.length) logger.info("config", `updated: ${updated.join(", ")}`);
      if (skipped.length) logger.warn("config", `skipped invalid: ${skipped.join(", ")}`);
      return { ok: true, updated, skipped };
    },
    { body: t.Record(t.String(), t.String()) }
  )

  // PUT /api/config/:key
  .put(
    "/:key",
    ({ params, body }) => {
      if (!ALLOWED_KEYS.has(params.key))
        return new Response(JSON.stringify({ error: "Chave não permitida" }), { status: 400 });

      if (SENSITIVE_KEYS.has(params.key) && body.value === MASK)
        return { ok: true, key: params.key, skipped: true };

      for (const urlKey of ["qbittorrent_host", "jellyfin_base_url"]) {
        if (params.key === urlKey && body.value) {
          try {
            const u = new URL(body.value);
            if (!["http:", "https:"].includes(u.protocol))
              return new Response(JSON.stringify({ error: "URL deve usar http ou https" }), { status: 422 });
          } catch {
            return new Response(JSON.stringify({ error: "URL inválida" }), { status: 422 });
          }
        }
      }

      db.run(
        `INSERT INTO config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [params.key, body.value]
      );
      logger.info("config", `set ${params.key}=${SENSITIVE_KEYS.has(params.key) ? MASK : body.value}`);
      return { ok: true, key: params.key, value: maskValue(params.key, body.value) };
    },
    {
      params: t.Object({ key: t.String() }),
      body: t.Object({ value: t.String() }),
    }
  );
