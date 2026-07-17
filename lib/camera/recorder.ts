import { spawn, type ChildProcess } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import { mkdir, readdir, readFile, stat, unlink } from "fs/promises";
import path from "path";
import { readDashboardConfigSync } from "../dashboard-config";
import {
  cameraDir,
  PLAYLIST_FILENAME,
  retentionSeconds,
  SEGMENT_PREFIX,
  type CameraConfig,
  type CameraSource,
} from "./config";

/**
 * One long-lived ffmpeg process per camera writes a rolling HLS window to disk.
 * This module owns the lifecycle: lazy start, auto-restart with backoff, retention
 * sweeping and a small status surface. It is deliberately a process-wide singleton
 * (Next dev/hot-reload re-imports modules, so the registry is stashed on
 * `globalThis`) to guarantee we never spawn two encoders for the same device.
 */

const FFMPEG_BIN = process.env.NOVA_FFMPEG_PATH?.trim() || "ffmpeg";
// The encoder is a background job that must never starve the dashboard server or
// the on-box kiosk browser — when it did, the kiosk's health check stalled and
// falsely flashed the "Reconnecting to Nova" offline overlay. On Linux we launch
// ffmpeg at a low CPU priority so the scheduler always preempts it in favour of
// the UI. `nice`/`chrt` exec ffmpeg, so the spawned child is still ffmpeg itself
// (same pid, signals and stderr intact). Tunable via NOVA_FFMPEG_NICE (0 = off).
const FFMPEG_NICE = normalizeFfmpegNice(process.env.NOVA_FFMPEG_NICE);

function normalizeFfmpegNice(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return 19; // default: lowest-priority background encode
  }
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(19, Math.round(value))) : 19;
}

/**
 * Command + leading args used to launch the encoder. On Linux we prefix `nice`
 * (coreutils, always present) so the encode yields to the dashboard/browser
 * under contention. Off-Linux (dev) or when disabled we run ffmpeg directly.
 */
function ffmpegLaunchPrefix(): string[] {
  if (process.platform === "linux" && FFMPEG_NICE > 0) {
    return ["nice", "-n", String(FFMPEG_NICE), FFMPEG_BIN];
  }
  return [FFMPEG_BIN];
}

const RESTART_MIN_DELAY_MS = 1000;
const RESTART_MAX_DELAY_MS = 15000;
const RETENTION_SWEEP_MS = 60 * 1000;
// The self-heal supervisor cadence. It re-resolves the source (demo-clock ->
// real device once the device reappears), detects a "burst-then-stall" device
// (ffmpeg alive but no fresh segments), and clears a stale lastError once the
// current generation is confirmed healthy.
const SUPERVISE_MS = 8 * 1000;
// A freshly (re)spawned encoder needs a moment before its first segment lands;
// don't judge it stalled inside this warmup.
const WARMUP_MS = 20 * 1000;
// A running device encoder that hasn't written a segment in this long is wedged
// (the classic MS2109 burst-then-stall keeps ffmpeg alive with zero output).
const STALL_MS = 25 * 1000;
// Don't thrash the demo->device re-resolve or stall-restart faster than this.
const SELF_HEAL_MIN_INTERVAL_MS = 20 * 1000;
// Segments this fresh (ms) mean the current encoder is genuinely healthy.
const FRESH_SEGMENT_MS = STALL_MS;

/**
 * Classified, human-answerable "why is (or isn't) the camera working" state.
 * Surfaced in the status API so the watchdog, the config UI and a human can all
 * tell WHEN and WHY the feed stopped, not just that it did.
 */
export type CameraDeviceState =
  | "streaming" // encoding the real device, fresh segments — all good
  | "starting" // encoder (re)launched, within warmup, no segment yet
  | "demo-fallback" // on the synthetic clock because the device isn't usable
  | "device-absent" // configured device path is missing (unplugged / not enumerated)
  | "device-busy" // device is held by another opener (EBUSY)
  | "device-stalled" // encoder alive on the device but segments stopped (hardware wedge)
  | "device-error" // encoder exited with an error we couldn't classify
  | "paused" // recorder intentionally paused (update / watchdog device surgery)
  | "stopped" // not recording and nothing scheduled
  | "unavailable"; // no ffmpeg binary on this host

type RecorderState = {
  camera: CameraConfig;
  source: CameraSource;
  child: ChildProcess | null;
  startedAt: number;
  restarts: number;
  restartTimer: NodeJS.Timeout | null;
  sweepTimer: NodeJS.Timeout | null;
  superviseTimer: NodeJS.Timeout | null;
  stopped: boolean;
  lastError: string | null;
  // Classified state + counters for the status surface and self-heal.
  deviceState: CameraDeviceState;
  statusReason: string;
  lastHealthyAt: number | null;
  lastStallAt: number | null;
  consecutiveStalls: number;
  lastSelfHealAt: number;
  // Guards against overlapping stop/spawn (the source of the "device busy" race).
  transitioning: boolean;
};

