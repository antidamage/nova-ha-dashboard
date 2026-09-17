/** Shapes for the companion status card. Type-only; import directly. */

import type { CompanionStatusSummary } from "../../../lib/voice-host-settings";

export type Payload = {
  voiceHost: { ok: boolean };
  status: CompanionStatusSummary | null;
};
