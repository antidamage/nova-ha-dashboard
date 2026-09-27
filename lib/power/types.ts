// Power shapes: the dashboard payload and the persisted state. Type-only.
import type {
  HouseholdPerson,
  PowerAccountUsagePoint,
  PowerDeviceRating,
  WashRateWindow,
} from "../config-schema";
import type { PowershopEstimateCalibration } from "../power-estimation";
import type { WashTemperature } from "./wash-temperature";
import type {
  WashAttribution,
  WashingMachineCycle,
  WashingMachineOpenCycle,
  WashingMachineTotals,
} from "../washing-machine";
import type { FloatingMeterCategoryReading, FloatingMeterState } from "./floating-meter";

export type TariffPeriod = "anytime" | "peak" | "off_peak";

// The shape lives with the config schema that validates it, so there is exactly
// one definition of a rating rather than a type here and a schema there.
export type { PowerDeviceRating };

export type PowerDeviceReading = {
  confidence: PowerDeviceRating["confidence"];
  entityId: string | null;
  id: string;
  kwhTotal: number;
  name: string;
  notes?: string;
  ratedWatts: number;
  source: string;
  state: string;
  watts: number;
  zone: string;
};

export type PowerPeriodSummary = {
  costNzd: number;
  kwh: number;
  projectedCostNzd?: number;
  projectedKwh?: number;
};

export type PowerPoint = {
  costNzd: number;
  kwh: number;
  label: string;
};

export type PowerRatePoint = {
  cPerKwh: number;
  label: string;
};

// Defined with the schema that validates it, like PowerDeviceRating above.
export type { PowerAccountUsagePoint };

export type PowerBackgroundEstimatePoint = {
  computerKwh: number;
  fridgeKwh: number;
  label: string;
  novaKwh: number;
  otherKwh: number;
  totalKwh: number;
  waterHeaterKwh: number;
};

export type PowerModeledLoad = {
  costPerDayNzd: number;
  currentWatts: number;
  elapsedCostNzd: number;
  elapsedKwh: number;
  id: string;
  kwhPerDay: number;
  name: string;
  notes: string;
};

export type PowerBaseLoadSummary = {
  costPerDayNzd: number;
  currentWatts: number;
  devices: PowerModeledLoad[];
  elapsedCostNzd: number;
  elapsedKwh: number;
  fixedCostPerDayNzd: number;
  kwhPerDay: number;
  usageCostPerDayNzd: number;
};

/**
 * The amp's follow-the-Apple-TV automation, when this household configures one
 * (specs/amp-appletv-power.md §7).
 */
export type AmpControlSummary = {
  /** May this automation switch the amp **off**? */
  autoOff: boolean;
  /** May it switch the amp **on**? */
  autoOn: boolean;
  categoryId: string;
};

/**
 * The floating meter's groups and the washing machine's month, as the panel
 * needs them. Both are absent when the household has configured no such meter,
 * so a generic install renders neither. See specs/power-meters.md.
 */
export type PowerFloatingMeterSummary = {
  activeCategoryId: string | null;
  ampControl?: AmpControlSummary;
  categories: FloatingMeterCategoryReading[];
  watts: number | null;
};

export type PowerWashingMachineSummary = {
  primaryPersonId?: string;
  running?: { attribution?: WashAttribution; curve?: number[]; id: string; person: string | null; kwh: number };
  /** `curve` is the wash's watts downsampled to at most 48 points (§4.6). */
  cycles: Array<WashingMachineCycle & { curve?: number[] }>;
  monthKey: string;
  open: WashingMachineOpenCycle | null;
  people: HouseholdPerson[];
  totals: WashingMachineTotals[];
  watts: number | null;
};

/**
 * One day of the wash graph: the instants it spans, and the local date the graph
 * labels it with. The server owns the label because the boundaries are
 * local-time ones (specs/power-meters.md 5.2).
 */
export type WashBlock = {
  startMs: number;
  endMs: number;
  /** The block's own local date, e.g. `Sat 19 Sep 2026`. */
  dateLabel: string;
};

/** One wash as the graph draws it: its span, the labels under its block, its cost, its watts curve. */
export type WashGraphCycle = WashingMachineCycle & {
  active?: boolean;
  /**
   * The wash's own local start time (`2:05 PM`) and duration (`1h 22m`), drawn
   * under its block. A wash that runs over midnight is clipped in both days and
   * still reads as the one wash it was.
   */
  startLabel?: string;
  durationLabel?: string;
  curve?: number[];
};

/**
 * One day of wash history and the block index the graph steps through
 * (`GET /api/power/washing-machine?block=`). `blocks` holds every local day that
 * has a wash in it, oldest first, so the graph can skip the empty ones.
 */
export type WashHistory = {
  blocks: number[];
  cycles: WashGraphCycle[];
  window: WashBlock;
};

/**
 * One wash as the laundry history lists it: the labels a bill prints for it,
 * in the household's own timezone (specs/power-meters.md §5.3).
 */
export type WashMonthCycle = WashingMachineCycle & {
  /** The local day it ran, e.g. `Sat 19 Sep`. */
  dateLabel: string;
  durationLabel: string;
  /** The local time it started, e.g. `11:00 AM`. */
  startLabel: string;
  /** The cycle's temperature, as its own samples show it. */
  temperature: WashTemperature;
};

