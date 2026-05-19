import Elysia, { t } from "elysia";
import db, { type QueueProfileRow } from "../db/index.ts";
import { logger } from "../utils/logger.ts";

const profileBody = t.Object({
  label:              t.String(),
  max_concurrent:     t.Optional(t.Number()),
  speed_limit_kbps:   t.Optional(t.Number()),
  window_start:       t.Optional(t.Nullable(t.String())),
  window_end:         t.Optional(t.Nullable(t.String())),
  preferred_type:     t.Optional(t.String()),
  retry_max:          t.Optional(t.Number()),
  retry_base_delay_s: t.Optional(t.Number()),
});

const DEFAULT_IDS = new Set(["home", "server", "night"]);

export const queueProfileRoutes = new Elysia({ prefix: "/queue-profiles" })

  .get("/", () =>
    db.query<QueueProfileRow, []>(`SELECT * FROM queue_profiles ORDER BY label`).all()
  )

  .get("/active", () =>
    db.query<QueueProfileRow, []>(`SELECT * FROM queue_profiles WHERE is_active = 1 LIMIT 1`).get() ?? null
  )

  .post("/:id/activate", ({ params }) => {
    const exists = db.query<{ id: string }, [string]>(`SELECT id FROM queue_profiles WHERE id = ?`).get(params.id);
    if (!exists) return new Response(JSON.stringify({ error: "Perfil não encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
    db.run(`UPDATE queue_profiles SET is_active = 0, updated_at = datetime('now')`);
    db.run(`UPDATE queue_profiles SET is_active = 1, updated_at = datetime('now') WHERE id = ?`, [params.id]);
    logger.info("queue-profiles", `perfil ativado: ${params.id}`);
    return { ok: true, activeId: params.id };
  }, { params: t.Object({ id: t.String() }) })

  .post("/", ({ body }) => {
    const slug = body.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
    const id = `${slug}-${Date.now().toString(36)}`;
    db.run(`
      INSERT INTO queue_profiles (id,name,label,max_concurrent,speed_limit_kbps,window_start,window_end,preferred_type,retry_max,retry_base_delay_s,is_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,0)
    `, [
      id, id, body.label,
      body.max_concurrent     ?? 3,
      body.speed_limit_kbps   ?? 0,
      body.window_start        ?? null,
      body.window_end          ?? null,
      body.preferred_type      ?? "ytdlp",
      body.retry_max           ?? 3,
      body.retry_base_delay_s  ?? 20,
    ]);
    logger.info("queue-profiles", `perfil criado: ${id} (${body.label})`);
    return { ok: true, id };
  }, { body: profileBody })

  .put("/:id", ({ params, body }) => {
    const exists = db.query<{ id: string }, [string]>(`SELECT id FROM queue_profiles WHERE id = ?`).get(params.id);
    if (!exists) return new Response(JSON.stringify({ error: "Perfil não encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
    db.run(`
      UPDATE queue_profiles SET
        label = ?, max_concurrent = ?, speed_limit_kbps = ?,
        window_start = ?, window_end = ?, preferred_type = ?,
        retry_max = ?, retry_base_delay_s = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [
      body.label,
      body.max_concurrent     ?? 3,
      body.speed_limit_kbps   ?? 0,
      body.window_start        ?? null,
      body.window_end          ?? null,
      body.preferred_type      ?? "ytdlp",
      body.retry_max           ?? 3,
      body.retry_base_delay_s  ?? 20,
      params.id,
    ]);
    logger.info("queue-profiles", `perfil atualizado: ${params.id}`);
    return { ok: true };
  }, {
    params: t.Object({ id: t.String() }),
    body: profileBody,
  })

  .delete("/:id", ({ params }) => {
    const profile = db.query<{ is_active: number }, [string]>(`SELECT is_active FROM queue_profiles WHERE id = ?`).get(params.id);
    if (!profile) return new Response(JSON.stringify({ error: "Perfil não encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
    if (profile.is_active) return new Response(JSON.stringify({ error: "Não é possível remover o perfil ativo" }), { status: 400, headers: { "Content-Type": "application/json" } });
    if (DEFAULT_IDS.has(params.id)) return new Response(JSON.stringify({ error: "Perfis padrão não podem ser removidos" }), { status: 400, headers: { "Content-Type": "application/json" } });
    db.run(`DELETE FROM queue_profiles WHERE id = ?`, [params.id]);
    logger.info("queue-profiles", `perfil removido: ${params.id}`);
    return { ok: true };
  }, { params: t.Object({ id: t.String() }) });
