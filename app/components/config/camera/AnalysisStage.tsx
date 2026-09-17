"use client";

import type { RefObject } from "react";
import { demoAssetUrl } from "../../../../lib/demo-assets";
import { COLORS } from "./constants";
import type { AnalysisSettings } from "./types";

// The calibration frame with the zone polygons drawn over it. Scene geometry
// stays normalised to the source frame — the polygon points are 0..1 of the
// frame and are only scaled to the 1000 x 562.5 viewBox for display.
export function AnalysisStage({
  addPoint,
  cameraId,
  dragPoint,
  finishDrag,
  frameMode,
  frameVersion,
  selectedId,
  settings,
  stageRef,
}: {
  addPoint: (event: React.PointerEvent<HTMLDivElement>) => void;
  cameraId: string;
  dragPoint: (event: React.PointerEvent<HTMLDivElement>) => void;
  finishDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
  frameMode: "daylight" | "live";
  frameVersion: number;
  selectedId: string | null;
  settings: AnalysisSettings;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={stageRef} className="camera-analysis-stage" data-nova-no-drag-scroll onPointerDown={addPoint} onPointerMove={dragPoint} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      <img src={process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true" ? demoAssetUrl("assets/outside-demo.png") : `/api/camera/${cameraId}/analysis/frame?daylight=${frameMode === "daylight"}&v=${frameVersion}`} alt={`${frameMode === "daylight" ? "Daytime reference" : "Current"} Outside camera frame for zone calibration`} draggable={false} />
      <svg viewBox="0 0 1000 562.5" preserveAspectRatio="none" aria-hidden="true">
        {settings.zones.map((zone) => (
          <g key={zone.id} opacity={selectedId === zone.id ? 1 : 0.45}>
            <polygon points={zone.points.map(([x, y]) => `${x * 1000},${y * 562.5}`).join(" ")} fill={`${COLORS[zone.kind]}26`} stroke={COLORS[zone.kind]} strokeWidth={selectedId === zone.id ? 4 : 2} vectorEffect="non-scaling-stroke" />
            {selectedId === zone.id ? zone.points.map(([x, y], index) => <circle key={index} cx={x * 1000} cy={y * 562.5} r="10" fill={COLORS[zone.kind]} stroke="#05070a" strokeWidth="3" vectorEffect="non-scaling-stroke" />) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
