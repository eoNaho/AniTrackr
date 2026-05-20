import Elysia, { t } from "elysia";
import { randomUUID } from "crypto";
import db from "../db/index.ts";
import { generateApiKey, ALL_SCOPES } from "../middleware/api-auth.ts";
import { logger } from "../utils/logger.ts";

type KeyRow = {
  id: string;
  label: string;
  key_prefix: string;
  scopes_json: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

function rowToPublic(r: KeyRow) {
  const now = new Date();
  const isExpired = !!r.expires_at && new Date(r.expires_at) < now;
  const status = r.revoked_at ? "revoked" : isExpired ? "expired" : "active";
  return {
    id: r.id,
    label: r.label,
    prefix: r.key_prefix,
    scopes: JSON.parse(r.scopes_json || "[]") as string[],
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
    status,
  };
}

export const apiKeyRoutes = new Elysia({ prefix: "/api-keys" })

  // GET /api/api-keys
  .get("/", () => {
    const rows = db.query<KeyRow, []>(
      `SELECT id, label, key_prefix, scopes_json, created_at, last_used_at, expires_at, revoked_at
       FROM api_keys ORDER BY created_at DESC`
    ).all();
    return { keys: rows.map(rowToPublic), availableScopes: [...ALL_SCOPES] };
  })

  // POST /api/api-keys — gera uma chave nova (retorna a chave bruta apenas aqui)
  .post("/", ({ body }) => {
    const { label, scopes, expiresAt } = body;
    const validScopes = scopes?.filter((s) => (ALL_SCOPES as readonly string[]).includes(s) || s === "admin") ?? ["search:read"];

    const { raw, prefix, hash } = generateApiKey();
    const id = randomUUID();

    db.run(
      `INSERT INTO api_keys (id, label, key_prefix, key_hash, scopes_json, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, label.trim(), prefix, hash, JSON.stringify(validScopes), expiresAt ?? null]
    );

    logger.info("api-keys", `created key "${label.trim()}" id=${id} scopes=[${validScopes.join(",")}]`);

    return {
      ok: true,
      id,
      label: label.trim(),
      prefix,
      key: raw,
      scopes: validScopes,
      createdAt: new Date().toISOString(),
      warning: "Guarde esta chave agora. Ela não poderá ser recuperada novamente.",
    };
  }, {
    body: t.Object({
      label: t.String({ minLength: 1, maxLength: 80 }),
      scopes: t.Optional(t.Array(t.String())),
      expiresAt: t.Optional(t.String()),
    }),
  })

  // DELETE /api/api-keys/:id — revogar chave
  .delete("/:id", ({ params, set }) => {
    const row = db.query<{ id: string; revoked_at: string | null }, [string]>(
      `SELECT id, revoked_at FROM api_keys WHERE id = ?`
    ).get(params.id);

    if (!row) {
      set.status = 404;
      return { ok: false, error: "not_found", message: "API key not found" };
    }
    if (row.revoked_at) {
      return { ok: true, message: "Already revoked" };
    }

    db.run(`UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?`, [params.id]);
    logger.info("api-keys", `revoked key id=${params.id}`);
    return { ok: true, message: "Key revoked successfully" };
  }, {
    params: t.Object({ id: t.String() }),
  })

  // GET /api/api-keys/:id/audit — últimas 50 chamadas
  .get("/:id/audit", ({ params, set }) => {
    const key = db.query<{ id: string }, [string]>(`SELECT id FROM api_keys WHERE id = ?`).get(params.id);
    if (!key) {
      set.status = 404;
      return { ok: false, error: "not_found", message: "API key not found" };
    }
    const logs = db.query<{
      route: string; method: string; status_code: number;
      duration_ms: number; created_at: string; error_code: string | null;
    }, [string]>(
      `SELECT route, method, status_code, duration_ms, created_at, error_code
       FROM api_audit_log WHERE api_key_id = ? ORDER BY created_at DESC LIMIT 50`
    ).all(params.id);
    return { ok: true, keyId: params.id, logs };
  }, {
    params: t.Object({ id: t.String() }),
  });