type RecorderRegistry = Map<string, RecorderState>;

const GLOBAL_KEY = "__novaCameraRecorders__";
const PAUSED_KEY = "__novaCameraRecordersPaused__";

function registry(): RecorderRegistry {
  const globalRef = globalThis as unknown as Record<string, RecorderRegistry | undefined>;
  if (!globalRef[GLOBAL_KEY]) {
    globalRef[GLOBAL_KEY] = new Map();
  }
  return globalRef[GLOBAL_KEY]!;
}

function pausedRef(): { paused: boolean } {
  const globalRef = globalThis as unknown as Record<string, { paused: boolean } | undefined>;
  if (!globalRef[PAUSED_KEY]) {
    globalRef[PAUSED_KEY] = { paused: false };
  }
  return globalRef[PAUSED_KEY]!;
}

export function recordersPaused(): boolean {
  return pausedRef().paused;
}

/**
 * Pause switch used while the host updater is building/switching a release:
 * encoding competes with the on-box build for CPU. Pausing stops every active
 * recorder, and while paused `ensureRecorder` refuses to start new ones — the
 * camera routes call it on every status/segment request, so without the gate
 * an open dashboard panel would restart the feed mid-update. Resuming only
 * clears the flag; callers restart cameras explicitly via `ensureRecorder`.
 */
export function setRecordersPaused(paused: boolean) {
  const ref = pausedRef();
  if (ref.paused === paused) {
    return;
  }
  ref.paused = paused;
  if (paused) {
    for (const id of registry().keys()) {
      stopRecorder(id);
    }
  }
}

function ffmpegAvailable() {
  // `spawn` would throw asynchronously; a cheap existence check keeps the demo
  // build and ffmpeg-less hosts from crash-looping. Absolute paths are checked
  // directly, bare command names are assumed present on PATH.
  if (FFMPEG_BIN.includes("/") || FFMPEG_BIN.includes("\\")) {
    return existsSync(FFMPEG_BIN);
  }
  return true;
}

function deviceAvailable(camera: CameraConfig) {
  return Boolean(camera.devicePath) && existsSync(camera.devicePath);
}

/**
 * Config master-switch for camera ingestion. When the Outside camera is disabled
 * in the config panel, NO ffmpeg runs — not the real capture, not the demo-clock
 * test pattern — so the box sheds that CPU. Only the Outside camera is
 * config-driven today; anything else defaults on. Fails safe (on) if the config
 * can't be read.
 */
function cameraIngestionEnabled(camera: CameraConfig): boolean {
  if (camera.id !== "outside") {
    return true;
  }
  try {
    return readDashboardConfigSync().dashboard.camera.outside.ingestionEnabled !== false;
  } catch {
    return true;
  }
}

/**
 * The demo clock overlay uses ffmpeg's `drawtext`, which needs a real font file
 * (we point at one explicitly so it works even on hosts without fontconfig, e.g.
 * Windows dev boxes). Resolves an env override, then common per-platform fonts.
 */
