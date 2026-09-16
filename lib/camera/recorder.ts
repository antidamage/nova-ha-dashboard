/**
 * Camera recorder — facade. The body lives in lib/camera/recorder/; this file
 * keeps the import path stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 *   recorder/types.ts        CameraDeviceState, RecorderState, RecorderStatus
 *   recorder/constants.ts    restart, retention and self-heal timings
 *   recorder/store.ts        SOLE owner of globalThis state: registry, pause flag
 *   recorder/host.ts         ffmpeg binary, device probes, source, stray reaper
 *   recorder/ffmpeg-args.ts  the ffmpeg argument list
 *   recorder/segments.ts     purge, retention sweep, serving recording files
 *   recorder/spawn.ts        spawning an encoder, exit classification, backoff
 *   recorder/supervise.ts    self-heal supervisor, stop/respawn
 *   recorder/lifecycle.ts    pause, ensure, stop, restart
 *   recorder/status.ts       recorderStatus
 */
export type { CameraDeviceState, RecorderStatus } from "./recorder/types";
export { recordersPaused } from "./recorder/store";
export { ffmpegArgs } from "./recorder/ffmpeg-args";
export { isRecordingFilename, readRecordingFile } from "./recorder/segments";
export { ensureRecorder, restartRecorder, setRecordersPaused, stopRecorder } from "./recorder/lifecycle";
export { recorderStatus } from "./recorder/status";
