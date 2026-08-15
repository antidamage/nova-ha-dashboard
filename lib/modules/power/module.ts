import type { DashboardModule, ModuleStateContext, ModuleStatus } from "../types";

/**
 * Power estimation, as an optional capability rather than a fixture of the
 * product.
 *
 * Estimating spend needs two things this dashboard cannot discover from Home
 * Assistant: what the household pays for electricity, and how many watts each
 * device draws. Both used to be compiled in — one retailer's tariff and one
 * home's device list — so every install inherited them. Now both come from
 * config, which means an installation that has configured neither has no
 * business showing a Power zone at all.
 *
 * This module is the thing that says so. `active` is false until the config is
 * there, and `requirements` tells the operator (and `nova.modules.status`)
 * exactly what is missing.
 */
export const powerModule: DashboardModule = {
  id: "power",
  title: "Power",
  description: "Estimated household electricity use and cost, from configured tariffs and device ratings.",
  status(context: ModuleStateContext): ModuleStatus {
    const power = context.config.power;
    const tariff = power.rates.tariff;
    const ratings = power.deviceRatings;

    const requirements = [
      {
        ok: Boolean(tariff),
        label: "Electricity plan",
        detail: tariff
          ? tariff.planName
          : "Set power.rates.tariff (plan name, daily charge, and monthly unit rates).",
      },
      {
        ok: ratings.length > 0,
        label: "Device ratings",
        detail: ratings.length
          ? `${ratings.length} device${ratings.length === 1 ? "" : "s"} rated`
          : "Set power.deviceRatings so each device's draw is known.",
      },
    ];

    // Both, not either: a tariff with nothing to meter shows a cost of zero,
    // and rated devices with no tariff show kWh at no price. Either alone is a
    // misleading half-feature, so the zone stays hidden until both exist.
    const active = requirements.every((requirement) => requirement.ok);

    return {
      id: this.id,
      title: this.title,
      active,
      summary: active
        ? `${tariff?.planName ?? ""} across ${ratings.length} devices`
        : "Not configured — no Power zone is shown",
      requirements,
    };
  },
};

/**
 * Whether this installation should show power at all. Exported separately from
 * the module because the zone list is assembled on the client, which has the
 * config but not the module registry.
 */
export function powerModuleConfigured(power: {
  rates: { tariff?: unknown };
  deviceRatings: unknown[];
}): boolean {
  return Boolean(power.rates.tariff) && power.deviceRatings.length > 0;
}