function resolveFontFile(): string | null {
  const override = process.env.NOVA_CAMERA_FONT?.trim();
  const candidates = override
    ? [override]
    : process.platform === "win32"
      ? ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cour.ttf", "C:/Windows/Fonts/arial.ttf"]
      : process.platform === "darwin"
        ? ["/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/SFNSMono.ttf", "/Library/Fonts/Arial.ttf"]
        : [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
          ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Escape a path for use inside a single-quoted ffmpeg `drawtext` value. */
function drawtextFontfile(fontPath: string): string {
  // ffmpeg's drawtext wants native backslash separators on Windows; then the
  // drive colon and backslashes themselves must be escaped for the filtergraph.
  const normalized = process.platform === "win32" ? fontPath.replace(/\//g, "\\") : fontPath;
  return normalized.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function resolveSource(camera: CameraConfig): CameraSource {
  return deviceAvailable(camera) ? "device" : "demo-clock";
}

/**
 * Linux-only, dependency-free reap of orphaned encoders. Scans /proc for any
 * ffmpeg still writing THIS camera's playlist and SIGKILLs it. We can only see
 * and signal processes in our own PID namespace — which is exactly where the
 * recorder's ffmpeg children live — so it reliably reaches a stray that a lost
 * reference left running. No-op off Linux (dev) and when nothing matches.
 *
 * This is the safety net for the "two encoders, one playlist" failure: if a
 * settle-gap double-spawn (or any generation change) ever orphans an encoder,
 * that orphan is otherwise never killed and interleaves its frames — e.g. a
 * demo-clock encoder clobbering the real device feed with the test pattern.
 */
function reapStrayEncoders(camera: CameraConfig): void {
  if (process.platform !== "linux") {
    return;
  }
  const needle = path.join(cameraDir(camera), PLAYLIST_FILENAME);
  let pids: string[];
  try {
    pids = readdirSync("/proc");
  } catch {
    return;
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) {
      continue;
    }
    const numeric = Number(pid);
    if (numeric === process.pid) {
      continue;
    }
    let cmdline: string;
    try {
      // /proc/<pid>/cmdline is NUL-separated argv; the playlist path is its own
      // argument, so a plain substring match on it is exact enough.
      cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    } catch {
      continue; // process vanished or unreadable
    }
    if (cmdline.includes("ffmpeg") && cmdline.includes(needle)) {
      try {
        process.kill(numeric, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

function optionalInputOption(name: string, value: string): string[] {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "auto" || normalized === "none" || normalized === "off"
    ? []
    : [name, value.trim()];
}

function deviceVideoFilters(camera: CameraConfig): string[] {
  const filters: string[] = [];
  if (camera.brightness !== 0 || camera.contrast !== 1) {
    filters.push(`eq=brightness=${camera.brightness}:contrast=${camera.contrast}`);
  }
  if (camera.sharpness !== 0) {
    filters.push(`unsharp=5:5:${camera.sharpness}:5:5:0`);
  }
  return filters;
}

function withDashboardProcessing(camera: CameraConfig): CameraConfig {
  try {
    const processing = readDashboardConfigSync().dashboard.camera.outside.processing;
    return { ...camera, ...processing };
  } catch {
    return camera;
  }
}

/**
 * Build the ffmpeg argument list. Input is either the real capture device (an
 * MS2109 HDMI->USB grabber on nova) or a synthetic "time counting up" clock (on
 * any host without the device). The output half is identical for both so the DVR,
 * scrubbing and Live behaviour are exercised even by the placeholder.
 *
 * `frameSize`/`pixelFormat`/`videoStandard` are all optional inputs: set any to
 * "auto"/"none"/"" to omit it and let ffmpeg negotiate the device's current
 * format. That keeps capture working if a future source needs a resolution we
 * didn't pin (the MS2109 itself scales, so pinning 1080p is normally fine).
 *
 * `generationId` (the spawn time, base-36) namespaces this encoder generation's
 * segment filenames. Names must never repeat across generations: the segment
 * route serves them as immutable/cacheable, so a reused name (e.g. numbering
 * restarting at 000000 after a purge) would let a browser splice a stale cached
 * segment — a frame of a previous demo-clock run — into the live feed.
 */
export function ffmpegArgs(
  camera: CameraConfig,
  source: CameraSource,
  generationId: string = Date.now().toString(36),
): string[] {
  const dir = cameraDir(camera);
  const playlist = path.join(dir, PLAYLIST_FILENAME);
  const segmentPattern = path.join(dir, `${SEGMENT_PREFIX}_${generationId}_%06d.ts`);
  const window = retentionSeconds(camera);
  const listSize = Math.max(3, Math.ceil(window / camera.segmentSeconds));
  // Emit at most `encodeFrameRate` frames per second to the encoder. 0 (or a value
  // >= the capture rate) means "encode every captured frame". The GOP is aligned
  // to the *output* rate so a keyframe still lands on every segment boundary.
  const outFrameRate =
    camera.encodeFrameRate > 0 && camera.encodeFrameRate < camera.frameRate
      ? camera.encodeFrameRate
      : camera.frameRate;
  const gop = Math.max(1, Math.round(outFrameRate * camera.segmentSeconds));

  const input: string[] =
    source === "device"
      ? [
          "-f", camera.inputFormat,
          ...optionalInputOption("-input_format", camera.pixelFormat),
          ...optionalInputOption("-standard", camera.videoStandard),
          ...optionalInputOption("-video_size", camera.frameSize),
          "-framerate", String(camera.frameRate),
          "-i", camera.devicePath,
        ]
      : [
          // Synthetic placeholder: smooth test pattern + a large live clock so the
          // feed visibly "counts up" and reads as live. Fall back to a concrete
          // size if frameSize is "auto" (only meaningful for a real device).
          // Lavfi produces frames as fast as the encoder accepts them unless the
          // input is explicitly paced, which creates a DVR window dated hours in
          // the future and makes the player chase an impossible live edge.
          "-re",
          "-f", "lavfi",
          "-i", `testsrc2=size=${/^\d+x\d+$/.test(camera.frameSize) ? camera.frameSize : "1280x720"}:rate=${camera.frameRate}`,
          "-f", "lavfi",
          "-i", "sine=frequency=440:sample_rate=48000",
        ];

  // Synthetic "time counting up" overlay. Needs a font; if none is found we fall
  // back to the bare (still animated, still live) test pattern so recording — and
  // therefore the whole DVR/scrubbing/Live path — keeps working regardless.
  const fontFile = source === "demo-clock" ? resolveFontFile() : null;
  const clockOverlay =
    source === "demo-clock" && fontFile
      ? [
          "drawbox=x=0:y=ih-90:w=iw:h=90:color=black@0.55:t=fill",
          `drawtext=fontfile='${drawtextFontfile(fontFile)}':fontcolor=white:fontsize=46:x=24:y=H-72:` +
            "text='OUTSIDE  %{localtime\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}'",
        ]
      : [];
  const baseFilters = source === "device" ? deviceVideoFilters(camera) : clockOverlay;
  // Drop frames before the encoder when downsampling so the encoder does
  // proportionally less work; keep the chain untouched when there is no cap.
  const cappedFilters =
    outFrameRate < camera.frameRate ? [...baseFilters, `fps=${outFrameRate}`] : baseFilters;

  const useVaapi = camera.encoder === "vaapi";
  // Full-GPU path: hardware-decode the capture stream and hand the encoder frames
  // that are already on the GPU, so the CPU does almost nothing. Only possible when
  // no CPU-side filter is required — an `fps` cap runs on GPU surfaces, but the
  // eq/unsharp/drawtext filters (baseFilters) need frames in system memory.
  const hwDecode = useVaapi && camera.hwaccel === "vaapi" && baseFilters.length === 0;

  // hw-decode already establishes a device context from the decoder; the CPU-decode
  // path instead needs an explicit filter device to receive the uploaded frames.
  const hwaccelInput = hwDecode
    ? ["-hwaccel", "vaapi", "-hwaccel_device", camera.vaapiDevice, "-hwaccel_output_format", "vaapi"]
    : [];
  const hwDevice = useVaapi && !hwDecode
    ? ["-init_hw_device", `vaapi=va:${camera.vaapiDevice}`, "-filter_hw_device", "va"]
    : [];

  // VAAPI encodes on the GPU. Full-GPU: keep the (GPU-resident) frames as-is. CPU
  // decode: end the chain by converting to NV12 and uploading each frame so
  // `h264_vaapi` can consume it. Software x264 keeps the plain chain.
  let videoFilters: string[];
  if (!useVaapi) {
    videoFilters = cappedFilters;
  } else if (hwDecode) {
    // Frames are already GPU surfaces from the decoder. Normalise them to NV12 on
    // the GPU (VPP): MJPEG captures are commonly 4:2:2, which h264_vaapi refuses —
    // scale_vaapi converts to the 4:2:0 NV12 the encoder needs without a CPU round
    // trip.
    videoFilters = [...cappedFilters, "scale_vaapi=format=nv12"];
  } else {
    videoFilters = [...cappedFilters, "format=nv12", "hwupload"];
  }

  const encoder = useVaapi
    ? ["-c:v", "h264_vaapi", "-rc_mode", "CQP", "-qp", String(camera.vaapiQp)]
    : [
        "-c:v", "libx264",
        "-preset", camera.encoderPreset,
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-sc_threshold", "0",
      ];

  return [
    "-hide_banner",
    "-loglevel", "warning",
    "-fflags", "+genpts",
    ...hwDevice,
    ...hwaccelInput,
    ...input,
    ...(videoFilters.length ? ["-vf", videoFilters.join(",")] : []),
    "-an",
    ...encoder,
    "-g", String(gop),
    "-keyint_min", String(gop),
    "-f", "hls",
    "-hls_time", String(camera.segmentSeconds),
    "-hls_list_size", String(listSize),
    // `append_list` keeps the DVR window alive across encoder restarts;
    // `discont_start` marks the first appended segment with EXT-X-DISCONTINUITY
    // so the player resets its timestamp mapping at the generation boundary.
    // Without it the new generation's PTS (restarting near 0) overlapped the
    // previous generation's buffered frames and the splice flashed stale
    // content — a frame of the old demo clock — instead of cutting cleanly.
    "-hls_flags", "delete_segments+append_list+program_date_time+omit_endlist+discont_start",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", segmentPattern,
    "-hls_allow_cache", "0",
    playlist,
  ];
}

function backoffDelay(restarts: number) {
  return Math.min(RESTART_MIN_DELAY_MS * 2 ** Math.min(restarts, 5), RESTART_MAX_DELAY_MS);
}

/** Delete segments + the playlist so a restart never appends onto stale media. */
async function purgeRecordingDir(camera: CameraConfig) {
  const dir = cameraDir(camera);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.allSettled(
    entries
      .filter((name) => name.endsWith(".ts") || name === PLAYLIST_FILENAME || name.endsWith(".m3u8.tmp"))
      .map((name) => unlink(path.join(dir, name))),
  );
}

/**
 * Defence-in-depth retention: ffmpeg already deletes rolled-off segments, but a
 * sweep removes anything ffmpeg orphaned (e.g. after an unclean exit) so the
 * "never older than two hours" guarantee holds even across crashes.
 */
async function sweepRetention(camera: CameraConfig) {
  const dir = cameraDir(camera);
  const maxAgeMs = (retentionSeconds(camera) + camera.segmentSeconds * 4) * 1000;
  const cutoff = Date.now() - maxAgeMs;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.allSettled(
    entries
      .filter((name) => name.endsWith(".ts"))
      .map(async (name) => {
        const filePath = path.join(dir, name);
        try {
          const info = await stat(filePath);
          if (info.mtimeMs < cutoff) {
            await unlink(filePath);
          }
        } catch {
          /* file already gone */
        }
      }),
  );
}

function classifyExit(stderrTail: string): CameraDeviceState {
  const err = stderrTail.toLowerCase();
  if (err.includes("resource busy") || err.includes("device busy")) {
    return "device-busy";
  }
  if (err.includes("no such file") || err.includes("no such device") || err.includes("cannot open")) {
    return "device-absent";
  }
  return "device-error";
}

function spawnFfmpeg(state: RecorderState) {
  const camera = withDashboardProcessing(state.camera);
  // Exactly one encoder per camera. spawnFfmpeg is the only place an encoder is
  // created, so enforcing the invariant here covers every path (cold start,
  // scheduled restart, respawn/reset). Kill the currently-tracked child, then —
  // belt and braces — reap any orphan from a previous generation still writing
  // this playlist, so a (re)start never has to compete with a stale encoder.
  if (state.child) {
    try {
      state.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    state.child = null;
  }
  reapStrayEncoders(camera);
  const source = resolveSource(camera);
  state.source = source;
  const [launchBin, ...launchPrefixArgs] = ffmpegLaunchPrefix();
  const child = spawn(launchBin, [...launchPrefixArgs, ...ffmpegArgs(camera, source)], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  state.child = child;
  state.startedAt = Date.now();
  // Fresh generation: clear any error carried over from a prior ffmpeg so a
  // successful restart immediately reports healthy again.
  state.lastError = null;
  state.deviceState = source === "device" ? "starting" : "demo-fallback";
  state.statusReason =
    source === "device" ? "encoder starting on the capture device" : "running the synthetic clock (device not usable)";

  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });

  child.on("error", (error) => {
    if (state.child === child) {
      state.child = null;
    }
    if (!state.stopped) {
      state.lastError = error.message;
      state.deviceState = "device-error";
      state.statusReason = `failed to launch encoder: ${error.message}`;
      scheduleRestart(state);
    }
  });

  child.on("exit", (code, signal) => {
    // Ignore the exit of a child we've already replaced (avoids a late exit from
    // an old generation clobbering the current one's state).
    if (state.child === child) {
      state.child = null;
    }
    // A deliberate stop (stopRecorder/pause) SIGTERM/SIGKILLs ffmpeg, which
    // exits 255 — that is not a fault. Recording it as lastError made the
    // camera watchdog read a freshly-restarted, healthy recorder as unhealthy
    // ("ffmpeg error") and loop on recovery forever.
    if (code && code !== 0 && !state.stopped) {
      const line = stderrTail.trim().split("\n").pop() ?? "";
      state.lastError = `ffmpeg exited (code ${code}${signal ? `, ${signal}` : ""}): ${line}`;
      // Only downgrade the classified state if this exit belongs to the live
      // generation; a busy/absent classification tells the UI + watchdog why.
      if (source === "device") {
        state.deviceState = classifyExit(stderrTail);
        state.statusReason = state.lastError;
      }
    }
    if (!state.stopped) {
      scheduleRestart(state);
    }
  });
}

function scheduleRestart(state: RecorderState) {
  if (state.stopped || state.restartTimer) {
    return;
  }
  const delay = backoffDelay(state.restarts);
  state.restarts += 1;
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    if (!state.stopped) {
      spawnFfmpeg(state);
    }
  }, delay);
}

/** Newest .ts segment mtime (ms) for this camera, or null if none. */
async function newestSegmentMs(camera: CameraConfig): Promise<number | null> {
  try {
    const dir = cameraDir(camera);
    const entries = (await readdir(dir)).filter((name) => name.endsWith(".ts"));
    const mtimes = await Promise.all(
      entries.map(async (name) => {
        try {
          return (await stat(path.join(dir, name))).mtimeMs;
        } catch {
          return null;
        }
      }),
    );
    let newest: number | null = null;
    for (const m of mtimes) {
      if (m !== null) {
        newest = newest === null ? m : Math.max(newest, m);
      }
    }
    return newest;
  } catch {
    return null;
  }
}

/**
 * Periodic self-heal. Runs while the recorder is active (not paused/stopped)
 * and, without ever touching the dashboard container:
 *   - clears a stale lastError once the current encoder is confirmed healthy
 *     (fresh segments) — otherwise a historical blip keeps reading as unhealthy;
 *   - re-resolves the source: if we're on the synthetic clock but the real
 *     device has since reappeared, respawn on the device (this is exactly the
 *     "device replugged but feed still shows the test pattern" case);
 *   - detects a burst-then-stall device (encoder alive on the device but no new
 *     segment for STALL_MS) and respawns it, counting consecutive stalls so the
 *     status surface can say the device is wedged.
 */
async function superviseRecorder(state: RecorderState) {
  if (state.stopped || pausedRef().paused || state.transitioning) {
    return;
  }
  const now = Date.now();
  const newest = await newestSegmentMs(state.camera);
  const segFresh = newest !== null && now - newest < FRESH_SEGMENT_MS;
  const deviceHere = deviceAvailable(withDashboardProcessing(state.camera));

  // Confirmed healthy: fresh segments from the current generation.
  //
  // The synthetic clock is a special case: it is ALWAYS "healthy" (testsrc2
  // never fails), so if we treated a fresh demo-clock as done we would latch
  // onto the placeholder forever and never notice the real device sitting right
  // there — the "reset only ever shows the test stream" bug. So a healthy demo
  // clock only counts as done while the device is genuinely unavailable; when
  // the device is present we fall through to the demo->device switch below and
  // go live.
  if (state.child && segFresh && (state.source === "device" || !deviceHere)) {
    state.lastError = null;
    state.consecutiveStalls = 0;
    state.lastHealthyAt = now;
    state.deviceState = state.source === "device" ? "streaming" : "demo-fallback";
    state.statusReason = state.source === "device" ? "streaming the capture device" : "running the synthetic clock";
    return;
  }

  // Don't self-heal during warmup or too frequently.
  const warming = now - state.startedAt < WARMUP_MS;
  const cooled = now - state.lastSelfHealAt > SELF_HEAL_MIN_INTERVAL_MS;

  // On the synthetic clock while the real device is now available -> switch.
  if (state.source !== "device" && deviceHere && cooled) {
    state.lastSelfHealAt = now;
    state.statusReason = "device reappeared — switching off the synthetic clock";
    await respawn(state);
    return;
  }

  // Encoder alive on the device but no fresh segments past warmup -> wedged.
  if (state.child && state.source === "device" && !segFresh && !warming && cooled) {
    state.lastSelfHealAt = now;
    state.lastStallAt = now;
    state.consecutiveStalls += 1;
    state.deviceState = "device-stalled";
    state.statusReason = `no new segment for ${Math.round((now - (newest ?? state.startedAt)) / 1000)}s (device wedged); restarting encoder`;
    await respawn(state);
  }
}

/** Stop the current child (SIGTERM -> SIGKILL) and resolve once it has exited,
 * so the capture device is actually released before the next spawn. */
function stopChild(state: RecorderState): Promise<void> {
  const child = state.child;
  state.child = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve();
    };
    // Frameless-v4l2-read ffmpeg ignores SIGTERM; escalate to SIGKILL, then a
    // hard resolve so a stuck child can never wedge a restart forever.
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      setTimeout(finish, 1500);
    }, 4000);
    killer.unref?.();
    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
    }
  });
}

