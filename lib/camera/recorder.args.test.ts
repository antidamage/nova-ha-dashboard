import { describe, expect, it } from "vitest";
import type { CameraConfig } from "./config";
import { ffmpegArgs, isRecordingFilename } from "./recorder";

const camera: CameraConfig = {
  id: "outside",
  name: "Outside Camera",
  devicePath: "/host-dev/v4l/by-id/easiercap-video-index0",
  inputFormat: "v4l2",
  pixelFormat: "mjpeg",
  videoStandard: "none",
  frameSize: "720x480",
  frameRate: 25,
  encodeFrameRate: 0,
  encoderPreset: "veryfast",
  encoder: "x264",
  vaapiDevice: "/dev/dri/renderD128",
  vaapiQp: 24,
  hwaccel: "none",
  brightness: -0.1,
  contrast: 1.2,
  sharpness: 0.8,
  segmentSeconds: 2,
  retentionSeconds: 7200,
};

describe("camera ffmpeg arguments", () => {
  it("selects a device pixel format and omits a disabled analog standard", () => {
    const args = ffmpegArgs(camera, "device");

    expect(args).toEqual(expect.arrayContaining(["-f", "v4l2", "-input_format", "mjpeg"]));
    expect(args).toEqual(expect.arrayContaining(["-video_size", "720x480", "-framerate", "25"]));
    expect(args).toEqual(expect.arrayContaining(["-vf", "eq=brightness=-0.1:contrast=1.2,unsharp=5:5:0.8:5:5:0"]));
    expect(args).not.toContain("-standard");
  });

  it("caps the encoder frame rate and preset when configured, aligning the GOP", () => {
    const args = ffmpegArgs(
      { ...camera, encodeFrameRate: 12, encoderPreset: "ultrafast" },
      "device",
    );

    // fps filter appended to the existing eq/unsharp chain
    expect(args).toEqual(
      expect.arrayContaining([
        "-vf",
        "eq=brightness=-0.1:contrast=1.2,unsharp=5:5:0.8:5:5:0,fps=12",
      ]),
    );
    expect(args).toEqual(expect.arrayContaining(["-preset", "ultrafast"]));
    // GOP follows the output rate (12fps * 2s segment = 24), not the capture rate
    expect(args).toEqual(expect.arrayContaining(["-g", "24", "-keyint_min", "24"]));
    // capture side is untouched
    expect(args).toEqual(expect.arrayContaining(["-framerate", "25"]));
  });

  it("does not cap when encodeFrameRate is >= the capture rate", () => {
    const args = ffmpegArgs({ ...camera, encodeFrameRate: 30 }, "device");
    expect(args.join(" ")).not.toContain("fps=");
    expect(args).toEqual(expect.arrayContaining(["-g", "50", "-keyint_min", "50"]));
  });

  it("builds a hardware VAAPI pipeline when encoder=vaapi", () => {
    const args = ffmpegArgs(
      { ...camera, encoder: "vaapi", encodeFrameRate: 15, vaapiQp: 22 },
      "device",
    );
    const joined = args.join(" ");

    // hw device initialised from the render node
    expect(args).toEqual(
      expect.arrayContaining(["-init_hw_device", "vaapi=va:/dev/dri/renderD128", "-filter_hw_device", "va"]),
    );
    // filter chain downsamples then uploads to the GPU
    expect(args).toEqual(
      expect.arrayContaining([
        "-vf",
        "eq=brightness=-0.1:contrast=1.2,unsharp=5:5:0.8:5:5:0,fps=15,format=nv12,hwupload",
      ]),
    );
    // hardware codec + CQP, and none of the x264-only knobs
    expect(args).toEqual(expect.arrayContaining(["-c:v", "h264_vaapi", "-qp", "22"]));
    expect(joined).not.toContain("libx264");
    expect(joined).not.toContain("-preset");
    expect(joined).not.toContain("-tune");
  });

  it("keeps frames on the GPU end-to-end when hwaccel=vaapi and no CPU filter is needed", () => {
    const args = ffmpegArgs(
      {
        ...camera,
        encoder: "vaapi",
        hwaccel: "vaapi",
        encodeFrameRate: 15,
        // neutral processing -> no eq/unsharp -> the fps cap can run on GPU surfaces
        brightness: 0,
        contrast: 1,
        sharpness: 0,
      },
      "device",
    );
    const joined = args.join(" ");

    // hardware decode of the capture stream, output kept as VAAPI surfaces
    expect(args).toEqual(
      expect.arrayContaining([
        "-hwaccel", "vaapi",
        "-hwaccel_device", "/dev/dri/renderD128",
        "-hwaccel_output_format", "vaapi",
      ]),
    );
    // fps cap + GPU-side NV12 conversion, running on GPU frames — no CPU download/upload
    expect(args).toEqual(expect.arrayContaining(["-vf", "fps=15,scale_vaapi=format=nv12"]));
    expect(joined).not.toContain("hwupload");
    expect(joined).not.toContain("init_hw_device");
    expect(args).toEqual(expect.arrayContaining(["-c:v", "h264_vaapi"]));
  });

  it("falls back to CPU decode + upload when a software filter is required, even with hwaccel=vaapi", () => {
    // base camera has non-neutral brightness/contrast/sharpness -> eq/unsharp needed
    const args = ffmpegArgs({ ...camera, encoder: "vaapi", hwaccel: "vaapi" }, "device");
    const joined = args.join(" ");
    expect(joined).not.toContain("-hwaccel ");
    expect(joined).toContain("hwupload");
    expect(args).toEqual(expect.arrayContaining(["-init_hw_device", "vaapi=va:/dev/dri/renderD128"]));
  });

  it("keeps the synthetic generator independent of device-only options", () => {
    const args = ffmpegArgs(camera, "demo-clock");

    expect(args).toContain("testsrc2=size=720x480:rate=25");
    expect(args.indexOf("-re")).toBeLessThan(args.indexOf("-i"));
    expect(args).not.toContain("-input_format");
    expect(args).not.toContain("-standard");
    expect(args.join(" ")).not.toContain("eq=brightness");
    expect(args.join(" ")).not.toContain("unsharp=");
  });

  it("does not rate-limit a real capture device", () => {
    expect(ffmpegArgs(camera, "device")).not.toContain("-re");
  });
});

describe("camera recording filenames", () => {
  it("accepts generation-scoped and legacy HLS files", () => {
    expect(isRecordingFilename("index.m3u8")).toBe(true);
    expect(isRecordingFilename("seg_mrlrmwlb_002968.ts")).toBe(true);
    expect(isRecordingFilename("seg_002968.ts")).toBe(true);
  });

  it("rejects traversal and malformed segment names", () => {
    expect(isRecordingFilename("../seg_mrlrmwlb_002968.ts")).toBe(false);
    expect(isRecordingFilename("seg_generation_latest.ts")).toBe(false);
    expect(isRecordingFilename("seg_MRLRMWLB_002968.ts")).toBe(false);
  });
});
