/**
 * Publishing the last visit to the dashboard, with the preferences-file
 * fallback.
 *
 * Moved verbatim from `scripts/gymmaster-attendance-scrape.mjs`, which stays
 * the entry point (`node /app/scripts/gymmaster-attendance-scrape.mjs`).
 */

import { readJson, writeJson } from "./store.mjs";

async function updatePreferenceFile(preferencesPath, lastVisitAt) {
  const current = await readJson(preferencesPath, {});
  const merged = {
    ...current,
    watchface: {
      ...(current.watchface ?? {}),
      gymLastResetAt: lastVisitAt,
      updatedAt: new Date().toISOString(),
    },
  };
  await writeJson(preferencesPath, merged);
  return { method: "preferences-file", preferencesPath };
}

// A bare 200 is not proof the dashboard saw the write: 127.0.0.1:80 is a Caddy
// catch-all that answers 200 with an empty body to any path, which silently
// froze the gym tile for eleven days. Require the route to echo the value back.
export async function assertWatchfaceEcho(response, lastVisitAt) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("dashboard returned a non-JSON body; the request did not reach /api/watchface");
  }
  const echoed = payload?.watchface?.gymLastResetAt ?? null;
  if (echoed !== lastVisitAt) {
    throw new Error(`dashboard echoed gymLastResetAt=${JSON.stringify(echoed)}, expected ${JSON.stringify(lastVisitAt)}`);
  }
}

export async function updateDashboardWatchface(lastVisitAt, { dashboardUrl, preferencesPath }) {
  let apiError = null;
  if (dashboardUrl && dashboardUrl.toLowerCase() !== "none") {
    try {
      const response = await fetch(new URL("/api/watchface", dashboardUrl), {
        body: JSON.stringify({ gymLastResetAt: lastVisitAt }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      await assertWatchfaceEcho(response, lastVisitAt);
      return { method: "dashboard-api", url: new URL("/api/watchface", dashboardUrl).toString() };
    } catch (error) {
      apiError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ...(await updatePreferenceFile(preferencesPath, lastVisitAt)),
    apiError,
  };
}
