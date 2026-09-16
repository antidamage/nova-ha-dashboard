"use client";

/**
 * Configuration controls — facade. One file per panel in controls/config/
 * (specs/agent-token-footprint.md §3.3); constants.ts holds the accordion
 * event names and types.ts the shared shapes.
 */
export type { ColorEncoderRingSpec } from "./controls/config/types";
export { CONFIG_ACCORDION_CLOSE_EVENT, CONFIG_ACCORDION_OPEN_EVENT } from "./controls/config/constants";
export { CheckboxRow } from "./controls/config/CheckboxRow";
export { ConfigAccordion } from "./controls/config/ConfigAccordion";
export { ColorEncoderPanel } from "./controls/config/ColorEncoderPanel";
export { SliderControlPanel } from "./controls/config/SliderControlPanel";
export { RangeSliderControlPanel } from "./controls/config/RangeSliderControlPanel";
export { EnvelopeSliderControlPanel } from "./controls/config/EnvelopeSliderControlPanel";
export { ColorWidget } from "./controls/config/ColorWidget";
