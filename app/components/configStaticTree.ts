// Canonical list of the config page's STATIC accordion paths — the ids that
// exist at build time regardless of loaded data. Phonoscope's dynamic,
// data-dependent leaves (per colour-theme/group/lane/effect ids) are
// deliberately excluded; they resolve on demand via the pending-breadcrumb
// queue (see configBreadcrumb.ts) and, on the static export, via the
// out/404.html SPA-fallback (see scripts/build-demo.mjs).
//
// This is the single source of truth for generateStaticParams
// (app/config/[[...slug]]/page.tsx) — do not hand-duplicate this list
// elsewhere. `Record<ConfigCategoryId, ...>` means adding a new
// ConfigCategoryId in ConfigWorkspace.tsx without updating this file is a
// type error, so the two can't silently drift apart.
//
// Mirrors specs/config-breadcrumb-navigation.md's "Current tree inventory".

import type { ConfigCategoryId } from "./ConfigWorkspace";

/** One static accordion chain beneath a category, top-level id first. */
type StaticAccordionPath = string[];

export const STATIC_ACCORDION_PATHS: Record<ConfigCategoryId, StaticAccordionPath[]> = {
  assistant: [["identity"], ["agent"], ["authority"]],
  "voice-people": [
    ["voice-infrastructure"],
    ["voice"],
    ["voice-training"],
    ["user-data"],
    ["user-data", "face-enrolment"],
    ["user-data", "kiosk-activity"],
  ],
  "appearance-dashboard": [
    ["appearance"],
    ["appearance", "theme-settings"],
    ["appearance", "theme-settings", "theme-colours"],
    ["appearance", "theme-settings", "fonts"],
    ["appearance", "theme-settings", "status-orb"],
    ["appearance", "theme-settings", "background"],
    ["appearance", "theme-settings", "map"],
    ["appearance", "theme-settings", "theme-reminders"],
    ["appearance", "theme-settings", "sound"],
    ["reminders"],
    ["status-orb-info"],
    ["climate"],
    ["appletv-swipe"],
    ["phonoscope"],
    ["phonoscope", "phonoscope-house-party"],
    ["phonoscope", "phonoscope-color-groups"],
    ["phonoscope", "phonoscope-color-themes"],
    ["phonoscope", "phonoscope-settings-groups"],
  ],
  devices: [["managed-computers"], ["hardware-assistant"], ["camera"]],
  modules: [["modules"]],
  "system-data": [["history"], ["secrets"], ["config-transfer"], ["updates"], ["system"]],
};

/**
 * Every static `/config/...` path as a `slug` array, root (`[]`) included,
 * for `generateStaticParams`. Harmless to compute for a non-export build too
 * — Next renders anything not returned here on demand when `dynamicParams`
 * is left at its default `true`.
 */
export function configStaticSlugParams(): Array<{ slug: string[] }> {
  const params: Array<{ slug: string[] }> = [{ slug: [] }];
  for (const category of Object.keys(STATIC_ACCORDION_PATHS) as ConfigCategoryId[]) {
    params.push({ slug: [category] });
    for (const path of STATIC_ACCORDION_PATHS[category]) {
      params.push({ slug: [category, ...path] });
    }
  }
  return params;
}
