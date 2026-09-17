// Shared type aliases for the agent settings section. Zero runtime.
import type { AgentSettings } from "../../../../lib/agent-settings";

export type AgentSettingKey = Exclude<keyof AgentSettings, "updatedAt">;
export type SyncResult = { ok: boolean; error?: string };
