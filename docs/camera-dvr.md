# Outside camera DVR

The Outside zone embeds a security-camera viewer with a two-hour DVR: live view,
play/pause, a scrubber to scan back through the last two hours, and a **Live**
button to jump back to the live edge.

## Recording scheme (rolling HLS window)

This is a standard NVR-style design — nothing bespoke:

- A single long-lived **ffmpeg** process per camera captures the source once and
  writes short MPEG-TS segments (`seg_NNNNNN.ts`, 2 s each) plus a live
  `index.m3u8` playlist into `data/camera/<id>/`.
- `-hls_flags delete_segments+append_list+program_date_time+omit_endlist` with a
  bounded `-hls_list_size` gives us, for free:
  - **fast compression** — H.264 `veryfast`/`zerolatency`,
  - **fast playback + fast seek** — segment granularity, and
    `EXT-X-PROGRAM-DATE-TIME` tags so the scrubber maps to wall-clock time,
  - **automatic retention** — ffmpeg deletes rolled-off segments, so we never
    keep (or serve) more than two hours,
  - **crash recovery** — segments live on disk; the supervisor restarts ffmpeg
    with exponential backoff and resumes the rolling window.
- A 60 s retention sweep (`lib/camera/recorder.ts`) deletes anything ffmpeg
  orphaned after an unclean exit, and the segment route refuses files older than
  the window — defence in depth for the "never older than two hours" rule.

The encoder is a process-wide singleton (stashed on `globalThis`) so Next.js
hot-reload never spawns duplicate encoders for the same device.

## Source: real device vs. placeholder

`lib/camera/config.ts` resolves the input automatically:

- **Real capture** — set `NOVA_CAMERA_OUTSIDE_DEVICE` to the capture node. The
  Nova MacroSilicon MS210x uses its stable `/host-dev/v4l/by-id/...` path,
  `NOVA_CAMERA_OUTSIDE_PIXEL_FORMAT=mjpeg`, `..._STANDARD=none`, 720x480 and
  25 fps. Other adapters can use PAL/NTSC plus their advertised frame size.
- **Placeholder** — when the device path is unset or absent, ffmpeg generates a
  `testsrc2` pattern with a large **live clock that counts up**. This is the
  placeholder stream used until the EasyCap arrives: it exercises the *entire*
  DVR pipeline (recording, scrubbing, Live) with synthetic video, so when the
  real device is plugged in nothing else changes.

In the **static demo build** (`NEXT_PUBLIC_NOVA_DEMO_MODE=true`, no server) there
is no ffmpeg or API, so `CameraPanel` renders an equivalent live clock on a
`<canvas>` and the scrubber is inert.

## Serving

- `GET /api/camera/<id>/index.m3u8` — the live playlist (lazy-starts the recorder).
- `GET /api/camera/<id>/seg_NNNNNN.ts` — a segment, path-sanitised and refused
  once outside the retention window.
- `GET /api/camera/<id>/status` — JSON: source, recording state, device
  connectivity, retention window and the oldest/newest segment timestamps.

The browser player (`app/components/dashboard/CameraPanel.tsx`) uses **hls.js**
(with native HLS fallback for Safari/tvOS). The scrubber is driven by the
`<video>` element's `seekable` range; **Live** seeks just behind the live edge.

## Deployment requirement (Nova)

The dashboard runs on Nova inside a `node:20-bookworm-slim` **Docker container**
(no ffmpeg, no fonts, and no host sudo), with `/opt/nova-ha-dashboard` bind-mounted
to `/app`. So ffmpeg is provided to the container as a **vendored static binary**
rather than an apt package:

- `data/vendor/ffmpeg` — static linux64 build (from BtbN/FFmpeg-Builds), visible
  inside the container at `/app/data/vendor/ffmpeg`. `data/` is persistent shared
  state, so it survives redeploys.
- `data/vendor/DejaVuSans.ttf` — a font for the demo-clock `drawtext` overlay
  (the slim image ships none).
- `.env.local` points the app at them:

```ini
NOVA_FFMPEG_PATH=/app/data/vendor/ffmpeg
NOVA_CAMERA_FONT=/app/data/vendor/DejaVuSans.ttf
```

No ffmpeg → the panel automatically falls back to the client-side canvas clock.

### Nova capture configuration

Nova's `nova-ha-dashboard.service` bind-mounts host `/dev` read-only at
`/host-dev` and grants only the V4L2 character-device major (`81`) through the
container device cgroup. This is intentionally hot-plug safe: the dashboard
container still starts when the capture stick is absent, and the recorder falls
back to the synthetic clock.

The installed MacroSilicon MS210x configuration is:

```ini
NOVA_CAMERA_OUTSIDE_DEVICE=/host-dev/v4l/by-id/usb-MACROSILICON_AV_TO_USB2.0_20200909-video-index0
NOVA_CAMERA_OUTSIDE_INPUT_FORMAT=v4l2
NOVA_CAMERA_OUTSIDE_PIXEL_FORMAT=mjpeg
NOVA_CAMERA_OUTSIDE_STANDARD=none
NOVA_CAMERA_OUTSIDE_FRAME_SIZE=720x480
NOVA_CAMERA_OUTSIDE_FRAME_RATE=25
NOVA_CAMERA_OUTSIDE_BRIGHTNESS=0
NOVA_CAMERA_OUTSIDE_CONTRAST=1
NOVA_CAMERA_OUTSIDE_SHARPNESS=0
```

The brightness, contrast, and sharpness values are software processing applied
by ffmpeg after capture. Their ranges are brightness `-1..1` (neutral `0`),
contrast `0..2` (neutral `1`), and sharpness `0..5` (neutral `0`). This avoids
depending on the MS210x's hidden automatic luma processing. Restart the
dashboard container after changing them.

The same values can be edited from `/config` in the Camera section. Its preview
uses the live HLS feed, and Apply saves into portable dashboard config and
restarts only the camera recorder.

Restart with `docker stop nova-ha-dashboard` after changing these values. To
restore the signal test, unset `NOVA_CAMERA_OUTSIDE_DEVICE` and restart; the
generator code and DVR path remain installed.
