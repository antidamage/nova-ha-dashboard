import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The last successful BUILD_ID read. Survives transient read failures — the
// self-update symlink repoint briefly unlinks .next, and a contended disk can
// fail or truncate the read. Returning a different value on those blips made
// the build poll flap (real -> fallback -> real), which used to mass-reload
// every connected dashboard twice per blip.
const globalWithBuildId = globalThis as typeof globalThis & {
  __novaDashboardBuildId?: { value: string | null };
};
const cache = globalWithBuildId.__novaDashboardBuildId ??
  (globalWithBuildId.__novaDashboardBuildId = { value: null });

/**
 * The dashboard's build id, or null when it has never been readable this
 * process. Never invents a placeholder: consumers (SSE build events,
 * /api/version, client reload checks) all treat null/empty as "unknown, do
 * nothing" rather than as a new version.
 */
export async function readDashboardBuildId(): Promise<string | null> {
  try {
    const value = (await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
    if (value.length > 0) {
      cache.value = value;
    }
  } catch {
    // Keep the cached id (or null before the first successful read).
  }
  return cache.value ?? process.env.NOVA_DASHBOARD_BUILD_ID ?? null;
}
