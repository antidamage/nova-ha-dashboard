/**
 * Dashboard preferences — facade. The body lives in lib/preferences/; this file
 * keeps the import path stable for its callers (specs/agent-token-footprint.md
 * §3.3).
 *
 *   preferences/store.ts   SOLE owner of the preference file and write queue:
 *                          read, the per-section merge, whole-document replace
 */
export {
  mergeDashboardPreferences,
  readDashboardPreferences,
  replaceDashboardPreferences,
} from "./preferences/store";
