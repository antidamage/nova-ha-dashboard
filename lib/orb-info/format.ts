import type {
  OrbBaseUnit,
  OrbDisplayUnit,
  OrbInfoDisplay,
  OrbModuleOutput,
  OrbRounding,
} from "./types";

/**
 * The pure orb readout formatter, shared by the web dashboard and (via a
 * line-for-line Swift port) the Apple TV client. Both are held to
 * format-cases.json so the two surfaces can never drift.
 */

export type OrbFormatResult = {
  /** What the orb actually draws. */
  text: string;
  /** Alert state after display logic (an inverted percent alerts at zero). */
  alert: boolean;
  ariaLabel: string;
};

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_WEEK = 604_800;

export const DEFAULT_ORB_DISPLAY: OrbInfoDisplay = {
  format: "number",
  unit: "native",
  decimals: 0,
  rounding: "floor",
  percentOf: { kind: "moduleThreshold" },
  percentClamp: true,
  percentInvert: false,
  showUnit: false,
  signed: false,
  clock12Hour: false,
  clockSeconds: false,
  prefix: "",
  suffix: "",
  emptyText: "—",
};

/** Seconds represented by one unit of `baseUnit`, for duration conversion. */
function secondsPerBaseUnit(baseUnit: OrbBaseUnit): number | null {
  if (baseUnit === "hours") return SECONDS_PER_HOUR;
  if (baseUnit === "timestamp") return MS_PER_SECOND / 1000; // handled as a delta in seconds
  return null;
}

function secondsPerDisplayUnit(unit: OrbDisplayUnit): number {
  switch (unit) {
    case "seconds":
      return 1;
    case "minutes":
      return SECONDS_PER_MINUTE;
    case "days":
      return SECONDS_PER_DAY;
    case "weeks":
      return SECONDS_PER_WEEK;
    case "hours":
    default:
      return SECONDS_PER_HOUR;
  }
}

/** Pick a duration unit by magnitude, so a counter reads h → d → w as it grows. */
function autoDurationUnit(totalSeconds: number): OrbDisplayUnit {
  const magnitude = Math.abs(totalSeconds);
  if (magnitude < SECONDS_PER_MINUTE) return "seconds";
  if (magnitude < SECONDS_PER_HOUR) return "minutes";
  if (magnitude < SECONDS_PER_DAY * 2) return "hours";
  if (magnitude < SECONDS_PER_WEEK * 2) return "days";
  return "weeks";
}

function unitSymbol(unit: OrbDisplayUnit): string {
  switch (unit) {
    case "seconds":
      return "s";
    case "minutes":
      return "m";
    case "hours":
      return "h";
    case "days":
      return "d";
    case "weeks":
      return "w";
    case "celsius":
      return "°C";
    case "fahrenheit":
      return "°F";
    case "watts":
      return "W";
    case "kilowatts":
      return "kW";
    default:
      return "";
  }
}

function applyRounding(value: number, decimals: number, rounding: OrbRounding): number {
  const scale = 10 ** decimals;
  const scaled = value * scale;
  // Nudge off binary-representation error so 4.999999999 at 0dp floors to 5,
  // not 4 — otherwise a counter can appear to stall an hour behind itself.
  const corrected = Math.abs(scaled - Math.round(scaled)) < 1e-9 ? Math.round(scaled) : scaled;
  if (rounding === "ceil") return Math.ceil(corrected) / scale;
  if (rounding === "round") return Math.round(corrected) / scale;
  return Math.floor(corrected) / scale;
}

function renderNumber(value: number, display: OrbInfoDisplay): string {
  const rounded = applyRounding(value, display.decimals, display.rounding);
  // -0 renders as "-0"; normalise it away.
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  const body = safe.toFixed(display.decimals);
  if (display.signed && safe > 0) return `+${body}`;
  return body;
}

function clockText(epochMs: number, display: OrbInfoDisplay): string {
  const date = new Date(epochMs);
  let hours = date.getHours();
  if (display.clock12Hour) {
    hours = hours % 12;
    if (hours === 0) hours = 12;
  }
  const parts = [
    display.clock12Hour ? String(hours) : String(hours).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ];
  if (display.clockSeconds) parts.push(String(date.getSeconds()).padStart(2, "0"));
  return parts.join(":");
}

/**
 * Convert the module's canonical value into the number the display asks for,
 * returning both the number and the unit it ended up in (auto resolves here).
 */