/** The plan a month's washes were costed at, as the page states it. */
export type WashMonthRate = {
  planName: string;
  sourceUrl: string;
  /** The date the rates were read, when the plan records one. */
  asOf: string | null;
  /** The plan's own unit rate, cents per kWh. */
  cPerKwh: number;
  /**
   * Whether those cents include GST. The machine's own plan says so in its
   * schema and is what this household uses; a household tariff makes no claim
   * either way, so the page must not assert one on its behalf.
   */
  includingGst: boolean;
  /** Its free or discounted windows, for the page to print. */
  windows: WashRateWindow[];
};

/**
 * One calendar month of the washing machine's history, as the standalone
 * laundry page renders it: the washes in it, what they cost, and the months
 * either side so the page can be paged (specs/power-meters.md §5.3).
 */
export type WashMonthView = {
  monthKey: string;
  /** `September 2026`, the way a bill heads the period. */
  label: string;
  /** Every month holding a wash, newest first. The page steps through these. */
  months: string[];
  nextMonthKey: string | null;
  previousMonthKey: string | null;
  cycles: WashMonthCycle[];
  /** The wash under way, when there is one. It is nobody's until it closes. */
  running: WashMonthCycle | null;
  totals: WashingMachineTotals[];
  people: HouseholdPerson[];
  /**
   * How many washes the month holds. The month's own count, NOT the `totals`
   * row whose `person` is `null` — that row is the Unassigned bucket.
   */
  washes: number;
  kwh: number;
  costNzd: number;
  rate: WashMonthRate;
};

export type PowerDashboard = {
  baseLoad: PowerBaseLoadSummary;
  floatingMeter?: PowerFloatingMeterSummary;
  washingMachine?: PowerWashingMachineSummary;
  billingCycle: {
    day: number;
    days: number;
    endDate: string;
    label: string;
    startDate: string;
  };
  currentCostPerHourNzd: number;
  currentRate: {
    cPerKwh: number;
    dailyCents: number;
    displayName: string;
    period: TariffPeriod;
    sourceUrl: string;
  };
  currentWatts: number;
  devices: PowerDeviceReading[];
  estimation: PowershopEstimateCalibration;
  generatedAt: string;
  graph: PowerPoint[];
  accountUsageGraph: PowerAccountUsagePoint[];
  accountRateGraph: PowerRatePoint[];
  backgroundEstimateGraph: PowerBackgroundEstimatePoint[];
  lastRateCheckAt: string | null;
  lastSampleAt: string | null;
  rateGraph: PowerRatePoint[];
  ratesWarning?: string;
  summaries: {
    day: PowerPeriodSummary;
    month: PowerPeriodSummary;
    week: PowerPeriodSummary;
    yearToDate: PowerPeriodSummary;
  };
  totals: {
    costNzd: number;
    kwh: number;
  };
};

export type PowerBucket = {
  costNzd: number;
  kwh: number;
};

export type PersistedDeviceState = {
  kwhTotal: number;
  lastEntityId: string | null;
  lastState: string;
  lastWatts: number;
  updatedAt: string;
};

type RateCheck = {
  checkedAt: string;
  ok: boolean;
  pageHash?: string;
  pdfHash?: string;
  sourceUrl: string;
  warning?: string;
};

/** Which directions the amp's automation is allowed to move in (§7). */
export type AmpSwitches = {
  /** May the automation switch the amp **off**? */
  autoOff: boolean;
  /** May it switch the amp **on**? */
  autoOn: boolean;
};

/** The amp controller's two switches, as the Grid panel's checkboxes left them (§7). */
export type AmpAutomationState = AmpSwitches & {
  /**
   * The single switch these two replaced. Read for migration only and never
   * written: a state file from before the split says one thing about both
   * directions, and that is what it meant.
   */
  automationEnabled?: boolean;
  updatedAt: string;
};

export type PowerState = {
  ampPowerControl?: AmpAutomationState;
  daily: Record<string, PowerBucket>;
  devices: Record<string, PersistedDeviceState>;
  /**
   * Where the floating meter is and what each of its groups has been measured
   * drawing. Optional: it only exists once a household configures one.
   */
  floatingMeter?: FloatingMeterState;
  hourly: Record<string, PowerBucket>;
  lastRateCheck?: RateCheck;
  lastSampleAt: string | null;
  /** The meter tick's own clock (specs/power-meters.md §7.3). */
  lastMeterSampleAt?: string | null;
  /** Last reading of each configured kWh counter, for counter-delta energy. */
  meterCounters?: Record<string, number>;
  /** When each stored counter reading was taken; the integration gap is measured from it. */
  meterCounterReadAt?: Record<string, string>;
  rateHistory: Array<{ at: string; cPerKwh: number; label: string }>;
  version: 1;
};

/** One closed wash's full power curve, on disk for per-person profiling (§4.6). */
export type WashTraceFile = {
  attribution?: WashAttribution;
  cycleId: string;
  endedAt: string;
  kwh: number;
  person: string | null;
  /** [seconds since startedAt, watts] */
  points: Array<[number, number]>;
  startedAt: string;
};

/** The open wash's samples as [epoch seconds, watts], keyed by its start. */
export type OpenWashTrace = { anchor: string | null; points: Array<[number, number]> };
