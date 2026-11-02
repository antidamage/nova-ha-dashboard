<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Camera smooth delivery

The camera is motion-interpolated to 60 fps as it is delivered: the live view, and playback
at 1x and 0.5x. The result is never stored. Recording, the DVR, stills and saved ranges are
untouched by it.
`docs/camera-dvr.md` covers the recording itself.

Requested by alex, 2026-11-02: "we'll motion smooth it on delivery", and "let's go
with 720p then, downscale it at a point that makes sense in case we want to grab a
high res still from an earlier state."

## What the owner sees

- Following Live with no jog set, the panel shows the 60 fps stream and the live pill
  reads `LIVE 60`.
- Rewound or jogged, playing forward at 1x or 0.5x, the 60 fps stream takes over about 10 to 15 s
  after that rate starts, on the frame the recording has reached. alex, 2026-11-02: "when
  we're running at 0.5x make sure it's generating extra frames to reach 60fps in real-time."
- Everything else shows the recording: pausing, scrubbing, 2x and above (already 60 fps or
  more from the source), and reverse (seeks).
- Pressing Live returns to the smooth stream once it is playing.
- If the smooth stream is unavailable, slow or stalls, the panel shows the recording
  and the pill reads `LIVE`. It never shows a blank or frozen picture because of this
  feature. It tries again after 30 s.

## The numbers

| | Value | Why |
|---|---|---|
| Output at 1x | 1280x720 at 60 fps, 8-bit 4:2:0 H.264, BT.709 | The fastest resolution that holds real time |
| Output at 0.5x | 960x540 at 60 fps, same format | Three generated frames per source frame. 720p measured 43 fps; 540p 67 fps |
| Model | RIFE 4.26 by default, `NOVA_CAMERA_SMOOTH_MODEL` to change | Newest available; measured the same as 4.25 at 720p |
| Frame budget | 33.3 ms per source frame at 1x, 66.7 ms at 0.5x | Real time at that rate |
| Output segments | 1 s, in RAM; 6 kept live, 20 from a position | Holds only what a viewer is about to fetch |
| Idle stop | 20 s after the last request | Gives the GPU back |
| GPU memory guard | Will not start with under 2000 MiB free | Voice comes first on this card |
| Viewers | One pipeline, shared by every viewer of the same stream | The card has room for one |
| Taking the card | A position stream or download beats live; live returns 3 s after the last request for a position | Asking for a position is the deliberate act |

Measured on the RTX 2080 Ti on 2026-11-02, under the host's normal load, 16 s of real
footage, through decode, RIFE and encode:

| Model | 1080p | 720p |
|---|---|---|
| RIFE 4.26 | 29.6 fps, 60 ms per frame | 62.7 fps, 27 ms (p95 33 ms) |
| RIFE 4.25 | 30.4 fps, 57 ms | 62.9 fps, 27 ms (p95 34 ms) |
| RIFE 4.25-lite | 34.0 fps, 50 ms | not run |

720p has almost no headroom, so falling behind is a normal case, handled below.

**The encoder's format is named outright.** Given RGB frames, NVENC otherwise chooses H.264
4:4:4 RGB (`gbrp`, High 4:4:4 Predictive). That shipped first, and the owner saw the live
picture with the wrong colours. Frames are converted to BT.709 limited-range 4:2:0 first.

## Where the downscale happens

**At delivery only.** The capture host records 1080p30 and that is what the DVR, stills
and captures read. The smooth pipeline downscales in the hardware decoder as it reads
the recording, so the 1080p source stays available for anything taken from an earlier
moment, and the interpolator never spends time on pixels it would throw away.

## The pipeline

`camera-smooth/` holds a small service that runs on the host with the GPU, in its own
systemd unit (`ops/nova-camera-smooth.service`, installed by
`ops/install-camera-smooth.sh`). Nothing depends on it. It binds to loopback on port 8095
and reads the recording from the dashboard's own port on that host.

```
recording's live HLS
  -> h264_cuvid decode, resized to 720p
  -> RIFE: one generated frame between each pair
  -> h264_nvenc at 60 fps
  -> 1 s HLS segments in RAM
  -> dashboard's camera proxy, under smooth/
  -> a second <video> in the camera panel
```

- **Demand driven.** A playlist request starts the pipeline and any request counts as
  demand. With none for 20 s the pipeline process exits, which returns all GPU memory.
  The HTTP server itself holds no GPU resources.
- **Falling behind.** The pipeline tracks the time it has spent over the 33 ms budget.
  Past 1 s of that it repeats a frame rather than generating one, until it has caught
  up. The stream stays real time and the frame count stays right; motion is briefly
  30 fps. It logs how often. A full input queue does not count, because the source
  arrives as whole segments.
- **Never stored.** Output lives in a RAM directory, capped by the segment count, and
  is removed when the pipeline stops.
- **A position stream.** `at/<recording or range id>/<start>/<rate>/index.m3u8` asks for one.
  The path is the whole request, so there is no session to set up: asking for a different one
  replaces what is running. The source is paced to the rate. Reaching the end of the footage
  ends the pipeline and its last segments stay until nobody is asking. Only a playlist request
  can claim the card, so a late segment request cannot bring an old job back.
