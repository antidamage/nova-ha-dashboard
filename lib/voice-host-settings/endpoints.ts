// Where the voice server lives. Named for the ROLE, not for whichever machine
// currently fills it: the same build must run against any host configured for
// it (specs/maintenance-rule.md). `NOVA_VOICE_IRIDIUM_URL` is the previous, machine-named
// spelling and is still honoured so existing deployments keep working — new
// installs should set NOVA_VOICE_HOST_URL.
const DEFAULT_VOICE_HOST_URL = "https://voice-server.local:8766";

function configuredVoiceHostUrl(): string {
  return (
    process.env.NOVA_VOICE_HOST_URL?.trim() ||
    process.env.NOVA_VOICE_IRIDIUM_URL?.trim() ||
    DEFAULT_VOICE_HOST_URL
  );
}
const REFRESH_PATH = "/v1/settings/refresh";
export const VOICES_PATH = "/v1/voices";
export const PREVIEW_PATH = "/v1/voices/preview";
export const HEALTH_PATH = "/health";
// The monitor snapshot is the server's live satellite registry. A high cursor
// skips the event backlog; only the `satellites` array matters here.
export const SATELLITES_PATH = "/v1/monitor/events?after=1000000000";
export const SPEAKER_PROFILES_PATH = "/v1/speaker-profiles";
export const CLASSIFY_ICON_PATH = "/v1/classify-icon";
export const REQUEST_TIMEOUT_MS = 5_000;
// Synthesis is slower than a plain status round trip (model inference, and a
// cold voice can take a couple of seconds), so the preview gets its own budget.
export const PREVIEW_TIMEOUT_MS = 30_000;
// Building/uploading a voice can be slow -- ffmpeg over sample clips (Custom)
// or a multi-file checkpoint bundle (Trained) -- over a home network.
export const ENGINE_VOICE_BUILD_TIMEOUT_MS = 60_000;

export function voiceHostUrl(path: string) {
  const baseUrl = configuredVoiceHostUrl();
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

// Voice training runs on its own port, served by a process that holds no models
// and is not stopped when a training run takes the GPU. Pointing training at the
// voice API meant a run switched off its own control surface: progress froze at
// the last successful poll and Stop returned a connection error while the run
// carried on. Derived from the voice URL so a deployment configures one host.
const TRAINING_PORT = process.env.NOVA_VOICE_TRAINING_PORT?.trim() || "8097";

export function trainingUrl(path: string) {
  const base = new URL(
    "/",
    (configuredVoiceHostUrl()).replace(/\/$/, "") + "/",
  );
  base.port = TRAINING_PORT;
  return new URL(path, base);
}

export function refreshUrl() {
  return voiceHostUrl(REFRESH_PATH);
}

/** The configured voice host base URL (e.g. https://voice-server.local:8766). */
export function voiceHostBaseUrl(): string {
  return configuredVoiceHostUrl();
}

// Display label for status UIs: the configured voice-server host, never a
// machine name hard-coded by a caller.
export function voiceHostLabel(): string {
  try {
    return voiceHostUrl("/").host;
  } catch {
    return "voice server";
  }
}
