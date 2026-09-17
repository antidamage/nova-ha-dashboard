// Shapes shared by the Camera section and its scene-analysis editor. Zero runtime.
import type { NormalizedRectangle } from "../../../../lib/reference-selection";

export type Processing = { brightness: number; contrast: number; sharpness: number };

export type CameraStatus = {
  deviceState: string;
  statusReason: string;
  healthy: boolean;
  source: string;
  newestSegmentAgeSeconds: number | null;
  consecutiveStalls: number;
};

export type Point = [number, number];
export type SceneZone = { id: string; label: string; kind: "activity" | "vehicle" | "exclude"; points: Point[] };
export type AnalysisSettings = { enabled: boolean; alertsEnabled: boolean; zones: SceneZone[] };
export type ReferenceKind = "cat" | "vehicle" | "person";
export type ReferenceImage = {
  imageUrl?: string;
  id: string;
  kind: ReferenceKind;
  name: string;
  role?: "owner" | null;
  source_name?: string | null;
  crop?: NormalizedRectangle | null;
  legacy?: boolean;
  created_at: string;
};
