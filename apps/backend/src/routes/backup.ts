import Elysia, { t } from "elysia";
import type { SQLQueryBindings } from "bun:sqlite";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import db, { DATA_ROOT } from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import { testWebhook } from "../services/notifications.ts";

const BACKUP_DIR = join(DATA_ROOT, ".anitrackr", "backups");

// GET /api/backup/export — exporta biblioteca + config como JSON
export const backupRoutes = new Elysia({ prefix: "/backup" })
  .get("/export", () => {
    const animes = db.query<Record<string, unknown>, []>(`SELECT * FROM animes`).all();
    const episodes = db.query<Record<string, unknown>, []>(`SELECT * FROM episodes`).all();
    const config = db.query<{ key: string; value: string }, []>(`SELECT key, value FROM config`).all();
    const animeRules = db.query<Record<string, unknown>, []>(`SELECT * FROM anime_rules`).all();

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      animes,
      episodes,
      config,
      animeRules,
    };

    logger.info("backup", `JSON export: ${animes.length} animes, ${episodes.length} episodes`);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="anitrackr-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  })

  // GET /api/backup/list — lista backups SQLite existentes
  .get("/list", () => {
    try {
      const files = readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith("tracker-") && f.endsWith(".db"))
        .map((f) => {
          const stat = statSync(join(BACKUP_DIR, f));
          return { name: f, sizeKb: Math.round(stat.size / 1024), mtime: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime));
      return { backups: files };
    } catch {
      return { backups: [] };
    }
  })

  // POST /api/backup/restore — importa JSON e sobrescreve biblioteca
  .post("/restore", ({ body }) => {
    const data = body as {
      version?: number;
      animes?: Record<string, unknown>[];
      episodes?: Record<string, unknown>[];
      config?: { key: string; value: string }[];
      animeRules?: Record<string, unknown>[];
    };

    if (!data.animes || !Array.isArray(data.animes)) {
      return new Response(JSON.stringify({ error: "JSON inválido: campo 'animes' ausente" }), { status: 400 });
    }

    const toSqlBinding = (v: unknown): SQLQueryBindings =>
      v === null || v === undefined ? null :
      typeof v === "object" ? JSON.stringify(v) : v as SQLQueryBindings;

    // Restauração em transação para atomicidade
    db.transaction(() => {
      if (data.animes?.length) {
        db.run(`DELETE FROM animes`);
        const cols = Object.keys(data.animes[0]!);
        const placeholders = cols.map(() => "?").join(", ");
        const stmt = db.prepare(`INSERT OR IGNORE INTO animes (${cols.join(", ")}) VALUES (${placeholders})`);
        for (const row of data.animes) {
          stmt.run(...cols.map((c) => toSqlBinding(row[c])));
        }
      }

      if (data.episodes?.length) {
        db.run(`DELETE FROM episodes`);
        const cols = Object.keys(data.episodes[0]!);
        const placeholders = cols.map(() => "?").join(", ");
        const stmt = db.prepare(`INSERT OR IGNORE INTO episodes (${cols.join(", ")}) VALUES (${placeholders})`);
        for (const row of data.episodes) {
          stmt.run(...cols.map((c) => toSqlBinding(row[c])));
        }
      }

      if (data.config?.length) {
        const stmt = db.prepare(
          `INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        );
        for (const row of data.config) {
          stmt.run(row.key, row.value);
        }
      }

      if (data.animeRules?.length) {
        db.run(`DELETE FROM anime_rules`);
        const cols = Object.keys(data.animeRules[0]!);
        const placeholders = cols.map(() => "?").join(", ");
        const stmt = db.prepare(`INSERT OR IGNORE INTO anime_rules (${cols.join(", ")}) VALUES (${placeholders})`);
        for (const row of data.animeRules) {
          stmt.run(...cols.map((c) => toSqlBinding(row[c])));
        }
      }
    })();

    logger.info("backup", `restore: ${data.animes?.length ?? 0} animes, ${data.episodes?.length ?? 0} episodes`);
    return {
      ok: true,
      restored: {
        animes: data.animes?.length ?? 0,
        episodes: data.episodes?.length ?? 0,
        config: data.config?.length ?? 0,
        animeRules: data.animeRules?.length ?? 0,
      },
    };
  }, {
    body: t.Unknown(),
  })

  // POST /api/backup/test-webhook — testa webhook sem salvar
  .post("/test-webhook", async ({ body }) => {
    const { url, type } = body;
    const result = await testWebhook(url, type ?? "discord");
    return result;
  }, {
    body: t.Object({
      url: t.String(),
      type: t.Optional(t.String()),
    }),
  });