/** Race-free restart of the current recorder's encoder: fully stop (await the
 * device release) then spawn a fresh one. Serialized via `transitioning` so two
 * callers can't spawn overlapping encoders that fight over the device (the
 * source of the intermittent "Device or resource busy" / code-240 errors). */
async function respawn(state: RecorderState): Promise<void> {
  if (state.transitioning) {
    return;
  }
  state.transitioning = true;
  try {
    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
      state.restartTimer = null;
    }
    await stopChild(state);
    // Small settle: the kernel can hold the v4l2 device briefly after ffmpeg exits.
    await new Promise((r) => setTimeout(r, 400));
    if (!state.stopped && !pausedRef().paused) {
      state.restarts = 0;
      spawnFfmpeg(state);
    }
  } finally {
    state.transitioning = false;
  }
}

function newRecorderState(camera: CameraConfig): RecorderState {
  return {
    camera,
    source: resolveSource(camera),
    child: null,
    startedAt: 0,
    restarts: 0,
    restartTimer: null,
    sweepTimer: null,
    superviseTimer: null,
    stopped: false,
    lastError: null,
    deviceState: "stopped",
    statusReason: "not started",
    lastHealthyAt: null,
    lastStallAt: null,
    consecutiveStalls: 0,
    lastSelfHealAt: 0,
    transitioning: false,
  };
}

