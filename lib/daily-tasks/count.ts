// The unfinished count from a separate daily tasks site (specs/tasks-panel.md,
// "Daily tasks count"). The site's address is configuration; empty means the
// installation has none and the reminder bar shows no tile.

export const DAILY_TASKS_TIMEOUT_MS = 3_000;

export type DailyTasksCount = {
  configured: boolean;
  /** Null when the site could not be read. */
  unfinished: number | null;
  url: string | null;
};

/** An http(s) URL ending in "/", or "" for anything else. */
export function normalizeDailyTasksUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export async function readDailyTasksCount(
  rawUrl: unknown,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DAILY_TASKS_TIMEOUT_MS,
): Promise<DailyTasksCount> {
  const url = normalizeDailyTasksUrl(rawUrl);
  if (!url) return { configured: false, unfinished: null, url: null };
  try {
    const response = await fetchImpl(new URL("api/count", url), {
      cache: "no-store",
      // Never follow a redirect: the configured address is the only host read.
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { configured: true, unfinished: null, url };
    const body = (await response.json()) as { unfinished?: unknown };
    const unfinished = body?.unfinished;
    return {
      configured: true,
      unfinished: typeof unfinished === "number" && Number.isInteger(unfinished) && unfinished >= 0 ? unfinished : null,
      url,
    };
  } catch {
    return { configured: true, unfinished: null, url };
  }
}
