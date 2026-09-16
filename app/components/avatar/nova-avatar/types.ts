"use client";

import type { SunThemeStatus, ThemeStorageValue } from "../../accentColor";
import type { NovaAvatarTheme } from "../theme-model/types";
import type { OrbInfoDisplay } from "../../../../lib/orb-info/types";

export type LoadResponse = {
  cpu: number;
  net: number;
  gpu: number;
  listening: boolean;
  load: number;
};

export type NovaAvatarProps = {
  size?: number;
  forceVisible?: boolean;
  forceGymAlert?: boolean;
  className?: string;
  scrollScaleDistance?: number;
  scrollScaleMin?: number;
  themeOverride?: NovaAvatarTheme;
  // Server-rendered theme so the canvas paints the saved colours on its very
  // first frame. The orb is a canvas driven purely by React state, so unlike
  // the rest of the UI it cannot be seeded by the synchronous head-bootstrap
  // (which only sets CSS variables). Without this it falls back to the
  // compiled-in default theme until the async /api/theme fetch lands — the
  // "wrong colour on first load" flash. Null in demo mode / when unset.
  initialTheme?: ThemeStorageValue | null;
  // Server-known sun status so an "auto" theme selection resolves the correct
  // dark/light variant on the first render (SSR included) instead of the
  // hour-of-day guess. Null when the server has no state snapshot yet.
  initialSun?: SunThemeStatus | null;
  // Status orb info module overrides. The config preview drives both directly
  // so it renders the setting being edited rather than the saved one.
  orbInfoModuleId?: string;
  orbInfoDisplay?: OrbInfoDisplay;
};
