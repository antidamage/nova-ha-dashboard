"use client";

// Facade: the Advanced fold sub-panel (specs/advanced-fold.md). The body lives
// in ./advanced-fold/:
//   types.ts          Axis, Tag, AdvancedFoldProps
//   scroller-model.ts offset/size/transform helpers along the fold's axis
//   AdvancedFold.tsx  the component and its gesture handling
// Band maths and gesture constants stay in ./advancedFoldBand.ts.
export { AdvancedFold, ADVANCED_FOLD_DRAG_BREAK_PX, ADVANCED_FOLD_WHEEL_BREAK_PX } from "./advanced-fold/AdvancedFold";
export type { AdvancedFoldProps } from "./advanced-fold/types";
