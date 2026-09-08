/**
 * Nova Classic — the dashboard's original presentation, unchanged.
 *
 * Deliberately a thin wrapper around the existing `Dashboard` component rather
 * than a copy of it: this design must stay pixel-identical to what shipped
 * before design switching existed, so there is nothing here to drift. Its
 * styles remain in `app/globals.css`; extracting the dashboard-surface rules
 * into a scoped design stylesheet is a separate, screenshot-verified step
 * (see specs/design-modules.md, "CSS scoping").
 */
import { Dashboard } from "../../components/Dashboard";
import type { DesignModule } from "../../design/contract";

export const novaClassicDesign: DesignModule = {
  manifest: {
    id: "nova-classic",
    name: "Nova Classic",
    description: "The original cyber dashboard: zone sidebar, clock, reminder bar.",
    version: "1.0.0",
  },
  // Every feature is rendered when the device allows it; the components
  // themselves already gate on useExperienceFeature.
  lite: { statusOrb: true, background: true, camera: true, worldMap: true },
  Root: Dashboard,
};
