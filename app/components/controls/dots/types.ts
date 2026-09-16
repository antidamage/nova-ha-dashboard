/** Shapes shared by the Dot* controls. Types only. */

export type Rgb = [number, number, number];
export type DotColor = Rgb | string;
export type Cursor = { x: number; y: number };
export type SpectrumDot = { decorative?: boolean; id: string; rgb: Rgb; x: number; xPx: number; y: number; yPx: number };

export type PrecisionDrag = { currentValue: number; lastX: number };

export type EnvelopeDurations = [attack: number, hold: number, release: number];
