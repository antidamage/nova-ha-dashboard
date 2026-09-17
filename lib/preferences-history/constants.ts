// Paths and limits for the preference history.
import path from "path";

/**
 * Read per call rather than captured at import, so the directory is a runtime
 * fact. Tests point it at a temp dir without having to reset the module graph.
 */
export const historyDir = () => process.env.NOVA_DASHBOARD_HISTORY
  ?? path.join(process.cwd(), "data", "history", "preferences");

export const LOG_PATH = () => path.join(historyDir(), "log.jsonl");
/** Full state as at the start of the currently open minute bucket. */
export const OPEN_BASE_PATH = () => path.join(historyDir(), "open-base.json");
export const GENESIS_PATH = () => path.join(historyDir(), "genesis.json");

/** Replay cost is bounded by writing a full snapshot this often. */
export const CHECKPOINT_EVERY = 50;
/** Revisions kept before the oldest are compacted away. Roughly a year of use. */
export const HISTORY_MAX_REVISIONS = 2_000;

export const SECTION_LABELS: Record<string, string> = {
  phonoscope: "Visualiser",
  theme: "Appearance",
  themeLibrary: "Theme library",
  lighting: "Lighting",
  aircon: "Climate",
  panelHeater: "Panel heater",
  voice: "Voice",
  agent: "Agent",
  watchface: "Watch face",
  update: "Updates",
  layout: "Layout",
  cameras: "Cameras",
};

export function checkpointPath(index: number) {
  return path.join(historyDir(), `checkpoint-${String(index).padStart(6, "0")}.json`);
}
