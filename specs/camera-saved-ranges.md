<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Camera saved ranges

Save a time range out of the camera's current DVR window, keep its base video, and list,
play and download it from a module in the camera's Advanced fold. Replaces Saved
Captures, and categorisation goes with it.

alex, 2026-11-02: "disable categorisation and remove it as a feature. treat its UX in
the advance section as a module and disable it. then re-add the ability to save a time
range (with preview) from the current block of available camera feed. that will retain
the base video and add a module to advanced to list and view these. the saved frame
ranges will be downloadable. during playback the jog control will be available, and
play/pause, just like in the non-advanced area, with a timeline minus the live button.
both the download and playback will implement frame smoothing." And: "delete and historic
categorisation data and saved video pieces."

## Categorisation is retired

- `nova-camera-events.service` is stopped and disabled on the GPU host. It was also the
  `uvicorn` process that had averaged about 610% CPU.
- Its history is deleted: every event row and clip. Its zone settings, vehicle reference
  images, policy and downloaded models stay on disk, because they are configuration
  rather than history and the module can be turned back on.
- Its UI is a **camera Advanced module**, disabled. `camera/advanced-modules.tsx` is the
  list: each entry has an id, a component and `enabled`. A disabled module renders
  nothing and makes no requests. The config page's analysis section obeys the same flag.
- The service code, its routes and its unit file stay in the tree. With the service
  stopped its routes answer 503.

## The Saved Ranges module

An Advanced module, enabled, full row wide. Holds the save control, the list and the
player. It replaces Saved Captures, whose "save the last two hours" is one case of a range.

### Saving a range, with preview

- **Save a range** opens the selector: a two-thumb slider over the current DVR window, a
  preview `<video>` of the recording, and the start, end and length in numbers.
- It opens selecting the last 60 s.
- Dragging a thumb shows that moment in the preview, paused. Its play button plays the
  selection and loops inside it.
- **Save** stores it and closes the selector. The preview's stream is detached when the
  selector closes.
- The recording is cut on segment boundaries, 2 s apart, so a saved range can start and end
  up to 2 s outside the selection. It is never shorter than what was selected, footage
  permitting.

### What is stored

Saved on the Nova host, under `data/camera/<id>/saved/`, so the capture host needs no
change and restarting it does not touch them. One range is:

| File | Holds |
|---|---|
| `range_<ms>.ts` | the recording's own segments joined, unchanged: 1920x1080 at 30 fps |
| `range_<ms>.json` | start, end, length, size, state, and each segment's byte offset and duration |

- **Saving runs in the background**, oldest segment first because that is the end the DVR
  loses first. A segment that has already gone is skipped and marked as a gap. The row shows
  its progress. Over the proxy a full two hours takes about 25 minutes.
- **One save at a time, per camera.** A second is refused with a message.
- **A save that dies** (the server restarted) lists as failed and can be deleted.
- **Nothing expires.** There is no round robin any more. A range stays until it is deleted
  from its row, after a confirmation. A full disk fails the save and says so; nothing is
  deleted to make room.
- Playback reads an HLS VOD playlist built from the metadata (`#EXT-X-BYTERANGE` into the
  one file), so the whole range is seekable at once.

### The list

Newest first. Each row: when the footage is from, its length and size, then Play,
Download and Delete. A row still saving shows its progress and only Delete's absence.

### Playback

Play opens the player in the module, one range at a time:

- The picture, then the same controls as the main panel: play/pause button, `CameraJogDial`,
  and a timeline, with no Live button.
- The timeline runs over the range. Its labels are the range's start time, the current
  time and its end time.
- With no jog set it plays at 1x. There is no catch-up rule, because there is no live edge.
- Playback stops at the end of the range. Pressing play there starts it again.

### Download

Download streams a 1280x720 60 fps H.264 MP4, generated as it downloads and never
stored, so it takes about as long as the range does and its size is not known in advance.
It takes the GPU pipeline for its whole length: anyone watching falls back to the recording
meanwhile. If the pipeline is already rendering, or the service is down, the module says so
instead of downloading an error.

## Smoothing during playback

`specs/camera-smooth-delivery.md` holds the pipeline. Playback uses it at 0.5x and 1x, both
in the player above and when jogging or rewound in the main panel. At 2x and over the
recording already reaches 60 fps by itself, and reverse is seeks, so those use the recording.

## What done means

- Categorisation is off: no service, no `uvicorn` load, no event row in Advanced, no analysis
  section in config, no events on disk.
- The live stream decodes as ordinary 8-bit 4:2:0 H.264 and looks the same as the recording.
- A range saved from a selection with a working preview appears in the list and plays.
- Play shows jog, play/pause and a timeline without Live, and every stop on the dial works.
- At 1x and 0.5x, playback shows 60 distinct frames a second in a real browser.
- The download plays in a desktop player at 60 fps.
- Deleting a range removes its files.