- **A download.** `render/<range id>.mp4` runs at 1x settings as fast as the card can go,
  generates every frame, and streams a fragmented MP4 as it is made. It holds the card until
  it finishes or the connection closes, and nothing else can start meanwhile.
- **The route.** The browser reaches it at `/api/camera-proxy/<id>/smooth/...`, so it
  needs no separate auth rule from the camera route it sits under. Nothing listening
  is a plain 503, which the panel treats as unavailable.

## The panel

The recording's `<video>` stays mounted, because scrubbing, jog and the DVR window are
built on it. The smooth stream plays in a second `<video>` on top, shown only once it
is actually playing. While it is shown, the recording's hls.js stops loading, so a
viewer is not fetching and decoding both. WebKit's native HLS has no such control, so
it keeps loading there.

Leaving Live resumes the recording under the smooth stream's last frame and swaps once
it has caught up, within 2.5 s; a scrub swaps at once. The picture is then the
recording's, a few seconds different from what the smooth stream was showing,
because the two have different latency.

**From a position** (`camera/useSmoothPosition.ts`), the recording keeps playing underneath
and stays the truth, so pausing, scrubbing or changing rate hides the stream with nothing to
catch up. The hook picks a segment boundary far enough ahead for the pipeline to start, asks
for the stream from there, holds it on its first frame, and starts it when the recording
reaches that boundary, so nothing jumps. If they drift over 0.5 s the stream is moved. A
stream that does not arrive or stalls is dropped and retried after 30 s. This costs the
viewer loading both streams for as long as it shows.

## What this does not do yet

- **Position streams on WebKit.** They read hls.js's fragment list, and WebKit plays the
  recording natively, so Safari and iOS show the recording in those cases.
- **Reverse and 2x and above** use the recording, above.
- **Other surfaces.** The Apple TV app and the config page's preview use the recording.

## Planned: multiple cameras and a selected region

Not implemented. Recorded here so the work above does not close it off. alex,
2026-11-02: more cameras are coming, which divides the screen into a 2x2 grid; "at some
point we'd like to be able to select a grid region and crop and upscale just that
part", and "an early crop of the saved source at its native res (half 1080p) then
upscaling + motion smoothing + jog".

The order for a selected region is:

```
saved source at 1920x1080 -> crop the region at native res (960x540)
  -> upscale -> motion smoothing -> jog
```

What follows from that:

- **Keep the full recording.** The crop reads saved footage, so the recording must stay
  at full resolution with the whole grid in it. This is the same reason the downscale
  above is at delivery.
- **Crop first.** A region is cropped in the pipeline before anything else, at native
  resolution. A 960x540 crop is about 56% of the pixels of the 720p output, so smoothing
  it is cheaper than today's stream. Whether smoothing runs before or after the upscale
  is to be measured: before is cheaper, after may look better. The order above is what
  was asked for and stands unless the measurement says otherwise.
- **Smoothing from any position** now exists, for 0.5x and 1x. A region adds a crop.
- **The pipeline's stages stay separate:** input, crop, upscale, smoothing, output. A crop
  rectangle and a start time are the expected new parameters.
- **One at a time.** Four cameras cannot each be smoothed at once on this card, so the
  grid itself would show the recording, or be smoothed as one 720p picture, and a
  selected region would take the pipeline. To be decided when the grid is built.
- **The upscaler** is not chosen. It needs measuring against the same 33 ms budget.

## Measured end to end

2026-11-02, with the service run by hand on the GPU host and the panel in headless
Brave on real footage:

- The stream was on screen about 8 s after the panel opened. Pipeline start took 4-5 s.
- 1280x720, 60 frames per 1 s segment, about 1 MB per segment, 7 MB of RAM in total.
- The browser decoded 60.0 fps. Headless presented 50 of them per second and dropped the
  rest, which is that test browser's display, not the stream; a real screen is unmeasured.
- While it showed, the recording loaded no segments.
- Leaving for a pause took about 0.6 s, returning with Live about 0.2 s while the pipeline
  was still up, and a cut stream fell back to the recording in 4 s.
- GPU memory was 7319 MiB while running and back to 6385 MiB after the idle stop.

Then installed as the service, through the live dashboard:

- 3600 frames generated and none repeated over two minutes.
- On the deployed page, `LIVE 60` 8 s after opening the zone, decoding 59.8 fps.
- By the clock burned into the footage, the newest smooth segment was a steady 4-5 s behind
  the newest recorded segment. The panel already holds the recording about 6 s behind that
  edge, so this is what a smooth viewer sees on top of the recording's own delay.

Not yet measured: how generated frames look on real movement, Safari and iOS (the wait
for WebKit has not been run), a real screen, and the wall kiosks.

## What done means

- The service runs on the GPU host and stops itself when nobody is watching.
- In a browser on real footage: the live view plays at 60 fps with distinct generated
  frames, and pausing, scrubbing, jog and Live all behave as they do today.
- Stopping the service leaves the panel working on the recording.
- GPU memory returns to its idle level after the idle stop.
