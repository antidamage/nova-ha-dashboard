import { readDashboardConfig } from "../../dashboard-config";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../preferences";
import { themeResponseValue } from "../../theme-values";
import type { VolumeArrivalPreset } from "../../config-schema/arrivals";
import type { ArrivalPreset, ArrivalTarget } from "../types";

/**
 * "The volume control" is the dashboard's own sound volume — the Volume slider
 * under Appearance & Dashboard → Theme & Experience → Sound (owner,
 * 2026-09-26). It is `theme.controlSound.volume` on the shared theme, and the
 * theme keeps one copy per variant, so a preset writes BOTH: a volume that
 * applied only in dark mode would be a state the arrival silently failed to set.
 *
 * Written through mergeDashboardPreferences exactly as POST /api/theme writes
 * it; an open dashboard picks it up on its 30s shared-theme poll
 * (app/components/theme/accent/useDeviceTheme.ts).
 */

const MIN_VOLUME_PCT = 0;
const MAX_VOLUME_PCT = 100;

/** The same 0-100 the slider offers; a stored value outside it is clamped. */
export function clampVolumePct(value: number): number {
  if (!Number.isFinite(value)) return MIN_VOLUME_PCT;
  return Math.max(MIN_VOLUME_PCT, Math.min(MAX_VOLUME_PCT, Math.round(value)));
}

export async function setDashboardSoundVolume(volumePct: number) {
  const config = await readDashboardConfig();
  const preferences = await readDashboardPreferences();
  const stored = themeResponseValue(preferences.theme, config.dashboard.avatar) as
    | { themes?: Record<string, unknown>; [key: string]: unknown }
    | null;

  const volume = clampVolumePct(volumePct);
  const themes = (stored?.themes ?? {}) as Record<string, unknown>;
  const withVolume = (variant: unknown) => {
    const record = variant && typeof variant === "object" ? (variant as Record<string, unknown>) : {};
    const controlSound =
      record.controlSound && typeof record.controlSound === "object"
        ? (record.controlSound as Record<string, unknown>)
        : {};
    return { ...record, controlSound: { ...controlSound, volume } };
  };

  await mergeDashboardPreferences({
    theme: {
      ...(stored ?? {}),
      themes: { ...themes, dark: withVolume(themes.dark), light: withVolume(themes.light) },
    },
    themeUpdatedAt: new Date().toISOString(),
  });
}

export async function volumeArrivalPresets(): Promise<VolumeArrivalPreset[]> {
  return (await readDashboardConfig()).dashboard.arrivals.volumePresets;
}

export const volumeArrivalTarget: ArrivalTarget = {
  kind: "volume",
  label: "Volume",

  async presets(): Promise<ArrivalPreset[]> {
    return (await volumeArrivalPresets()).map((preset) => ({ id: preset.id, label: preset.label }));
  },

  async apply(presetId: string) {
    const preset = (await volumeArrivalPresets()).find((candidate) => candidate.id === presetId);
    if (!preset) throw new Error(`Unknown volume preset: ${presetId}`);
    await setDashboardSoundVolume(preset.volumePct);
  },
};
