/** Shapes shared by the status orb info hook. Type-only; import directly. */

import type {
  OrbInfoDisplay,
  OrbInfoSources,
  OrbModule,
  OrbModuleOutput,
  OrbModuleParams,
  OrbStackEntry,
} from "../../../../lib/orb-info/types";

export type WatchfaceSource = OrbInfoSources["watchface"];
export type PowerSource = OrbInfoSources["power"];
export type DashboardSource = OrbInfoSources["dashboardState"];
export type NovaLoadSample = NonNullable<OrbInfoSources["novaLoad"]>;

export type UseOrbInfoOptions = {
  /** False while the orb is hidden or opted out — stops every source. */
  enabled: boolean;
  /** Config previews drive the module, display and params directly. */
  moduleIdOverride?: string;
  displayOverride?: OrbInfoDisplay;
  paramsOverride?: OrbModuleParams;
};

export type OrbStackView = {
  entry: OrbStackEntry;
  state: "on" | "alert" | "countdown";
  module: OrbModule;
  output: OrbModuleOutput;
  text: string;
  alert: boolean;
  ariaLabel: string;
};
