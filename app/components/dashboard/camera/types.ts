export type CameraSource = "device" | "demo-clock";

export type CameraStatus = {
  source: CameraSource;
  recording: boolean;
  ffmpegAvailable: boolean;
  deviceConnected: boolean;
  retentionSeconds: number;
  oldestSegment: string | null;
  newestSegment: string | null;
  lastError: string | null;
};

export type SnapshotMeta = {
  id: string;
  createdAt: string;
  durationSeconds: number;
  sizeBytes: number;
  segmentCount: number;
};

export type Hls = import("hls.js").default;

export type CameraEvent = {
  id: string;
  cameraId: string;
  startedAt: string;
  endedAt: string | null;
  status: "collecting" | "queued" | "analysing" | "analysed" | "analysis_failed";
  priority: "routine" | "important" | "urgent";
  title: string;
  summary: string;
  zones: string[];
  labels: string[];
  subjects: Array<{ class: string; confidence: number; zone: string; box: number[]; identity?: string; identityConfidence?: number; identityTentative?: boolean }>;
  thumbnailUrl: string | null;
  clipUrl: string | null;
  reviewed: boolean;
  starred: boolean;
  alertState: string;
  detailError?: string | null;
  retainedReason?: string | null;
  alertReason?: string | null;
  behaviorConfidence?: number | null;
  ownerPresent?: boolean;
  policyVersion?: number | null;
};

export type AnalysisStatus = {
  ok: boolean;
  backlogSeconds: number;
  queueDepth: number;
  detectorError?: string | null;
  detailError?: string | null;
  policyConfigured?: boolean;
  policyVersion?: number;
};
