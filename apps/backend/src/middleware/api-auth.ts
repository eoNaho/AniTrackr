import { createHash, randomBytes } from "crypto";
import db from "../db/index.ts";

export type ApiKeyContext = {
  keyId: string;
  label: string;
  scopes: string[];
};

export const ALL_SCOPES = [
  "search:read",
  "library:read",
  "downloads:read",
  "queue:write",
  "config:read",
  "admin",
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `atk_${randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, 12);
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, prefix, hash };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type AuthError = { ok: false; error: string; message: string };
type AuthOk = { ok: true; ctx: ApiKeyContext };

function extractRawKey(request: Request): string | null {
  const auth = request.headers.get("Authorization") ?? request.headers.get("X-API-Key") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  return auth.trim() || null;
}

export function resolveApiKey(request: Request): AuthError | AuthOk {
  const rawKey = extractRawKey(request);
  if (!rawKey) {
    return { ok: false, error: "unauthorized", message: "Missing Authorization header or X-API-Key" };
  }

  const hash = hashApiKey(rawKey);
  const row = db.query<
    { id: string; label: string; scopes_json: string; revoked_at: string | null; expires_at: string | null },
    [string]
  >(`SELECT id, label, scopes_json, revoked_at, expires_at FROM api_keys WHERE key_hash = ?`).get(hash);

  if (!row) return { ok: false, error: "unauthorized", message: "Invalid API key" };
  if (row.revoked_at) return { ok: false, error: "api_key_revoked", message: "API key has been revoked" };
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { ok: false, error: "api_key_expired", message: "API key has expired" };
  }

  const scopes: string[] = JSON.parse(row.scopes_json || "[]");
  db.run(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`, [row.id]);

  return { ok: true, ctx: { keyId: row.id, label: row.label, scopes } };
}

export function hasScope(ctx: ApiKeyContext, scope: string): boolean {
  return ctx.scopes.includes("admin") || ctx.scopes.includes(scope);
}

type GuardResult =
  | { err: AuthError; ctx: null; status: number }
  | { err: null; ctx: ApiKeyContext; status: null };

export function authGuard(
  request: Request,
  set: { status: number },
  requiredScope?: string
): GuardResult {
  const result = resolveApiKey(request);

  if (!result.ok) {
    const status = result.error === "insufficient_scope" ? 403 : 401;
    set.status = status;
    return { err: { ok: false, error: result.error, message: result.message }, ctx: null, status };
  }

  if (requiredScope && !hasScope(result.ctx, requiredScope)) {
    set.status = 403;
    return {
      err: { ok: false, error: "insufficient_scope", message: `Required scope: ${requiredScope}` },
      ctx: null,
      status: 403,
    };
  }

  return { err: null, ctx: result.ctx, status: null };
}

export function logAudit(
  apiKeyId: string,
  route: string,
  method: string,
  statusCode: number,
  durationMs: number,
  errorCode?: string
) {
  try {
    db.run(
      `INSERT INTO api_audit_log (id, api_key_id, route, method, status_code, duration_ms, error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomBytes(8).toString("hex"), apiKeyId, route, method, statusCode, Math.round(durationMs), errorCode ?? null]
    );
  } catch {
    // non-fatal
  }
}
