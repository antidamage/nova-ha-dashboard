import type { PhonoscopePaletteSlot } from "./types";

export const PHONOSCOPE_ENGINE_VERSION = 1;
export const PHONOSCOPE_MODULE_ID = /^[a-z][a-z0-9_-]{1,63}$/;
export const PHONOSCOPE_PALETTE_SLOT_ID = /^[a-z][a-zA-Z0-9_-]{0,63}$/;
export const PHONOSCOPE_MODULE_VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
export const PHONOSCOPE_PACKAGE_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export const PHONOSCOPE_LIMITS = {
  compressedBytes: 25 * 1024 * 1024,
  extractedBytes: 100 * 1024 * 1024,
  textureDimension: 2048,
  expressionOperations: 64,
  spawnDepth: 4,
  particles: 65_536,
  interactiveFieldEntities: 16_384,
  renderBatches: 64,
  trailSamples: 32,
  propagationHops: 8,
  propagationDeliveriesPerTick: 8_192,
  simulationBudgetMs: 4,
} as const;

export const PHONOSCOPE_CORE_PALETTE_SLOTS: PhonoscopePaletteSlot[] = [
  { id: "primary", label: "Primary", defaultRgb: [115, 115, 115] },
  { id: "secondary", label: "Secondary", defaultRgb: [217, 217, 217] },
  { id: "tertiary", label: "Tertiary", defaultRgb: [166, 166, 166] },
  { id: "background", label: "Background", defaultRgb: [0, 0, 0] },
  { id: "primaryText", label: "Primary Text Colour", defaultRgb: [255, 255, 255] },
  { id: "secondaryText", label: "Secondary Text Colour", defaultRgb: [184, 184, 184] },
];

export const BUILTIN_PHONOSCOPE_MODULE_YAML = `engineVersion: 1
id: bpm-pulse
packageName: nz.skull.nova.visualiser.bpm-pulse
version: 1.0.0
name: BPM Pulse
description: Built-in resilient Phonoscope module driven by the best available beat signal.
dimension: 2d
bounds:
  min: [-1.7778, -1]
  max: [1.7778, 1]
boundary:
  mode: wrap
settings:
  - id: intensity
    label: Intensity
    min: 0
    max: 2
    step: 0.05
    default: 1
templates:
  pulse:
    render:
      primitive: ring
      material: emissive
      colorStart: "=palette.primary"
      colorEnd: "=palette.secondary"
      glow: "=0.4 + beat.pulse * settings.intensity"
    transform:
      scale: "=vec3(0.35 + beat.phase * 0.45, 0.35 + beat.phase * 0.45, 1)"
    lifetime: 1
scene:
  - template: pulse
    id: core-pulse
  - id: orbit-field
    field:
      layout: radial
      count: 96
      template: pulse
      radius: 0.72
      channels:
        energy: "=0.15 + audio.mid * 0.85"
resources:
  maxParticles: 4096
  maxInteractiveFieldEntities: 1024
  maxRenderBatches: 16
metadata:
  author: Nova
  license: Household use
  tags: [builtin, bpm, ambient]
`;