/**
 * Ensure a recorder is running for this camera. Safe to call on every request;
 * it no-ops once the encoder is live. Returns false when recording is impossible
 * (no ffmpeg) so callers can fall back to the client-side placeholder.
 */
export async function ensureRecorder(camera: CameraConfig): Promise<boolean> {
  if (!ffmpegAvailable() || pausedRef().paused) {
    return false;
  }
  // Config-disabled camera: make sure nothing is running (incl. the test pattern)
  // and refuse to start. Called on every status/segment request, so this both
  // enforces the off state and tears down a recorder the moment the flag flips.
  if (!cameraIngestionEnabled(camera)) {
    stopRecorder(camera.id);
    return false;
  }

  const existing = registry().get(camera.id);
  // Already running — or a restart/respawn is mid-flight. The `transitioning`
  // check is essential: `respawn` nulls state.child during its stop→settle→spawn
  // window, and this route is called on EVERY HLS segment/status request. Without
  // it, one of those concurrent calls slips through and spawns a SECOND encoder
  // that then clobbers the same playlist — the "stuck on the test pattern while
  // the device is also encoding" bug.
  if (
    existing &&
    !existing.stopped &&
    (existing.child || existing.restartTimer || existing.transitioning)
  ) {
    return true;
  }

  const state: RecorderState = existing ?? newRecorderState(camera);
  state.camera = camera;
  state.stopped = false;
  // Reserve synchronously, before the first await, so a concurrent ensureRecorder
  // (or the supervisor's respawn) sees the transition at the guard above and
  // bails instead of double-spawning.
  state.transitioning = true;
  registry().set(camera.id, state);

  try {
    const dir = cameraDir(camera);
    await mkdir(dir, { recursive: true });
    await purgeRecordingDir(camera);

    if (!state.sweepTimer) {
      state.sweepTimer = setInterval(() => {
        void sweepRetention(camera);
      }, RETENTION_SWEEP_MS);
      // Don't keep the event loop alive solely for the sweep.
      state.sweepTimer.unref?.();
    }

    if (!state.superviseTimer) {
      state.superviseTimer = setInterval(() => {
        void superviseRecorder(state).catch(() => undefined);
      }, SUPERVISE_MS);
      state.superviseTimer.unref?.();
    }

    spawnFfmpeg(state);
  } finally {
    state.transitioning = false;
  }
  return true;
}

