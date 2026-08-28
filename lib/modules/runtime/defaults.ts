import { readDashboardConfig } from "../../dashboard-config";
import { installModulePackage, listInstalledIds, patchInstalledRecord } from "./store";
import { INSTALL_LIMITS } from "./store";

/**
 * Default modules (`specs/module-system.md` §9).
 *
 * The dashboard installs its own default modules when they are missing, so a
 * fresh install arrives complete. Everything here is best-effort: a network
 * failure is recorded and retried on the next boot, and never delays or blocks
 * the dashboard becoming ready.
 */
export async function installMissingDefaultModules(): Promise<void> {
  const config = await readDashboardConfig();
  const modules = config.dashboard.modules;
  if (!modules.enabled || !modules.defaults.length) {
    return;
  }

  const installed = new Set(await listInstalledIds());
  for (const entry of modules.defaults) {
    if (installed.has(entry.id)) {
      continue;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), modules.installTimeoutMs);
      let bytes: Uint8Array;
      try {
        const response = await fetch(entry.packageUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > INSTALL_LIMITS.compressedBytes) {
          throw new Error("package is too large");
        }
        bytes = new Uint8Array(buffer);
      } finally {
        clearTimeout(timer);
      }

      const result = await installModulePackage(bytes, entry.packageUrl);
      if (result.id !== entry.id) {
        throw new Error(`package declares id "${result.id}", expected "${entry.id}"`);
      }
      await patchInstalledRecord(entry.id, { enabled: entry.enabled });
      console.log(`[nova-modules] installed default module ${entry.id}@${result.version}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[nova-modules] could not install default module ${entry.id}: ${message}`);
    }
  }
}
