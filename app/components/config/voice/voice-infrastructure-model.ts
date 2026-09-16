import { COMPANION_ROUTABLE_PASSES, type CompanionRouteChoice } from "../../../../lib/voice-settings";
import type { ConfigSelectOption } from "../../ConfigSelect";
import type { PipelineKey, PipelineSettingKey, SatelliteRow, SpeakerMatchKey } from "./types";

export function satelliteStatusText(row: SatelliteRow, voiceHostOk: boolean) {
  if (!voiceHostOk) {
    return { text: "Status unavailable — device unreachable", tone: "warning" as const };
  }
  if (!row.status) {
    return { text: "Not seen since the voice server started", tone: "warning" as const };
  }
  const timestamp = row.status.connected ? row.status.connectedAt : row.status.disconnectedAt;
  const since = timestamp
    ? ` since ${new Date(timestamp).toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
    })}`
    : "";
  return row.status.connected
    ? { text: `Connected${since}`, tone: "ok" as const }
    : { text: `Disconnected${since}`, tone: "error" as const };
}

// Switches and selects, not sliders: they have no drag to forget.
export const PIPELINE_NON_SLIDER_KEYS = [
  "satelliteNoiseGateEnabled",
  "speakerRecognitionEnabled",
  "voiceTrainingEnabled",
  "companionRoutes",
  "companionEnabled",
  "companionForceLocal",
  "webAccessEnabled",
  "webBackend",
] as const;

// The reasoning passes, named for the person choosing rather than for the
// protocol. "interpret" and "render_response" mean nothing from outside.
export const COMPANION_PASS_LABELS: Record<(typeof COMPANION_ROUTABLE_PASSES)[number], string> = {
  interpret: "Understand the request",
  render_response: "Write the spoken reply",
  confirm_objective: "Confirm a device settled",
  extract_self_profile_update: "Notice a stated name",
  classify_icon: "Pick a reminder icon",
};

export const COMPANION_ROUTE_OPTIONS: ConfigSelectOption<CompanionRouteChoice>[] = [
  { value: "local", label: "Voice server" },
  { value: "companion", label: "Companion" },
  // Named for what it costs, because it is the one choice that makes things
  // slower on purpose: both stacks run the pass, so neither slot is freed.
  { value: "both", label: "Both (compare)" },
];

export function isPipelineSliderKey(key: PipelineSettingKey): key is PipelineKey {
  return !(PIPELINE_NON_SLIDER_KEYS as readonly string[]).includes(key);
}

// The four speaker-matching sliders, rendered from one list so their notes,
// default markers, and snap targets stay in lock-step with lib/voice-settings.
// Order runs from the knob that most directly fixes "a new profile every time"
// (cluster) down to the fine within-conversation tolerance.
export const SPEAKER_MATCH_SLIDERS: {
  key: SpeakerMatchKey;
  label: string;
  color: [number, number, number];
  note: string;
}[] = [
  {
    key: "speakerClusterThreshold",
    label: "New-profile threshold",
    color: [130, 200, 255],
    note:
      "How similar a new capture must be to fold into one of your existing unnamed voice "
      + "profiles instead of starting another. Lower this first if the system keeps making a "
      + "fresh profile for you across different mics and distances.",
  },
  {
    key: "speakerMatchThreshold",
    label: "Recognition threshold",
    color: [120, 230, 180],
    note:
      "How close a voice must be to count as an already-known person. Lower recognizes you more "
      + "readily from farther away or off-axis; set too low it can start confusing similar voices.",
  },
  {
    key: "speakerMatchMargin",
    label: "Decision margin",
    color: [255, 200, 90],
    note:
      "How far the best-matching person must lead the runner-up before a match is trusted. Lower "
      + "still decides when two people score alike; raise it if household members get mixed up.",
  },
  {
    key: "speakerConversationMatchThreshold",
    label: "Conversation hold",
    color: [200, 160, 255],
    note:
      "How much a voice can drift and still be treated as the same speaker within one open "
      + "conversation. Deliberately loose; lower tolerates more movement mid-exchange.",
  },
];