function convert(
  output: OrbModuleOutput,
  display: OrbInfoDisplay,
): { value: number; unit: OrbDisplayUnit } | null {
  const value = output.value;
  if (value === null || !Number.isFinite(value)) return null;

  if (display.format === "duration") {
    const perBase = secondsPerBaseUnit(output.baseUnit);
    // A duration display over a non-duration base unit is a misconfiguration;
    // fall back to the raw number rather than inventing a conversion.
    if (perBase === null) return { value, unit: "native" };
    const totalSeconds = value * perBase;
    const unit = display.unit === "auto" || display.unit === "native"
      ? autoDurationUnit(totalSeconds)
      : display.unit;
    return { value: totalSeconds / secondsPerDisplayUnit(unit), unit };
  }

  if (display.format === "percent") {
    if (output.baseUnit === "percent") return { value, unit: "native" };
    if (output.baseUnit === "ratio") return { value: value * 100, unit: "native" };
    const basis = display.percentOf.kind === "fixed"
      ? display.percentOf.value
      : output.alertThreshold;
    if (basis === null || !Number.isFinite(basis) || basis === 0) return null;
    return { value: (value / basis) * 100, unit: "native" };
  }

  if (display.format === "temperature") {
    if (display.unit === "fahrenheit") return { value: value * 1.8 + 32, unit: "fahrenheit" };
    return { value, unit: "celsius" };
  }

  // Plain number: the only conversion is the power scale.
  if (output.baseUnit === "watts" && display.unit === "kilowatts") {
    return { value: value / 1000, unit: "kilowatts" };
  }
  if (output.baseUnit === "watts") return { value, unit: "watts" };
  // Note there is deliberately NO ratio→percent scaling here: a hidden ×100 in
  // the plain-number path would make the same module read 0.42 or 42 depending
  // on a format switch. Modules that mean percentages report `percent`.
  return { value, unit: display.unit === "auto" ? "native" : display.unit };
}

export function formatOrbValue(
  output: OrbModuleOutput,
  display: OrbInfoDisplay,
  options: { label?: string; now?: number } = {},
): OrbFormatResult {
  const label = options.label ?? "Status";
  const empty = display.emptyText;

  if (display.format === "text") {
    const text = output.status === "error" ? empty : output.text ?? empty;
    return {
      text,
      alert: output.alert,
      ariaLabel: `${label}: ${output.text ?? "no reading"}.${output.detail ? ` ${output.detail}` : ""}`,
    };
  }

  if (output.status === "unavailable" || output.status === "error" || output.value === null) {
    return {
      text: empty,
      // An absent reading is not an alert — the orb must not pulse because a
      // scrape has not landed yet.
      alert: false,
      ariaLabel: `${label}: no reading.${output.detail ? ` ${output.detail}` : ""}`,
    };
  }

  if (display.format === "clock") {
    const text = `${display.prefix}${clockText(output.value, display)}${display.suffix}`;
    return { text, alert: output.alert, ariaLabel: `${label}: ${clockText(output.value, display)}.` };
  }

  const converted = convert(output, display);
  if (!converted) {
    return { text: empty, alert: false, ariaLabel: `${label}: no reading.` };
  }

  let numeric = converted.value;
  let alert = output.alert;

  if (display.format === "percent") {
    if (display.percentInvert) {
      numeric = 100 - numeric;
      // Inverted, the alert condition is "counted all the way down".
      alert = output.alert || numeric <= 0;
    }
    if (display.percentClamp) {
      numeric = Math.max(0, Math.min(100, numeric));
    }
  }

  const body = renderNumber(numeric, display);
  const symbol = display.showUnit
    ? display.format === "percent" ? "%" : unitSymbol(converted.unit)
    : "";
  const text = `${display.prefix}${body}${symbol}${display.suffix}`;
  const spoken = `${body}${symbol || (display.format === "percent" ? " percent" : "")}`;

  return {
    text,
    alert,
    ariaLabel: `${label}: ${spoken}.${output.detail ? ` ${output.detail}` : ""}`,
  };
}

/**
 * Milliseconds until the FORMATTED text would next change, so the orb can wake
 * exactly then instead of on a fixed timer. At one decimal place an hours
 * counter changes every 6 minutes, not every hour.
 */
export function msUntilDisplayChange(
  output: OrbModuleOutput,
  display: OrbInfoDisplay,
  now: number,
): number | null {
  if (display.format === "clock") {
    const period = display.clockSeconds ? MS_PER_SECOND : MS_PER_SECOND * SECONDS_PER_MINUTE;
    return period - (now % period) + 50;
  }
  if (output.value === null || output.observedAt === null) return null;
  const observedAt = Date.parse(output.observedAt);
  if (!Number.isFinite(observedAt)) return null;

  const perBase = secondsPerBaseUnit(output.baseUnit);
  if (perBase === null) return null;

  // The elapsed time one displayed step represents.
  const converted = convert(output, display);
  const displayUnitSeconds = converted && converted.unit !== "native"
    ? secondsPerDisplayUnit(converted.unit)
    : perBase;
  const stepSeconds = displayUnitSeconds / 10 ** display.decimals;
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) return null;

  // Absolute, so a countdown anchored on a FUTURE instant (sunset) lands on the
  // same step boundaries as a counter anchored on a past one (last gym visit).
  const elapsedMs = Math.abs(now - observedAt);
  const stepMs = stepSeconds * MS_PER_SECOND;
  const nextBoundary = (Math.floor(elapsedMs / stepMs) + 1) * stepMs;
  return Math.max(1000, Math.min(SECONDS_PER_HOUR * MS_PER_SECOND, nextBoundary - elapsedMs + 50));
}
