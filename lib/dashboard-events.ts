// Dashboard server-sent event stream: client registry, publish helpers,
// optimistic lighting state, and the background poller that feeds it.
//
// Package layout (lib/dashboard-events/):
//   constants.ts         poll, heartbeat and debounce timings
//   types.ts             client, store and action-input shapes
//   store.ts             the globalThis-backed state (sole owner)
//   transport.ts         SSE framing, client fan-out, spectrum cursors
//   publish.ts           state, task, design, sound, doorbell, orb-timer events
//   voice.ts             voice speaking and transcript events
//   optimistic-model.ts  pure optimistic state for lighting/entity actions
//   state-poll.ts        HA state polling and the HA state-change subscription
//   task-alerts.ts       reminder alerts and task/icon snapshots
//   poller.ts            iCloud sync, adaptive lighting, poller start/stop
//   subscribe.ts         backbone start and the two SSE subscriptions

export { rememberSpectrumCursor, withDashboardEventMetadata } from "./dashboard-events/transport";
export {
  getLatestDashboardSun,
  holdDashboardEventLightPolling,
  publishDashboardError,
  publishDashboardState,
  publishDesign,
  publishDoorbellAlert,
  publishOrbTimer,
  publishPhonoscopeConfig,
  publishReminderIcons,
  publishSoundLibrary,
  publishTaskAudioStatus,
  publishTaskDismiss,
  publishTasks,
} from "./dashboard-events/publish";
export type { VoiceSpeakingEvent } from "./dashboard-events/types";
export {
  clearVoiceTranscripts,
  getVoiceTranscripts,
  publishVoiceSpeaking,
  publishVoiceTranscript,
  replaceVoiceTranscript,
} from "./dashboard-events/voice";
export {
  entityActionAffectsLighting,
  isLightZoneAction,
  optimisticDashboardStateForEntityAction,
  optimisticDashboardStateForHouseParty,
  optimisticDashboardStateForLightingEntityIdsAction,
  optimisticDashboardStateForZoneAction,
} from "./dashboard-events/optimistic-model";
export {
  ensureHouseholdEventBackboneStarted,
  subscribeDashboardEvents,
  subscribeTaskEvents,
} from "./dashboard-events/subscribe";
