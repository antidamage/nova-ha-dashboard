import type { TaskRepeatDraftKind } from "./task-model/types";

export const ALERT_AUDIO_PATH = "/api/tasks/audio";
// Fallbacks only. The live values come from config.tasks.alertAudio
// (alertWindowMs / repeatMs) via the shared client config — they were declared
// in the schema and documented in SPEC but nothing read them until now.
export const ALERT_AUDIO_WINDOW_MS = 5000;
export const ALERT_AUDIO_REPEAT_MS = 5 * 60 * 1000;

export const inputClassName =
  "min-h-11 w-full border border-neutral-700 bg-neutral-950/70 px-3 py-2 font-mono text-sm font-black uppercase text-neutral-100 outline-none focus:border-cyan-300";

export const repeatOptions: Array<{ label: string; value: TaskRepeatDraftKind }> = [
  { label: "Hourly", value: "hourly" },
  { label: "Morning/night", value: "morning-night" },
  { label: "N days after completion", value: "days" },
  { label: "After another reminder", value: "after" },
];

export const FOLLOW_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export const IMPORT_TEMPLATE = [
  "# start,end,name,repeat",
  "2026-05-01 09:00,2026-05-01 09:30,Feed starter,days:1",
  "21:00,,Medication reminder,morning/night",
].join("\n");
