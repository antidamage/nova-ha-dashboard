// MapLibre paint/layout expressions: building colour and opacity ramps, land
// use, street label size, radar opacity.
import {
  BUILDING_EXTRUSION_OPACITY,
  BUILDING_FOOTPRINT_OPACITY,
  HIGH_BUILDING_HEIGHT_METERS,
  LOW_BUILDING_HEIGHT_METERS,
} from "./constants";

export function buildingHeightColorExpression(lowColor: string, highColor: string) {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "render_height"], LOW_BUILDING_HEIGHT_METERS],
    LOW_BUILDING_HEIGHT_METERS,
    lowColor,
    HIGH_BUILDING_HEIGHT_METERS,
    highColor,
  ];
}

export function buildingExtrusionOpacityExpression(baseOpacity = BUILDING_EXTRUSION_OPACITY) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    8.6,
    0,
    9.4,
    baseOpacity * 0.01,
    10.2,
    baseOpacity * 0.03,
    11,
    baseOpacity * 0.07,
    11.8,
    baseOpacity * 0.14,
    12.6,
    baseOpacity * 0.24,
    13.4,
    baseOpacity * 0.4,
    14.2,
    baseOpacity * 0.68,
    14.7,
    baseOpacity * 0.86,
    15,
    baseOpacity,
  ] as const;
}

export function buildingFootprintOpacityExpression(baseOpacity = BUILDING_FOOTPRINT_OPACITY) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    8.4,
    0,
    9.2,
    baseOpacity * 0.08,
    10.2,
    baseOpacity * 0.18,
    11.2,
    baseOpacity * 0.34,
    12.2,
    baseOpacity * 0.56,
    13.2,
    baseOpacity * 0.82,
    14.2,
    baseOpacity,
    14.9,
    baseOpacity * 0.78,
    15.5,
    baseOpacity * 0.42,
    16,
    baseOpacity * 0.14,
    16.4,
    0,
  ] as const;
}

export function landuseOpacityExpression(baseOpacity = 0.6) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    8.4,
    0,
    9.2,
    baseOpacity * 0.03,
    10.2,
    baseOpacity * 0.08,
    11.2,
    baseOpacity * 0.18,
    12.2,
    baseOpacity * 0.32,
    13.2,
    baseOpacity * 0.48,
    14,
    baseOpacity,
    14.8,
    baseOpacity * 0.78,
    15.4,
    baseOpacity * 0.42,
    15.9,
    baseOpacity * 0.12,
    16.3,
    0,
  ] as const;
}
export function scaledLabelSize(value: number, multiplier: number) {
  return Math.round(value * multiplier * 100) / 100;
}

export function streetLabelSizeExpression(multiplier = 1) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    13,
    scaledLabelSize(9, multiplier),
    16,
    scaledLabelSize(12, multiplier),
  ] as const;
}
export function radarOpacityExpression(opacityMultiplier: number) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    9,
    0.88 * opacityMultiplier,
    9.8,
    0.8 * opacityMultiplier,
    10.6,
    0.66 * opacityMultiplier,
    11.4,
    0.5 * opacityMultiplier,
    12.1,
    0.34 * opacityMultiplier,
    12.8,
    0.2 * opacityMultiplier,
    13.4,
    0.12 * opacityMultiplier,
    14,
    0.06 * opacityMultiplier,
    14.6,
    0.02 * opacityMultiplier,
    15.2,
    0,
  ] as const;
}
