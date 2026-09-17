"use client";

import { SlideSwitch } from "../../SlideSwitch";
import { DEMO_MODE } from "./constants";

export function IngestionToggle({
  ingestionBusy,
  ingestionEnabled,
  toggleIngestion,
}: {
  ingestionBusy: boolean;
  ingestionEnabled: boolean;
  toggleIngestion: () => void;
}) {
  return (
    <div className="grid gap-2 border border-cyan-300/20 bg-neutral-900/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-black uppercase text-cyan-200">Camera ingestion</span>
        <SlideSwitch
          checked={ingestionEnabled}
          disabled={DEMO_MODE || ingestionBusy}
          label="Camera ingestion"
          onChange={() => void toggleIngestion()}
        />
      </div>
      <span className="text-xs text-neutral-400">
        {ingestionEnabled
          ? "On — the recorder captures the feed (or shows the test pattern if no device). Turn off to stop ffmpeg entirely and reduce CPU load."
          : "Off — no ffmpeg runs: the live feed AND the test pattern are stopped to reduce CPU load. Turn on to resume the DVR."}
      </span>
    </div>
  );
}
