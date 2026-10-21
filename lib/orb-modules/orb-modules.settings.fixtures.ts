import { normalizeOrbModule, type OrbModule } from "../orb-modules";

/** A three-stop choice in the Tech module's own shape, for focused assertions. */
export const CHOICE_MODULE = normalizeOrbModule({
  id: "choice",
  name: "Choice",
  formatVersion: 1,
  settings: [
    {
      id: "knobTheme",
      label: "Knob Theme",
      min: 0,
      max: 2,
      step: 1,
      default: 1,
      options: ["light", "auto", "dark"],
    },
  ],
  layers: [
    { id: "dark", type: "disc", enabledWhen: { setting: "knobThemeResolved", max: 0.5 }, stops: [{ at: 0, color: { hex: "#000000" } }] },
    { id: "light", type: "disc", enabledWhen: { setting: "knobThemeResolved", min: 0.5 }, stops: [{ at: 0, color: { hex: "#ffffff" } }] },
  ],
}) as OrbModule;

/** The device answer the orb defers to on `auto`, as an option index. */
export const asLight = () => 0;
export const asDark = () => 2;
