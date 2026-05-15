/**
 * Circuit breaker simples por provider.
 * Estado: closed (normal) → open (falhas) → half-open (testando recuperação)
 */

type CBState = "closed" | "open" | "half-open";

interface ProviderHealth {
  state: CBState;
  failures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  openedAt: number;
}

const FAILURE_THRESHOLD = 3;
const RECOVERY_TIMEOUT_MS = 60_000;
const health = new Map<string, ProviderHealth>();

function getOrCreate(provider: string): ProviderHealth {
  if (!health.has(provider)) {
    health.set(provider, {
      state: "closed",
      failures: 0,
      lastFailureAt: 0,
      lastSuccessAt: 0,
      openedAt: 0,
    });
  }
  return health.get(provider)!;
}

export function recordSuccess(provider: string) {
  const h = getOrCreate(provider);
  h.failures = 0;
  h.state = "closed";
  h.lastSuccessAt = Date.now();
}

export function recordFailure(provider: string) {
  const h = getOrCreate(provider);
  h.failures += 1;
  h.lastFailureAt = Date.now();
  if (h.failures >= FAILURE_THRESHOLD) {
    h.state = "open";
    h.openedAt = Date.now();
  }
}

export function isAvailable(provider: string): boolean {
  const h = getOrCreate(provider);
  if (h.state === "closed") return true;
  if (h.state === "open") {
    if (Date.now() - h.openedAt >= RECOVERY_TIMEOUT_MS) {
      h.state = "half-open";
      return true; // apenas a primeira transição libera a probe
    }
    return false;
  }
  return false; // half-open: bloqueia até a probe resolver
}

export function getAllHealth(): Record<string, { state: CBState; failures: number; lastFailureAt: string; lastSuccessAt: string }> {
  const out: ReturnType<typeof getAllHealth> = {};
  for (const [provider, h] of health.entries()) {
    out[provider] = {
      state: h.state,
      failures: h.failures,
      lastFailureAt: h.lastFailureAt ? new Date(h.lastFailureAt).toISOString() : "",
      lastSuccessAt: h.lastSuccessAt ? new Date(h.lastSuccessAt).toISOString() : "",
    };
  }
  return out;
}

export function resetProvider(provider: string) {
  health.delete(provider);
}