export function stopRecorder(cameraId: string) {
  const state = registry().get(cameraId);
  if (!state) {
    return;
  }
  state.stopped = true;
  state.deviceState = "stopped";
  state.statusReason = "recorder stopped";
  if (state.restartTimer) {
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }
  if (state.sweepTimer) {
    clearInterval(state.sweepTimer);
    state.sweepTimer = null;
  }
  if (state.superviseTimer) {
    clearInterval(state.superviseTimer);
    state.superviseTimer = null;
  }
  const child = state.child;
  state.child = null;
  if (child) {
    child.kill("SIGTERM");
    // An ffmpeg blocked on a frameless v4l2 read ignores SIGTERM and keeps the
    // capture device open forever, which starves both the next recorder and the
    // watchdog's free-device probe. Escalate so a stop always releases the
    // device.
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 4000);
    killer.unref?.();
    child.once("exit", () => clearTimeout(killer));
  }
}

/**
 * Restart the encoder in place, race-free: stop the current one, wait for the
 * device to be released, then spawn a fresh encoder (which re-resolves the
 * source, so a returned device is picked up). The dashboard container is never
 * touched. Used by the recorder-control API and the camera re-init flow.
 */
export async function restartRecorder(camera: CameraConfig): Promise<boolean> {
  if (!ffmpegAvailable()) {
    return false;
  }
  if (!cameraIngestionEnabled(camera)) {
    stopRecorder(camera.id);
    return false;
  }
  setRecordersPaused(false);
  const existing = registry().get(camera.id);
  if (!existing || existing.stopped) {
    return ensureRecorder(camera);
  }
  existing.camera = camera;
  if (!existing.superviseTimer) {
    existing.superviseTimer = setInterval(() => {
      void superviseRecorder(existing).catch(() => undefined);
    }, SUPERVISE_MS);
    existing.superviseTimer.unref?.();
  }
  await respawn(existing);
  return true;
}

