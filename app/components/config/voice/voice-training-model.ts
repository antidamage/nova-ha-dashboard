import type { TrainingSet, TrainingState } from "./types";

// Statuses where work is under way: controls that would start a second run or
// mutate the sample set are disabled while any of these hold.
export const BUSY = new Set(["preparing", "training", "stopping"]);

export const STAGE_LABEL: Record<string, string> = {
  slice: "Slicing samples",
  asr: "Transcribing",
  features: "Extracting features",
  s1: "Stage 1 — prosody model",
  s2: "Stage 2 — decoder",
  package: "Packaging",
};

export function statusTone(state: TrainingState): string {
  if (state.status === "failed") return "text-rose-300";
  if (state.status === "ready") return state.complete ? "text-emerald-300" : "text-amber-300";
  if (BUSY.has(state.status)) return "text-cyan-300";
  return "text-neutral-400";
}

export function statusLabel(set: TrainingSet): string {
  const { state } = set;
  if (state.status === "ready") {
    return state.complete ? "Trained" : "Partially trained (stopped early)";
  }
  if (state.status === "failed") return "Failed";
  if (state.status === "stopping") return "Stopping at next checkpoint…";
  if (BUSY.has(state.status)) return STAGE_LABEL[state.stage] ?? "Working";
  if (set.samplesChanged) return "Samples changed — will retrain from scratch";
  return set.resumable ? "Ready to resume" : "Not started";
}
