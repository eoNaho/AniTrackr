import Elysia, { t } from "elysia";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";

type ConfigRow = { key: string; value: string };

export const configRoutes = new Elysia({ prefix: "/config" })
  // GET /api/config
  .get("/", () => {
    const rows = db.query<ConfigRow, []>(`SELECT key, value FROM config`).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  })

  // GET /api/config/:key
  .get(
    "/:key",
    ({ params }) => {
      const row = db
        .query<ConfigRow, [string]>(`SELECT key, value FROM config WHERE key = ?`)
        .get(params.key);
      if (!row) return { error: `Chave "${params.key}" não encontrada` };
      return { key: row.key, value: row.value };
    },
    { params: t.Object({ key: t.String() }) }
  )

  // POST /api/config  — salva/atualiza múltiplos valores
  .post(
    "/",
    ({ body }) => {
      const allowed = [
        "download_path", "quality", "provider",
        "max_concurrent", "language", "naming_scheme",
        "yt_dlp_path", "ffmpeg_path", "prefer_sub",
        "allow_simulated_downloads",
        "auto_retry_enabled", "retry_max_attempts",
        "retry_base_delay_seconds", "retry_max_delay_seconds",
      ];
      const upsert = db.prepare(
        `INSERT INTO config (key, value) VALUES ($key, $value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      );
      const updated: string[] = [];
      for (const [key, value] of Object.entries(body as Record<string, string>)) {
        if (!allowed.includes(key)) continue;
        upsert.run({ $key: key, $value: String(value) });
        updated.push(key);
      }
      logger.info("config", `updated keys: ${updated.join(", ")}`);
      return { ok: true, updated };
    },
    { body: t.Record(t.String(), t.String()) }
  )

  // PUT /api/config/:key
  .put(
    "/:key",
    ({ params, body }) => {
      db.run(
        `INSERT INTO config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [params.key, body.value]
      );
      logger.info("config", `set ${params.key}=${body.value}`);
      return { ok: true, key: params.key, value: body.value };
    },
    {
      params: t.Object({ key: t.String() }),
      body: t.Object({ value: t.String() }),
    }
  );
