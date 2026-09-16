/**
 * The visualiser rotation Nova publishes as authoritative — facade. The body
 * lives in lib/phonoscope-theme-state/; this file keeps the import path stable
 * for its callers (specs/agent-token-footprint.md §3.3).
 *
 *   phonoscope-theme-state/types.ts             published state, transition, store shapes
 *   phonoscope-theme-state/store.ts             SOLE owner of the globalThis rotation store
 *   phonoscope-theme-state/transition-model.ts  latched transitions and their axes
 *   phonoscope-theme-state/selection.ts         live colour group, public state, next index
 *   phonoscope-theme-state/rotation.ts          pulse rules, select, solo, alt pulse
 *   phonoscope-theme-state/commands.ts          readPhonoscopeThemeState, commandPhonoscopeTheme
 */
export type { PhonoscopeThemeState, PhonoscopeTransition } from "./phonoscope-theme-state/types";
export { activePhonoscopeColorGroup } from "./phonoscope-theme-state/selection";
export { commandPhonoscopeTheme, readPhonoscopeThemeState } from "./phonoscope-theme-state/commands";
export { resetPhonoscopeThemeStateForTest } from "./phonoscope-theme-state/store";
