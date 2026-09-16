/** Shapes shared by the configuration control panels. Types only. */
import type { ColorEncoderRing } from "../../ColorEncoder";

/** Re-exported so slot renderers can type their ring definitions. */
export type ColorEncoderRingSpec = ColorEncoderRing;

export type DotLineMarker = { active?: boolean; label: string; value: number };

export type ConfigAccordionOpenDetail = {
  element: HTMLElement;
  persistKey: string;
};

export type ConfigAccordionCloseDetail = {
  element: HTMLElement;
  persistKey: string;
};
