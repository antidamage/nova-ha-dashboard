import path from "path";

/**
 * Camera / DVR configuration.
 *
 * The recording scheme is a standard rolling-window HLS DVR: ffmpeg captures the
 * source once and continuously writes short MPEG-TS segments plus a live
 * `index.m3u8` playlist. `hls_flags=delete_segments` + a bounded `hls_list_size`
 * give us, for free:
 *   - fast compression (H.264, `veryfast` preset)
 *   - fast playback + fast seek (segment granularity, EXT-X-PROGRAM-DATE-TIME)
 *   - automatic retention (old segments are deleted by ffmpeg)
 *   - crash recovery (segments live on disk; ffmpeg appends on restart)
 *
 * We never expose footage older than `retentionSeconds` (two hours): the playlist
 * window is bounded to it and the segment route refuses anything older.
 *
 * Everything below is overridable by environment so the same image runs with the
 * real capture device or, on a host without one, a synthetic clock. The Outside
 * camera is an MS2109 HDMI->USB capture (UVC, vendor MACROSILICON 345f:2109)
 * presenting MJPEG up to 1920x1080; it is a scaler, so requesting 1080p works
 * regardless of the HDMI source's native resolution. (It superseded the original
 * analog EasyCap S-Video capture, hence the PAL/standard knobs still existing.)
 */
export type CameraSource = "device" | "demo-clock";

export type CameraConfig = {
  id: string;
  name: string;
  /** Capture device path, e.g. /dev/video0. Empty -> force the demo clock. */
  devicePath: string;
  /** ffmpeg input format for the device (Linux: v4l2). */
  inputFormat: string;
  /** Device pixel format, e.g. mjpeg. Empty lets ffmpeg choose. */
  pixelFormat: string;
  /** Analog video standard, or none/auto for UVC devices that do not expose one. */
  videoStandard: string;
  /** Capture resolution requested from the device. */
  frameSize: string;
  /** Capture/encode frame rate. */
  frameRate: number;
  /**
   * Frame rate the H.264 encoder actually emits. On a CPU-bound host the encode
   * dominates, so emitting fewer frames than we capture roughly scales encode
   * cost down without disturbing the (cheap) capture. 0 or a value >= the capture
   * rate means "no downsampling".
   */
  encodeFrameRate: number;
  /**
   * libx264 preset (ultrafast..placebo). Cheaper presets trade compression
   * efficiency for a large CPU saving, which is the right tradeoff on a weak host
   * that is starving the rest of the box.
   */
  encoderPreset: string;
  /**
   * Video encoder. `x264` is software (libx264, works everywhere — the default).
   * `vaapi` offloads H.264 to a hardware VCN/QSV block via `/dev/dri`, which frees
   * ~a whole CPU core on a host that has a working VAAPI stack + render-node access
   * (see ops/Dockerfile.vaapi). Falls back to x264 on any host that isn't set up.
   */
  encoder: "x264" | "vaapi";
  /** DRM render node used by the VAAPI encoder. */
  vaapiDevice: string;
  /** VAAPI constant-quality QP (1 best..51 worst). ~24 is a good DVR default. */
  vaapiQp: number;
  /**
   * Hardware-accelerated DECODE of the capture stream. `vaapi` keeps frames on the
   * GPU end-to-end (decode -> encode) so the CPU does almost nothing. Only usable
   * when no CPU-side video filter is needed (an `fps` cap runs on GPU frames, but
   * brightness/contrast/sharpness and the demo clock overlay force a software path).
   *
   * NOTE for MJPEG sources: needs a recent mesa. The MS2109 grabber is 4:2:2, and
   * mesa <= 22.3 (Debian bookworm) has a VCN JPEG-decode bug that mangles 4:2:2
   * into a half-width, horizontally duplicated frame; mesa 25.x decodes it
   * correctly — which is why the runtime image is built on trixie
   * (ops/Dockerfile.vaapi). `none` (default) decodes on the CPU, which handles any
   * subsampling correctly regardless of mesa. Requires `encoder = vaapi`.
   */
  hwaccel: "none" | "vaapi";
  /** ffmpeg eq brightness adjustment (-1 to 1, neutral 0). */
  brightness: number;
  /** ffmpeg eq contrast multiplier (0 to 2, neutral 1). */
  contrast: number;
  /** ffmpeg unsharp luma amount (0 to 5, neutral 0). */
  sharpness: number;
  /** HLS segment length in seconds. Short = faster seek, smaller recovery loss. */
  segmentSeconds: number;
  /** How far back the DVR window reaches, in seconds. */
  retentionSeconds: number;
};

