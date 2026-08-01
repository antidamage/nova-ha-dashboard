import type { AgentPreferences } from "./types";
import { decimalStepGranularity } from "./slider-step";

export type AgentSettings = Required<
  Pick<
    AgentPreferences,
    | "ralphLoopEnabled"
    | "ralphLoopMaxIterations"
    | "ralphLoopSleepMs"
    | "ralphLoopFailureSeconds"
    | "ralphLoopThinkingThresholdMs"
    | "ralphLoopLlmVerifyEnabled"
    | "ralphLoopLlmVerifyMinIntervalMs"
    | "ralphLoopLlmConfirmTimeoutSeconds"
  >
> & { updatedAt?: string };

export type AgentSettingsUpdate = Partial<Omit<AgentSettings, "updatedAt">>;

export const AGENT_SETTINGS_DEFAULTS: AgentSettings = {
  ralphLoopEnabled: true,
  ralphLoopMaxIterations: 20,
  ralphLoopSleepMs: 500,
  ralphLoopFailureSeconds: 8,
  ralphLoopThinkingThresholdMs: 2500,
  ralphLoopLlmVerifyEnabled: true,
  ralphLoopLlmVerifyMinIntervalMs: 1500,
  ralphLoopLlmConfirmTimeoutSeconds: 3,
};

export const AGENT_SETTINGS_RANGES = {
  ralphLoopMaxIterations: { min: 1, max: 50, step: 1 },
  ralphLoopSleepMs: { min: 100, max: 2000, step: 100 },
  ralphLoopFailureSeconds: { min: 1, max: 30, step: 1 },
  ralphLoopThinkingThresholdMs: { min: 250, max: 8000, step: 250 },
  ralphLoopLlmVerifyMinIntervalMs: { min: 0, max: 4000, step: 250 },
  ralphLoopLlmConfirmTimeoutSeconds: { min: 1, max: 10, step: 0.5 },
} as const;

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function storedNumber(
  value: unknown,
  fallback: number,
  range: { min: number; max: number; step: number },
) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  const step = decimalStepGranularity(range.step);
  const stepped = Math.round(number / step) * step;
  return Number(Math.max(range.min, Math.min(range.max, stepped)).toFixed(12));
}

export function normalizeAgentSettings(value?: AgentPreferences | null): AgentSettings {
  const source = recordValue(value);
  return {
    ralphLoopEnabled: source.ralphLoopEnabled !== false,
    ralphLoopMaxIterations: storedNumber(
      source.ralphLoopMaxIterations,
      AGENT_SETTINGS_DEFAULTS.ralphLoopMaxIterations,
      AGENT_SETTINGS_RANGES.ralphLoopMaxIterations,
    ),
    ralphLoopSleepMs: storedNumber(
      source.ralphLoopSleepMs,
      AGENT_SETTINGS_DEFAULTS.ralphLoopSleepMs,
      AGENT_SETTINGS_RANGES.ralphLoopSleepMs,
    ),
    ralphLoopFailureSeconds: storedNumber(
      source.ralphLoopFailureSeconds,
      AGENT_SETTINGS_DEFAULTS.ralphLoopFailureSeconds,
      AGENT_SETTINGS_RANGES.ralphLoopFailureSeconds,
    ),
    ralphLoopThinkingThresholdMs: storedNumber(
      source.ralphLoopThinkingThresholdMs,
      AGENT_SETTINGS_DEFAULTS.ralphLoopThinkingThresholdMs,
      AGENT_SETTINGS_RANGES.ralphLoopThinkingThresholdMs,
    ),
    ralphLoopLlmVerifyEnabled: source.ralphLoopLlmVerifyEnabled !== false,
    ralphLoopLlmVerifyMinIntervalMs: storedNumber(
      source.ralphLoopLlmVerifyMinIntervalMs,
      AGENT_SETTINGS_DEFAULTS.ralphLoopLlmVerifyMinIntervalMs,
      AGENT_SETTINGS_RANGES.ralphLoopLlmVerifyMinIntervalMs,
    ),
    ralphLoopLlmConfirmTimeoutSeconds: storedNumber(
      source.ralphLoopLlmConfirmTimeoutSeconds,
      AGENT_SETTINGS_DEFAULTS.ralphLoopLlmConfirmTimeoutSeconds,
      AGENT_SETTINGS_RANGES.ralphLoopLlmConfirmTimeoutSeconds,
    ),
    ...(typeof source.updatedAt === "string" ? { updatedAt: source.updatedAt } : {}),
  };
}

function updateBoolean(
  source: Record<string, unknown>,
  field: keyof AgentSettingsUpdate,
): boolean | undefined {
  if (!(field in source)) {
    return undefined;
  }
  if (typeof source[field] !== "boolean") {
    throw new Error(`Agent ${field} must be true or false`);
  }
  return source[field] as boolean;
}

function updateNumber(
  source: Record<string, unknown>,
  field: keyof typeof AGENT_SETTINGS_RANGES,
) {
  if (!(field in source)) {
    return undefined;
  }
  const value = Number(source[field]);
  if (!Number.isFinite(value)) {
    throw new Error(`Agent ${field} must be a number`);
  }
  return storedNumber(value, AGENT_SETTINGS_RANGES[field].min, AGENT_SETTINGS_RANGES[field]);
}

export function parseAgentSettingsUpdate(value: unknown): AgentSettingsUpdate {
  const source = recordValue(value);
  const update: AgentSettingsUpdate = {
    ralphLoopEnabled: updateBoolean(source, "ralphLoopEnabled"),
    ralphLoopMaxIterations: updateNumber(source, "ralphLoopMaxIterations"),
    ralphLoopSleepMs: updateNumber(source, "ralphLoopSleepMs"),
    ralphLoopFailureSeconds: updateNumber(source, "ralphLoopFailureSeconds"),
    ralphLoopThinkingThresholdMs: updateNumber(source, "ralphLoopThinkingThresholdMs"),
    ralphLoopLlmVerifyEnabled: updateBoolean(source, "ralphLoopLlmVerifyEnabled"),
    ralphLoopLlmVerifyMinIntervalMs: updateNumber(source, "ralphLoopLlmVerifyMinIntervalMs"),
    ralphLoopLlmConfirmTimeoutSeconds: updateNumber(source, "ralphLoopLlmConfirmTimeoutSeconds"),
  };
  const provided = Object.fromEntries(
    Object.entries(update).filter(([, setting]) => setting !== undefined),
  ) as AgentSettingsUpdate;
  if (!Object.keys(provided).length) {
    throw new Error("No agent settings provided");
  }
  return provided;
}
