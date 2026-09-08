import { PlainRoot } from "./Root";
import type { DesignModule } from "../../design/contract";

export const plainDesign: DesignModule = {
  manifest: {
    id: "plain",
    name: "Plain",
    description: "Single column, flat zone list, no ornament. Proves the design seam.",
    version: "1.0.0",
  },
  // No status orb, no background layer, and no world map are placed by this
  // design at all; the camera still appears because it lives inside the
  // reused OutsideControls body.
  lite: { statusOrb: false, background: false, camera: true, worldMap: false },
  Root: PlainRoot,
};
