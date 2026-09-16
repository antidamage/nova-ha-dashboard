// Power shapes: the dashboard payload and the persisted state. Type-only.
import type {
  HouseholdPerson,
  PowerAccountUsagePoint,
  PowerDeviceRating,
} from "../config-schema";
import type { PowershopEstimateCalibration } from "../power-estimation";
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
 * The floating meter's groups and the washing machine's month, as the panel
 * needs them. Both are absent when the household has configured no such meter,
 * so a generic install renders neither. See specs/power-meters.md.
 */
export type PowerFloatingMeterSummary = {
  activeCategoryId: string | null;
  categories: FloatingMeterCategoryReading[];
  watts: number | null;
};

export type PowerWashingMachineSummary = {
  primaryPersonId?: string;
  typicalMinutes?: number;
  etaAt?: string | null;
  running?: { attribution?: WashAttribution; curve?: number[]; id: string; person: string | null; kwh: number };
  /** `curve` is the wash's watts downsampled to at most 48 points (§4.6). */
  cycles: Array<WashingMachineCycle & { curve?: number[] }>;
  monthKey: string;
  open: WashingMachineOpenCycle | null;
  people: HouseholdPerson[];
  totals: WashingMachineTotals[];
  watts: number | null;
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

export type PowerState = {
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