export type RecorderStatus = {
  id: string;
  name: string;
  source: CameraSource;
  recording: boolean;
  ffmpegAvailable: boolean;
  deviceConnected: boolean;
  retentionSeconds: number;
  segmentSeconds: number;
  /** Wall-clock of the oldest still-available segment, if any. */
  oldestSegment: string | null;
  /** Wall-clock of the newest (live edge) segment, if any. */
  newestSegment: string | null;
  lastError: string | null;
  /** Classified "what state is the capture in" — see CameraDeviceState. */
  deviceState: CameraDeviceState;
  /** Human-readable "why" behind deviceState (surfaced in the config UI). */
  statusReason: string;
  /** True when the newest segment is fresh enough to call the feed live. */
  healthy: boolean;
  /** Age of the newest segment in seconds, or null if there are none. */
  newestSegmentAgeSeconds: number | null;
  /** How many consecutive stall-restarts the supervisor has done (0 = healthy). */
  consecutiveStalls: number;
  paused: boolean;
};

export async function recorderStatus(camera: CameraConfig): Promise<RecorderStatus> {
  const state = registry().get(camera.id);
  const dir = cameraDir(camera);
  let oldest: number | null = null;
  let newest: number | null = null;
  try {
    const entries = (await readdir(dir)).filter((name) => name.endsWith(".ts"));
    // Stat in one parallel batch. A full DVR window is ~3600 segments and the
    // serial per-file `await` this replaces cost one event-loop turn EACH — on
    // a busy box that made this "lightweight" status route take 20s+, which
    // the camera watchdog read as "dashboard unreachable"/"recovery failed"
    // and answered with escalating restarts.
    const mtimes = await Promise.all(
      entries.map(async (name) => {
        try {
          return (await stat(path.join(dir, name))).mtimeMs;
        } catch {
          return null;
        }
      }),
    );
    for (const mtime of mtimes) {
      if (mtime === null) {
        continue;
      }
      oldest = oldest === null ? mtime : Math.min(oldest, mtime);
      newest = newest === null ? mtime : Math.max(newest, mtime);
    }
  } catch {
    /* no recordings yet */
  }

  const paused = pausedRef().paused;
  const source = state?.source ?? resolveSource(camera);
  const recording = Boolean(state && !state.stopped && (state.child || state.restartTimer));
  const deviceConnected = deviceAvailable(camera);
  const ageMs = newest !== null ? Date.now() - newest : null;
  const healthy = ageMs !== null && ageMs < FRESH_SEGMENT_MS && source === "device";
  const newestSegmentAgeSeconds = ageMs !== null ? Math.round(ageMs / 1000) : null;

  // Derive the classified deviceState/statusReason live from ground truth
  // (segment freshness + source + child liveness), falling back to whatever the
  // encoder lifecycle recorded. Segment freshness is authoritative: a device
  // that is genuinely streaming reads healthy even if a prior blip left an error.
  let deviceState: CameraDeviceState = state?.deviceState ?? (recording ? "starting" : "stopped");
  let statusReason = state?.statusReason ?? "not started";
  if (paused) {
    deviceState = "paused";
    statusReason = "recorder paused (update or device re-initialisation in progress)";
  } else if (!ffmpegAvailable()) {
    deviceState = "unavailable";
    statusReason = "no ffmpeg on this host";
  } else if (!recording) {
    deviceState = "stopped";
    statusReason = "recorder not running";
  } else if (healthy) {
    deviceState = "streaming";
    statusReason = "streaming the capture device";
  } else if (source !== "device") {
    deviceState = deviceConnected ? "starting" : "device-absent";
    statusReason = deviceConnected
      ? "device present — switching off the synthetic clock"
      : "capture device not present (unplugged or not enumerated); showing the synthetic clock";
  } else if (!deviceConnected) {
    deviceState = "device-absent";
    statusReason = "capture device path disappeared (unplugged or USB dropped)";
  }
  // else keep the lifecycle-recorded state (device-busy / device-stalled /
  // device-error / starting), which carries the precise reason.

  return {
    id: camera.id,
    name: camera.name,
    source,
    recording,
    ffmpegAvailable: ffmpegAvailable(),
    deviceConnected,
    retentionSeconds: retentionSeconds(camera),
    segmentSeconds: camera.segmentSeconds,
    oldestSegment: oldest !== null ? new Date(oldest).toISOString() : null,
    newestSegment: newest !== null ? new Date(newest).toISOString() : null,
    lastError: state?.lastError ?? null,
    deviceState,
    statusReason,
    healthy,
    newestSegmentAgeSeconds,
    consecutiveStalls: state?.consecutiveStalls ?? 0,
    paused,
  };
}

