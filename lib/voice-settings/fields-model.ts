import { decimalStepGranularity } from "../slider-step";
import { VOICE_ACCENTS, VOICE_EMOTIONS, VOICE_LANGUAGES, VOICE_SPEAKERS, WEB_BACKENDS } from "./constants";

export const SPEAKERS = new Set<string>(VOICE_SPEAKERS.map(({ value }) => value));
export const LANGUAGES = new Set<string>(VOICE_LANGUAGES.map(({ value }) => value));
export const ACCENTS = new Set<string>(VOICE_ACCENTS.map(({ value }) => value));
export const EMOTIONS = new Set<string>(VOICE_EMOTIONS.map(({ value }) => value));
export const WEB_BACKEND_SET = new Set<string>(WEB_BACKENDS.map(({ value }) => value));

export function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function storedChoice<T extends string>(value: unknown, choices: Set<string>, fallback: T): T {
  return typeof value === "string" && choices.has(value) ? value as T : fallback;
}

export function storedNumber(value: unknown, fallback: number, min: number, max: number, step: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  const granularStep = decimalStepGranularity(step);
  const stepped = Math.round(number / granularStep) * granularStep;
  // Fractional steps (e.g. temperature's 0.1) accumulate float error without
  // an explicit precision clamp.
  return Number(Math.max(min, Math.min(max, stepped)).toFixed(4));
}

// Satellite ids are casefolded and de-duplicated (order preserved) to match the
// voice server's roster keys.
export function cleanSatelliteIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      seen.add(item.trim().toLowerCase());
    }
  }
  return [...seen];
}

export const COMPANION_ROUTABLE_PASSES = [
  "interpret",
  "render_response",
  "confirm_objective",
  "extract_self_profile_update",
  "classify_icon",
] as const;

export type CompanionRoutablePass = (typeof COMPANION_ROUTABLE_PASSES)[number];
export type CompanionRouteChoice = "local" | "companion" | "both";

const COMPANION_ROUTE_CHOICES: readonly CompanionRouteChoice[] = ["local", "companion", "both"];

export function cleanCompanionRoutes(value: Record<string, unknown>): Record<string, CompanionRouteChoice> {
  const routes: Record<string, CompanionRouteChoice> = {};
  for (const pass of COMPANION_ROUTABLE_PASSES) {
    const choice = value[pass];
    if (typeof choice === "string" && (COMPANION_ROUTE_CHOICES as readonly string[]).includes(choice)) {
      routes[pass] = choice as CompanionRouteChoice;
    }
  }
  return routes;
}
