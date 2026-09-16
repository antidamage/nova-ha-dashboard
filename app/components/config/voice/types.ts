// Shared type aliases for the voice configuration UI (VoiceConfig,
// VoiceInfrastructureConfig, VoiceTrainingConfig). Zero runtime.

export type SyncResult = { ok: boolean; error?: string };
export type VoiceOption = { value: string; label: string; detail?: string };

export type VoiceRoomOption = { id: string; name: string };

export type SatelliteRow = {
  configuredRoomId: string;
  enabled: boolean;
  voiceEnabled: boolean;
  id: string;
  name: string;
  platform: string;
  status: {
    connected?: boolean;
    connectedAt?: string;
    disconnectedAt?: string;
    roomId?: string;
  } | null;
};

export type EngineVoiceRow = {
  id: string;
  name?: string;
  language?: string;
  speakerScale?: number;
};

export type PipelineKey =
  | "conversationIdleSeconds"
  | "conversationMaxSeconds"
  | "ttsPrerollMs"
  | "ttsFrameMs"
  | "webAnswerMaxSentences"
  | "speakerMatchThreshold"
  | "speakerMatchMargin"
  | "speakerClusterThreshold"
  | "speakerConversationMatchThreshold";
export type PipelineSettingKey =
  | PipelineKey
  | "satelliteNoiseGateEnabled"
  | "speakerRecognitionEnabled"
  | "voiceTrainingEnabled"
  | "webAccessEnabled"
  | "webBackend"
  | "companionRoutes"
  | "companionEnabled"
  | "companionForceLocal";

export type SpeakerMatchKey =
  | "speakerMatchThreshold"
  | "speakerMatchMargin"
  | "speakerClusterThreshold"
  | "speakerConversationMatchThreshold";

export type TrainingState = {
  status: "new" | "preparing" | "training" | "stopping" | "ready" | "failed";
  stage: string;
  message: string;
  epoch: number;
  totalEpochs: number;
  error: string;
  hasBundle: boolean;
  complete: boolean;
  startedAt?: string;
  finishedAt?: string;
};

export type TrainingSet = {
  id: string;
  name: string;
  language: string;
  createdAt: string;
  sampleCount: number;
  resumable: boolean;
  samplesChanged: boolean;
  state: TrainingState;
};

export type TrainingStatus = {
  trainingMode: boolean;
  installed: boolean;
  sets: TrainingSet[];
};
