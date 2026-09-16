// lib/config-schema is the back-compat facade for the dashboard config zod
// schema and its inferred types. The definitions live in lib/config-schema/,
// split by domain; this file just re-exports them so existing imports keep
// working. See specs/agent-token-footprint.md section 3.3.
export { DASHBOARD_CONFIG_SCHEMA_VERSION, HaDomainSchema } from "./config-schema/primitives";

export type { ZoneLightEvent, ZoneLightEventTime } from "./config-schema/lighting";

export type {
  AlwaysOnMeter,
  FloatingMeterCategory,
  FloatingMeterConfig,
  HouseholdPerson,
  PowerAccountUsagePoint,
  PowerDeviceRating,
  PowerTariff,
  WashingMachineConfig,
} from "./config-schema/power";

export { DoorbellConfigSchema, DoorbellScheduleSchema, DoorbellSecretMetaSchema } from "./config-schema/doorbell";

export { DashboardConfigSchema } from "./config-schema/dashboard-config";
export type {
  ClimateAirconInstanceConfig,
  ClimateHeaterInstanceConfig,
  DashboardConfig,
  DashboardConfigV1,
} from "./config-schema/dashboard-config";

export type {
  ConfigImportResult,
  ConfigValidationIssue,
  ConfigValidationResult,
  McpToolResult,
  SecretSetupStatus,
} from "./config-schema/results";
