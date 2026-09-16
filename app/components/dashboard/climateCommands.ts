"use client";

/**
 * Climate command logic shared by the full climate cards (`ClimateControls`)
 * and the compact Quick Access segments (`QuickAccessCard`).
 *
 * These hooks are the only place the aircon's power-intent hold, Auto arming
 * and debounced setpoint, and the bedroom heater's server-truth save handling
 * live. A second surface calling them gets identical behaviour; copying them
 * would let the two drift. See specs/quick-access-card.md,
 * specs/aircon-auto-control.md and specs/bedroom-heater-control-integrity.md.
 */
export type { EntityActionsHandler } from "./climate/types";
export { AIRCON_TEMPERATURE_SEND_DEBOUNCE_MS, CLIMATE_MODE_COMMIT_DEBOUNCE_MS } from "./climate/constants";
export { callClimateActions, saveAirconTarget, saveAirconTimer, saveBedroomHeater } from "./climate/client";
export { climateCardTitles, useClimateCardTitles } from "./climate/useClimateCardTitles";
export { useAirconCommands } from "./climate/useAirconCommands";
export { useBedroomHeaterCommands } from "./climate/useBedroomHeaterCommands";
