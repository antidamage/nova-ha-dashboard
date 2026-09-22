import type { DashboardConfig, WashingMachineConfig } from "./config-schema";
/** Primary person supplies completion ownership. */
export function primaryWashingConfig(config: Pick<DashboardConfig, "dashboard" | "power">): WashingMachineConfig | undefined {
  const washing = config.power.washingMachine;
  const primary = config.dashboard.people.find((person) => person.primary);
  if (!washing || !primary) return washing;
  return { ...washing,
    ...(washing.completionAlert ? { completionAlert: { ...washing.completionAlert, personId: primary.id } } : {}),
  };
}
