export const HA_URL = process.env.HA_URL ?? "http://127.0.0.1:8123";
export const HA_TOKEN = process.env.HA_TOKEN;

function authHeaders() {
  if (!HA_TOKEN) {
    throw new Error("HA_TOKEN is not configured");
  }

  return {
    Authorization: `Bearer ${HA_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// A *hung* Home Assistant (accepts the socket but never answers) must fail fast,
// not stall the 5s state poller forever. Without this, one hung /api/states
// wedges `store.polling` and every /api/state request hangs with it. On timeout
// the poller throws and keeps the last snapshot; the mass-outage held-state path
// (lib/ha/health.ts) covers the "everything unavailable" case separately.
const HA_REST_TIMEOUT_MS = Number(process.env.HA_REST_TIMEOUT_MS ?? 8000);

export async function haRest<T>(path: string, init?: RequestInit): Promise<T> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), HA_REST_TIMEOUT_MS);
  // Compose the timeout with any caller-supplied signal so either can cancel.
  const callerSignal = init?.signal ?? undefined;
  const onCallerAbort = () => timeoutController.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      timeoutController.abort();
    } else {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }

  try {
    const response = await fetch(`${HA_URL}${path}`, {
      ...init,
      headers: {
        ...authHeaders(),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Home Assistant ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (timeoutController.signal.aborted && !callerSignal?.aborted) {
      throw new Error(`Home Assistant request timed out after ${HA_REST_TIMEOUT_MS}ms: ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
