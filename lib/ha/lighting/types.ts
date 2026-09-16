// Shapes shared across lib/ha/lighting. Types only.

export type AdaptiveSunState = "above_horizon" | "below_horizon";

export type LatestCommandControl = {
  isCurrent?: () => boolean;
  signal?: AbortSignal;
};

export type HousePartyLightingFrame = {
  rgb: [number, number, number];
  brightnessPct?: number;
  cloudBrightnessPct?: number;
  transitionSeconds?: number;
  /** Degrees of random hue jitter per light, resolved by the renderer. */
  hueOffsetDegrees?: number;
};

export type HousePartyLightSnapshot = {
  entityId: string;
  serviceData: Record<string, unknown>;
};
