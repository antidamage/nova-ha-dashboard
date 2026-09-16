// Building the ffmpeg argument list: fonts for the demo clock, device filters,
// input and encoder options, and the HLS output.
import { existsSync } from "fs";
import path from "path";
import { cameraDir, PLAYLIST_FILENAME, retentionSeconds, SEGMENT_PREFIX, type CameraConfig, type CameraSource } from "../config";

/**
 * The demo clock overlay uses ffmpeg's `drawtext`, which needs a real font file
 * (we point at one explicitly so it works even on hosts without fontconfig, e.g.
 * Windows dev boxes). Resolves an env override, then common per-platform fonts.
 */
export function resolveFontFile(): string | null {
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
export function drawtextFontfile(fontPath: string): string {
  // ffmpeg's drawtext wants native backslash separators on Windows; then the
  // drive colon and backslashes themselves must be escaped for the filtergraph.
  const normalized = process.platform === "win32" ? fontPath.replace(/\//g, "\\") : fontPath;
  return normalized.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

export function optionalInputOption(name: string, value: string): string[] {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "auto" || normalized === "none" || normalized === "off"
    ? []
    : [name, value.trim()];
}

export function deviceVideoFilters(camera: CameraConfig): string[] {
  const filters: string[] = [];
  if (camera.brightness !== 0 || camera.contrast !== 1) {
    filters.push(`eq=brightness=${camera.brightness}:contrast=${camera.contrast}`);
  }
  if (camera.sharpness !== 0) {
    filters.push(`unsharp=5:5:${camera.sharpness}:5:5:0`);
  }
  return filters;
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