const TWO_HOURS_SECONDS = 2 * 60 * 60;

function envString(key: string, fallback: string) {
  const value = process.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function envNumber(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envNumberRange(key: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
}

/**
 * Retention is the contractual "two hours" the dashboard scrubs across. It is
 * clamped so a misconfiguration can never let us serve stale-forever footage.
 */
export function retentionSeconds(camera: CameraConfig) {
  return Math.min(Math.max(camera.retentionSeconds, 60), TWO_HOURS_SECONDS);
}

export const CAMERAS: CameraConfig[] = [
  {
    id: "outside",
    name: "Outside Camera",
    devicePath: envString("NOVA_CAMERA_OUTSIDE_DEVICE", ""),
    inputFormat: envString("NOVA_CAMERA_OUTSIDE_INPUT_FORMAT", "v4l2"),
    // HDMI capture defaults: MJPEG (compressed — fits USB2 bandwidth at 1080p),
    // no analog standard, 1920x1080@30. Set FRAME_SIZE to "auto" to let ffmpeg
    // negotiate the device's current format instead of pinning a resolution.
    pixelFormat: envString("NOVA_CAMERA_OUTSIDE_PIXEL_FORMAT", "mjpeg"),
    videoStandard: envString("NOVA_CAMERA_OUTSIDE_STANDARD", "none"),
    frameSize: envString("NOVA_CAMERA_OUTSIDE_FRAME_SIZE", "1920x1080"),
    frameRate: envNumber("NOVA_CAMERA_OUTSIDE_FRAME_RATE", 30),
    encodeFrameRate: envNumber("NOVA_CAMERA_OUTSIDE_ENCODE_FRAME_RATE", 0),
    encoderPreset: envString("NOVA_CAMERA_OUTSIDE_ENCODER_PRESET", "veryfast"),
    encoder: envString("NOVA_CAMERA_OUTSIDE_ENCODER", "x264") === "vaapi" ? "vaapi" : "x264",
    vaapiDevice: envString("NOVA_CAMERA_OUTSIDE_VAAPI_DEVICE", "/dev/dri/renderD128"),
    vaapiQp: envNumberRange("NOVA_CAMERA_OUTSIDE_VAAPI_QP", 24, 1, 51),
    hwaccel: envString("NOVA_CAMERA_OUTSIDE_HWACCEL", "none") === "vaapi" ? "vaapi" : "none",
    brightness: envNumberRange("NOVA_CAMERA_OUTSIDE_BRIGHTNESS", 0, -1, 1),
    contrast: envNumberRange("NOVA_CAMERA_OUTSIDE_CONTRAST", 1, 0, 2),
    sharpness: envNumberRange("NOVA_CAMERA_OUTSIDE_SHARPNESS", 0, 0, 5),
    segmentSeconds: envNumber("NOVA_CAMERA_OUTSIDE_SEGMENT_SECONDS", 2),
    retentionSeconds: envNumber("NOVA_CAMERA_OUTSIDE_RETENTION_SECONDS", TWO_HOURS_SECONDS),
  },
];

export function getCamera(id: string): CameraConfig | undefined {
  return CAMERAS.find((camera) => camera.id === id);
}

/** Root directory that holds every camera's segments + playlist. */
export function cameraDataRoot() {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "camera");
}

export function cameraDir(camera: CameraConfig) {
  return path.join(cameraDataRoot(), camera.id);
}

export const PLAYLIST_FILENAME = "index.m3u8";
export const SEGMENT_PREFIX = "seg";

/**
 * Matches a servable segment basename. Two namings coexist:
 *   - `seg_<gen>_NNNNNN.ts` — current: `<gen>` is the encoder generation id (the
 *     spawn time, base-36), which makes every filename globally unique. That
 *     uniqueness is what lets the segment route mark them `immutable` — a browser
 *     can never be handed stale bytes for a reused name (the old failure: after a
 *     purge the numbering restarted at 000000, and a kiosk that had cached
 *     `seg_000123.ts` from a demo-clock era spliced the old test pattern into the
 *     live feed straight out of its HTTP cache).
 *   - `seg_NNNNNN.ts` — legacy segments still on disk across the deploy boundary;
 *     served but never cached.
 * Doubles as the file route's path-traversal guard: anchored, tight charset, no
 * separators.
 */
export const SEGMENT_NAME_RE = /^seg_(?:[0-9a-z]+_)?\d{6}\.ts$/;

/** Current-generation naming only (drives the immutable cache policy). */
export const GENERATION_SEGMENT_NAME_RE = /^seg_[0-9a-z]+_\d{6}\.ts$/;
