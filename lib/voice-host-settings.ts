/**
 * Voice host client — facade. The body lives in lib/voice-host-settings/; this
 * file keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3). Node-only: client components may
 * import types from here, never values.
 *
 * Where things are:
 *
 *   voice-host-settings/types.ts         every payload and result shape
 *   voice-host-settings/endpoints.ts     voice host URL (NOVA_VOICE_HOST_URL,
 *                                        machine-neutral per
 *                                        specs/maintenance-rule.md), paths,
 *                                        timeouts, training URL, host label
 *   voice-host-settings/store.ts         SOLE fs owner: the mTLS identity files
 *   voice-host-settings/client.ts        the generic JSON request helper
 *   voice-host-settings/refresh.ts       settings refresh signal, voice preview
 *   voice-host-settings/relay.ts         engine voice upload, training relay
 *   voice-host-settings/engine.ts        satellites, engine status/switch,
 *                                        voice catalogues, health probe
 *   voice-host-settings/conversation.ts  reminder icon, utterances, context clear
 *   voice-host-settings/companion.ts     companion routes and status summary
 *   voice-host-settings/speakers.ts      speaker profiles and templates
 *   voice-host-settings/agent.ts         agent administration, memories,
 *                                        grants, automations, interventions
 */
export type {
  AgentAdministrationPayload,
  AgentAutomation,
  AgentBriefing,
  AgentBriefingSchedule,
  AgentEventSubscription,
  AgentMemory,
  AgentResearch,
  CompanionComparison,
  CompanionPresence,
  CompanionRouteSummary,
  CompanionStatusSummary,
  ProactiveIntervention,
  RouteArmTiming,
  SpeakerProfileSummary,
  SpeakerProfilesPayload,
  SpeakerTemplateSummary,
  VoiceDryRunRequest,
  VoiceHostCatalog,
  VoiceHostEngineDescriptor,
  VoiceHostEngineStatus,
  VoiceHostEngineVoice,
  VoiceHostEngineVoiceBuildResult,
  VoiceHostHealthProbe,
  VoiceHostPreviewResult,
  VoiceHostRefreshResult,
  VoiceHostRelayResult,
  VoiceHostSatelliteStatus,
  VoiceUtteranceResult,
} from "./voice-host-settings/types";
export { voiceHostBaseUrl, voiceHostLabel } from "./voice-host-settings/endpoints";
export { readVoiceTlsIdentity } from "./voice-host-settings/store";
export { fetchVoiceHostPreview, triggerVoiceHostSettingsRefresh } from "./voice-host-settings/refresh";
export { buildVoiceHostEngineVoice, relayVoiceHostTraining } from "./voice-host-settings/relay";
export {
  deleteVoiceHostEngineVoice,
  fetchVoiceHostCatalog,
  fetchVoiceHostEngineStatus,
  fetchVoiceHostEngineVoices,
  fetchVoiceHostSatelliteRegistry,
  probeVoiceHostHealth,
  requestVoiceHostEngineSwitch,
} from "./voice-host-settings/engine";
export {
  classifyReminderIcon,
  endVoiceHostConversations,
  sendVoiceHostUtterance,
} from "./voice-host-settings/conversation";
export {
  fetchVoiceHostCompanionRoutes,
  fetchVoiceHostCompanionStatus,
  summariseCompanionStatus,
} from "./voice-host-settings/companion";
export {
  assignVoiceHostSpeakerTemplate,
  deleteAllVoiceHostSpeakerTemplates,
  deleteVoiceHostSpeakerProfile,
  deleteVoiceHostSpeakerTemplate,
  fetchVoiceHostSpeakerProfiles,
  updateVoiceHostSpeakerProfile,
} from "./voice-host-settings/speakers";
export {
  backupVoiceHostAgentMemories,
  cancelVoiceHostAgentGoal,
  consolidateVoiceHostAgentMemories,
  createVoiceHostAgentAutomation,
  createVoiceHostDelegationGrant,
  feedbackVoiceHostProactiveIntervention,
  fetchVoiceHostAgentAdministration,
  fetchVoiceHostAgentAutomations,
  fetchVoiceHostAgentMemories,
  fetchVoiceHostProactiveInterventions,
  forgetVoiceHostAgentMemory,
  revokeVoiceHostDelegationGrant,
  setVoiceHostAgentIdentityRole,
  transitionVoiceHostAgentAutomation,
  updateVoiceHostAgentMemory,
} from "./voice-host-settings/agent";
