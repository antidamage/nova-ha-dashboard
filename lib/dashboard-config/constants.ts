import path from "path";

/**
 * Every path the config loader reads or writes.
 *
 * The env-derived ones are resolved once, at module load, which is why
 * `lib/household-config-layer.test.ts` stubs the environment and then imports
 * the facade fresh: `vi.resetModules()` re-evaluates this whole graph, so the
 * stub is read again rather than the value from the first import.
 */
export const CONFIG_DIR = path.join(process.cwd(), "config");
export const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, "dashboard-config.default.json");
export const COMMON_CONFIG_PATH = path.join(CONFIG_DIR, "common.json");
export const COMMON_LOCAL_CONFIG_PATH = path.join(CONFIG_DIR, "common.local.json");
export const TASKS_CONFIG_PATH = path.join(CONFIG_DIR, "tasks.json");
export const RUNTIME_CONFIG_PATH =
  process.env.NOVA_DASHBOARD_CONFIG ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "dashboard-config.json");

/**
 * Optional overlay describing the one household this deployment serves — its
 * devices, rooms, rates. It ships separately from the dashboard (see the
 * nova-household package) so the product stays generic, and an unset variable
 * or a missing file is a supported state, not an error.
 *
 * Deliberately NOT part of `readDefaultDashboardConfig`: that is what demo mode
 * and the config page's "defaults" view read, and both must stay household-free.
 */
export const HOUSEHOLD_CONFIG_PATH = process.env.NOVA_DASHBOARD_HOUSEHOLD_CONFIG?.trim() || null;