/** True only for camera files the HTTP route may serve. */
export function isRecordingFilename(file: string): boolean {
  return file === PLAYLIST_FILENAME || /^seg_(?:[a-z0-9]+_)?\d{6}\.ts$/.test(file);
}

/** Read a playlist or segment, enforcing the retention window for segments. */
export async function readRecordingFile(
  camera: CameraConfig,
  file: string,
): Promise<{ data: Buffer; contentType: string } | { error: "not-found" | "expired" | "invalid" }> {
  // Path-traversal guard: only a bare playlist or segment basename is valid.
  // Current segments include a base-36 encoder-generation id so immutable URLs
  // never collide across restarts; accept the older unscoped form for retained
  // DVR windows created before generation ids were introduced.
  const isPlaylist = file === PLAYLIST_FILENAME;
  const isSegment = !isPlaylist && isRecordingFilename(file);
  if (!isRecordingFilename(file)) {
    return { error: "invalid" };
  }

  const filePath = path.join(cameraDir(camera), file);
  try {
    if (isSegment) {
      const info = await stat(filePath);
      const maxAgeMs = (retentionSeconds(camera) + camera.segmentSeconds * 4) * 1000;
      if (Date.now() - info.mtimeMs > maxAgeMs) {
        return { error: "expired" };
      }
    }
    const data = await readFile(filePath);
    return {
      data,
      contentType: isPlaylist ? "application/vnd.apple.mpegurl" : "video/mp2t",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { error: "not-found" };
    }
    throw error;
  }
}
