export type PeriodSummary = {
  costNzd: number;
  kwh: number;
  projectedCostNzd: number;
  projectedKwh: number;
};

export type PowershopEstimateCalibration = {
  confidence: "high" | "medium" | "low" | "modeled";
  halfLifeDays: number;
  historyDays: number;
  intervalDays: number;
  lastActualDate: string | null;
  source: "powershop_hourly" | "powershop_daily" | "modeled";
};

export type PowershopEstimateResult = {
  calibration: PowershopEstimateCalibration;
  currentCostPerHourNzd: number;
  currentUsageRateCents: number;
  currentWatts: number;
  day: PeriodSummary;
  month: PeriodSummary;
  week: PeriodSummary;
};

export type EstimateOptions = {
  billingEndDate: string;
  billingStartDate: string;
  currentUsageRateCents: number;
  fallbackCurrentCostPerHourNzd: number;
  fallbackCurrentWatts: number;
  fallbackDailyCostNzd: number;
  fallbackDailyKwh: number;
  localElapsedCostNzd: number;
  localElapsedKwh: number;
  nowHour: number;
  today: string;
  weekStartDate: string;
};

export type ExpectedUsage = { costNzd: number; kwh: number };
export type WeightedValue = ExpectedUsage & { usageCostNzd: number; weight: number };
