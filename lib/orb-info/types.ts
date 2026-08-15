/**
 * Status orb info modules — the contract.
 *
 * A "status orb info module" is a named provider of ONE scalar reading, plus a
 * declarative description of how that reading should be rendered inside the
 * orb. The orb itself knows nothing about gyms, CPUs or thermometers: it asks
 * the selected module for its output and hands that to `formatOrbValue`.
 *
 * The split matters for the Apple TV port. Everything in this directory is
 * pure — no React, no fetch, no DOM — so `formatOrbValue` can be ported to
 * Swift and held to the same shared case table (format-cases.json). The
 * browser-only half (polling, hooks) lives in app/components/orb-info/.
 */

/** The unit a module's `value` is expressed in, before any display conversion. */
export type OrbBaseUnit =
  | "hours"
  | "count"
  | "ratio"
  | "percent"
  | "celsius"
  | "watts"
  | "timestamp"
  | "none";

export type OrbInfoFormat =
  | "number"
  | "duration"
  | "percent"
  | "clock"
  | "temperature"
  | "text";

export type OrbDisplayUnit =
  | "native"
  | "auto"
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "celsius"
  | "fahrenheit"
  | "watts"
  | "kilowatts";

export type OrbRounding = "floor" | "round" | "ceil";

/**
 * Where a `percent` format takes its 100% point from. `moduleThreshold` uses
 * the module's own alert threshold (the gym counter's alert hours), which is
 * what "percentage until a threshold has been met" means.
 */
export type OrbPercentBasis =
  | { kind: "moduleThreshold" }
  | { kind: "fixed"; value: number };

export type OrbInfoDisplay = {
  format: OrbInfoFormat;
  unit: OrbDisplayUnit;
  decimals: 0 | 1 | 2 | 3;
  rounding: OrbRounding;
  percentOf: OrbPercentBasis;
  /** Cap a percent at 100 rather than letting it run past the threshold. */
  percentClamp: boolean;
  /** Count DOWN to the threshold (100% → 0%) instead of up from zero. */
  percentInvert: boolean;
  /** Append the canonical unit symbol (h, d, %, °C, W, kW) after the number. */
  showUnit: boolean;
  /** Always show a leading + on positive values (deltas read better signed). */
  signed: boolean;
  /** 12-hour clock with no meridiem suffix; false = 24-hour. */
  clock12Hour: boolean;
  clockSeconds: boolean;
  prefix: string;
  suffix: string;
  /** Rendered when there is no reading at all. Never substitute a bare 0. */
  emptyText: string;
};

/**
 * What a module produces. This IS "module output".
 *
 * `value: null` is a legitimate, expected state — the gym counter before the
 * first scrape lands, a GPU module on a host with no nvidia-smi — and must
 * render `display.emptyText`, never 0. `status` distinguishes "there is
 * genuinely no reading" from "the reading failed".
 */
export type OrbModuleOutput = {
  /** Canonical magnitude in `baseUnit`, or null when there is no reading. */
  value: number | null;
  /** Pre-rendered words for `text`-format modules (HA health, WAN state). */
  text: string | null;
  baseUnit: OrbBaseUnit;
  /** When the underlying reading was taken, ISO. Null when unknown. */
  observedAt: string | null;
  status: "ok" | "stale" | "unavailable" | "error";
  /** Module-evaluated alert condition; drives the orb's alert pulse. */
  alert: boolean;
  /** The module's own alert threshold in `baseUnit`, for percent-of displays. */
  alertThreshold: number | null;
  /** Longer accessible description, appended to the aria label. */
  detail?: string;
};

export const ORB_MODULE_OUTPUT_EMPTY: OrbModuleOutput = {
  value: null,
  text: null,
  baseUnit: "none",
  observedAt: null,
  status: "unavailable",
  alert: false,
  alertThreshold: null,
};

/** Grouping for the module picker; the catalogue is too long for a flat list. */
export type OrbModuleGroup =
  | "none"
  | "cadence"
  | "host"
  | "time"
  | "climate"
  | "power"
  | "household"
  | "system";

/**
 * Which shared data sources a module needs. The orb subscribes to exactly the
 * sources its selected module declares, so selecting `none` (or the clock)
 * starts no polling at all.
 */
export type OrbSourceId = "watchface" | "novaLoad" | "power" | "dashboardState" | "clock";

export type OrbModuleDefinition = {
  id: string;
  label: string;
  group: OrbModuleGroup;
  /** One short line in the picker. Not a paragraph. */
  detail: string;
  baseUnit: OrbBaseUnit;
  sources: OrbSourceId[];
  supportedFormats: OrbInfoFormat[];
  defaultDisplay: OrbInfoDisplay;
};

export type OrbModulePreference = {
  display?: Partial<OrbInfoDisplay>;
  /** Module-specific parameters (which zone, which date). Phase 2 surface. */
  params?: Record<string, unknown>;
};

export type OrbInfoPreferences = {
  moduleId?: string;
  modules?: Record<string, OrbModulePreference>;
  updatedAt?: string;
};
