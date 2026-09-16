# API Contract

The Voice Infrastructure configuration includes a live `speakerRecognitionEnabled` switch
and an authenticated speaker-profile manager proxied to Iridium. Operators can inspect named,
pending, and provisional templates; edit names/pronouns; reassign or delete a template; and
delete a person with all associated templates. Biometric vectors never enter dashboard state
or browser responses.

All routes are under `app/api`.

Visualiser controls (the config panel formerly called Physics):

- The panel is built from two independent libraries. **Colour themes** are
  colours only. **Settings groups** are named sets of driver lanes plus the
  static settings a module cannot change without rebuilding its scene (today
  just `complexity`). Both are per module.
- A **colour theme group** joins them: an ordered playlist whose entries each
  pair one colour theme with one or more ordered settings groups. A theme may
  appear in several entries with different settings, so rotation advances
  through **entries**, not themes — two consecutive entries sharing a palette
  still cross-fade, because the behaviour differs.
- Where an entry names several settings groups, lanes stack and scalars layer:
  every group's lanes run at once, while a per-effect combine mode or a static
  setting collides and the later group wins.
- Exactly one settings group and one colour theme group carry the Default flag.
  The default group catches any genre that no group claims, and the default
  settings group catches an entry that names none. Neither can be deleted.
- Genres are assigned on the colour theme group and are exclusive across groups
  — assigning one steals it from whichever group held it, and the editor says so
  at the moment of assignment. The `chooseColorGroupByGenre` toggle that arms the
  routing sits outside the group list.
- Driver-lane semantics — driver types, `every`/`offset` gating, `divide`
  subdivision, modifier summation, envelopes, the four combine modes, and the
  overshoot guard — are specified in `PHONOSCOPE_MODULE_SPEC.md` §10 "Driver
  lanes" and shared by all three engines. `lib/phonoscope-drivers/` is the
  dashboard's copy.
- "When stacked" offers **Sum**, **Least frequent lane wins**, **Most frequent
  lane wins** and **Override**. The first two keep their original wire values
  (`add`, `strongest`) because saved configurations already hold them.
- The controls hierarchy is **four levels deep, not three**:

  ```
  Lane (Beat)
  └─ Effect (Centre image)
     ├─ Parameter group (Size)
     │  ├─ Parameter (Width)
     │  ├─ Parameter (Height + Auto)
     │  ├─ Parameter (Scale)
     │  ├─ Ramp            ← ONE, for the whole parameter group
     │  └─ When stacked    ← ONE, for the whole parameter group
     └─ Parameter group (Transition)
  ```

  An effect is one thing you add; inside it, related parameters live TOGETHER in
  a **parameter group**, not as siblings that happen to share a heading. A
  parameter group is a labelled block of controls, deliberately not a fourth
  accordion. The nesting is presentation only: each parameter is still its own
  effect id with its own binding, so both engines, the wire format and the
  conformance corpus are untouched and a settings group saved before groups
  existed renders under the new headings unmigrated.
- **A parameter group owns exactly ONE ramp. Every group, no exceptions.** The
  parameters of a group move together, so a ramp per parameter would be a
  control the user has to keep in sync by hand. The group's ramp is written to
  every member that can take one; a discrete axis, a toggle and a pinned value
  cut rather than ramp, so they are simply not part of it, and a parameter added
  to the group lands carrying the group's current ramp. It is not a property a
  group declares or opts into — a group that shows a ramp per parameter is a
  bug. The Glow group is the plainest case: opacity, blur, overdrive, blend mode
  and clamp are one parameter group under one ramp. The **Grid** effect is the
  case that shows the other side of the rule: its three parameter groups are
  **Size** (the lattice's width and height, one-value percentages), **Dots**
  (dot size, a swept range in real device pixels with a `px` readout) and
  **Blend**. Dot size is not in Size precisely because a group means one ramp,
  and how wide the lattice is and how big the things in it are are two gestures.
  A parameter group may also declare a unit its module settings inherit, which
  is where the `px` comes from.
- Two effects are contributed **entirely** by the module, with no picture-level
  parameters at all: **Ripple** (intensity and the strong-beat multiplier, both
  energy fed to the same beat wave) and **Flare** (peak threshold, peak glow,
  anticipation, ramp up, release and flash power — the crest lighting up as a
  ripple passes). Flare is not called Glow: Glow is the whole-frame overlay
  pass, a different thing at a different stage, and `flare` is the term both
  engines already use for this in code. A module that declares none of these
  never sees the effect, because a group whose parameters are all absent is not
  offered. The one place the ramp is
  not drawn by the group is the Transition group, whose control set draws the
  transition's own motion profile — which is that group's single ramp, not a
  second one.
- **A parameter group owns exactly ONE stacking mode ("When stacked"), on the
  same footing as its ramp.** How two lanes setting the group's value resolve
  against each other is a property of the thing being set, not of each slider,
  so it is offered once per parameter group and never per parameter. The chosen
  mode is written to every member that stacks — including members this lane has
  not added yet, so one added later already stacks the way the group does — and
  an override-only axis never stacks, so it is not part of it. `combine` is
  still keyed by effect id on the settings group, so the wire format is
  unchanged and the mode is still shared by every appearance of those
  parameters. An effect standing on its own in a lane, outside any group, keeps
  its own "When stacked" as an addable parameter.
- The **ramp** control has two readings, and the label says which is in play.
  On a pulse it is an envelope: attack rises, hold holds, release falls. On a
  one-shot transition it is a motion profile: attack is the ease-in, hold is the
  flat middle, release is the ease-out, and the transition lasts their sum.
- Not every slider is a range slider. A width and a height are ONE integer
  percentage of the screen on a single-thumb slider; the scale on top of them is
  the swept range worth binding to a lane. The centre image has no size-mode
  dropdown (it is always manual); the background image does, and its width and
  height only appear under Manual.
- The **Centre** effect group carries the transition alongside the height and
  scale, as **one control set rather than four effects**. Picking the mode
  (Cross-fade / Flip / Slide) decides what the rest of the set is: a flip adds
  the axis it collapses along, a slide adds the axis plus the division count and
  the return-edge toggle, and a cross-fade shows neither. The **ramp** is always
  shown, because every transition has one. The axis, divisions and return edge
  are never offered in the "Add effect" picker and never render on their own —
  the set writes them, and removing the transition removes them. Each is a
  single pinned value rather than a range, because they are latched for the
  length of the transition; all four are override-only, so the "When stacked"
  control is replaced by a line saying the last settings group wins. The entry a
  change *starts from* owns its transition — see `PHONOSCOPE_MODULE_SPEC.md`
  §10.
- A driver row asks "how often" once: a single cadence list running from
  "Eighth beat" through "Every one" to "Every 16th". Faster than the pulse there
  is nothing to start on, so the "Starting on" control is absent for a
  subdivided driver rather than shown inert.
- Nesting is `ConfigAccordion` throughout — settings group → driver lane →
  effect — so opening one closes its siblings at each level without any new
  state. Effects are collapsed by default and expose only the parameters that
  have been added; anything unset inherits the effect's declared default. An
  effect is *added* carrying the parameters that are its control, so it is never
  an empty row: its declared range plus an envelope, a checkbox pinned to its
  default for a toggle, a mode pinned to its default for a discrete axis, and
  the transition alone for a rotation pulse.
- Each entry in a colour theme group may name an **Alt theme** beneath its
  colour theme: a link to another theme in the same library, not a copy. The
  "Change to alt theme" effect (`__altTheme`) flips one household-wide state, so
  the whole system blends to whichever alt is available and the next firing
  blends back. Entries that name no alt keep their own colours and leave the
  state alone, which is what makes A → A-alt → B → C show C's alt. Editing the
  linked theme edits it everywhere it is used, and deleting it releases the link
  rather than leaving a dangling reference.
- **Solo** locks the visualiser to one colour theme and/or one settings group.
  It is persisted (`soloColorThemeId`, `soloSettingsGroupId`) and deliberately
  survives leaving the page, so a floating indicator in the top-right names what
  is held — colour theme above settings, 1px apart — and tapping it releases the
  lock. It is applied in `readPhonoscopeThemeState`, so it reaches the streamed
  renderer and the tvOS fallback at the same revision without either engine
  knowing the feature exists.
- Configurations written before this structure are migrated once on read by
  `lib/phonoscope-migrate-v3.ts`, which is behaviour-identical to the old
  baseline-plus-overrides cascade.

Preference history and restore:

- Every write to `data/dashboard-preferences.json` is recorded as a running
  diff in `data/history/preferences/`: `log.jsonl` holds one JSON Patch per
  revision, `genesis.json` the state the first revision changed away from, and
  periodic `checkpoint-*.json` snapshots bound how far a replay has to run.
  Recording happens inside the preferences write queue, after the save lands,
  and swallows its own failures — losing an undo point must never fail the save.
- **A revision is a minute, not a save.** Ten changes inside one minute are one
  revert point: the first write opens the bucket and every later write in that
  minute recomputes its patch against the state as the minute opened, so the
  entry always means "everything that happened during this minute". Saves that
  only restamp an `updatedAt` are not recorded at all.
- Any point in time is reconstructed by replaying from the nearest checkpoint,
  which is what lets the restore offer a branch that did *not* change at that
  moment. The API takes a `before` flag for the state a revision changed away
  from; the panel does not use it, because a single reading is clearer and
  nothing is lost — the state before a change is the state after the change
  preceding it, so recovering a deletion means restoring the row below it.
- `POST /api/preferences/history` restores the selected JSON pointers from a
  revision. A pointer absent at that revision is removed rather than skipped, so
  "put this back to how it was" can mean "it was not there" — which is why the
  restore writes through `replaceDashboardPreferences` rather than the merging
  path, since a merge cannot express a removal. The restore is itself recorded
  as a new revision and can be wound back in turn.
- The **History** panel leads System & Data. It lists revert points newest
  first, each with one **Restore** button meaning "the configuration as it stood
  once this minute's changes had been made". Choosing one shows the whole
  configuration as a tree of checkboxes: every branch is selectable, the ones
  that revision moved are dotted, and branches that are gone now or were added
  since say so.

Phonoscope track timing:

- `POST /api/phonoscope/tracks/resolve` accepts Apple Music track identity and
  returns Nova's complete cached analysis, including the canonical
  `beatTimes` array. Beat timing resolves in strict order: Spotify Audio
  Analysis when server credentials and endpoint access are available; a
  duration- and metadata-matched Songle recording; the household's optional
  Essentia service configured by `NOVA_PHONOSCOPE_ESSENTIA_URL`; and finally
  the existing ReccoBeats tempo materialised into a uniform beat grid. Spotify
  credentials are read only from `NOVA_SPOTIFY_CLIENT_ID` and
  `NOVA_SPOTIFY_CLIENT_SECRET`. Clients never contact any provider directly.
- The first resolution for a track is written atomically beneath
  `data/phonoscope/tracks`. Concurrent cache misses share one in-flight
  resolution, and subsequent resolutions are disk-cache reads, so a track
  cannot produce a provider request stampede. Lower-priority beat providers
  are not queried after a higher-priority provider returns a usable timeline.
- Older cached analyses are upgraded locally by materialising their BPM and
  beat offset into a version-2 beat timeline; this migration does not refetch
  upstream data. Manual BPM/offset overrides regenerate the cached timeline
  locally for the same reason.
- `GET /api/phonoscope/tracks/<trackKey>/beats` is the immutable Nova
  pass-through representation for other household clients. It serves only an
  existing Nova cache entry and never falls through to an upstream provider.
- House Party predicts lighting independently for local HA lights and
  cloud-backed Tuya lights. The tvOS source samples the shared beat timeline
  250 ms ahead for local devices and 1.10 s ahead for cloud devices; the
  dashboard applies those predicted brightness values through their respective
  service paths.
- House Party is gated by its own persisted master switch, with the hue and
  brightness modes nested under it in Visualiser controls.
- The random light-hue offset is the `__hueOffset` effect, bound to a driver lane
  like any other, ranging 0° through 180° with a default of 5°. Because the
  renderer is the only side that sees the spectrum, it resolves the effect and
  publishes the resulting magnitude on the House Party frame it already posts;
  the dashboard reads `hueOffsetDegrees` from the frame. Every affected light
  independently samples a continuous random offset from `[-magnitude, +magnitude]`
  for every House Party command; the rotation preserves the supplied colour's
  saturation and value. Per-entity HA calls are therefore intentional.
- The Apple TV publishes the authoritative track key, playback position,
  duration, play/pause state, and sample time with House Party frames.
  `GET /api/phonoscope/house-party/clock` advances that observation to server
  time. The web dashboard samples it every five seconds and corrects for half
  the measured round trip before publishing the resulting wall-clock/track
  offset in the `nova-house-party-clock-sync` window event. Other clients use
  the same endpoint and algorithm.

State and realtime:

- `GET /api/state`: build and return dashboard state, publish state event.
- `GET /api/events`: dashboard/task SSE stream. Alongside the `: keep-alive`
  comment (proxy idle protection) the server pushes a named `heartbeat` event on
  the same ~15s cadence; browser JS cannot see comment lines, so the client's
  shared-EventSource liveness watchdog uses heartbeat silence (>50s) to detect a
  half-open stream that still reports `readyState OPEN` and rebuild it.
- `GET /api/version`: return build ID and generated timestamp.

Camera:

- `GET /api/camera/<id>/status`: ensure the recorder is started and return the
  camera ID/name, source (`device` or `demo-clock`), recording state, ffmpeg and
  device availability, retention/segment lengths, oldest/newest segment times,
  and the latest recorder error.
- `GET /api/camera/<id>/index.m3u8`: ensure the recorder is started and return
  the live rolling HLS playlist. It may briefly return 503 while ffmpeg creates
  the first playlist.
- `GET /api/camera/<id>/seg_NNNNNN.ts`: return a path-sanitized HLS segment.
  Segments older than the retention allowance are refused.
- `GET /api/camera/outside/settings`: return persisted ffmpeg processing values.
- `PUT /api/camera/outside/settings`: validate and persist brightness, contrast,
  and sharpness, then restart only the outside recorder so the preview and live
  dashboard receive the new processing chain.
- `GET /api/camera/<id>/events`: list recent analysis events with limit,
  priority, zone, subject, reviewed, and starred filters.
- `GET|PUT|DELETE /api/camera/<id>/events/<event-id>`: inspect, review/star or
  correct, and explicitly remove an event. `/thumbnail` and `/clip` stream its
  media; clip responses preserve HTTP range semantics.
- `GET|PUT /api/camera/<id>/analysis`: read or replace the normalized scene
  polygons and analysis/alert switches. `/status` reports model, cursor,
  backlog, queue, errors, and storage health; `/frame` supplies the calibration
  editor background.
- `GET|POST|DELETE /api/camera/<id>/analysis/references`: manage private named
  cat and ute reference images used for tentative visual matching.

Control:

- `POST /api/zone`: body includes `zoneId`, `action`, optional
  `brightnessPct`, optional `rgb`, optional `cursor`, optional
  `sourceClientId`. Calls zone actions and returns updated state.
- `POST /api/entity`: body includes `entityId`, `domain`, `service`, optional
  `data`, optional `remember`, optional `sourceClientId`. Calls entity action
  and returns updated state.
- `GET /api/lights/toggle`: simple shortcut endpoint for indoor Home lighting.
  It chooses on/off from the current indoor lighting majority, uses the
  adaptive warm-white/candlelight preset when turning on, returns plain text
  `on` or `off`, and has a one-second cooldown.
- `GET /api/lights/on`: explicitly turn indoor Home lighting on using the
  adaptive warm-white/candlelight preset, returning plain text `on`.
- `GET /api/lights/off`: explicitly turn indoor Home lighting off, returning
  plain text `off`.
- `GET /api/outside-light/toggle`: simple shortcut endpoint for Outside zone
  lighting. It chooses on/off from the current outside lighting majority, sends
  plain power commands, returns plain text `on` or `off`, and has a separate
  one-second cooldown.
- `GET /api/outside-light/on`: explicitly turn Outside zone lighting on with
  plain power commands, returning plain text `on`.
- `GET /api/outside-light/off`: explicitly turn Outside zone lighting off,
  returning plain text `off`.

Telemetry:

- `GET /api/router`: return router status with no-store headers.
- `GET /api/power`: ensure power monitor is running, sample now, return power
  dashboard data with no-store headers.
- `GET /api/nova-load`: return host load metrics.

Configuration:

- `GET /api/config`: return config and setup status.
- `PUT /api/config`: validate and write config.
- `POST /api/config/validate`: dry-run validate config import.
- `GET /api/config/schema`: return JSON schema.
- `GET /api/config/setup-status`: return secret setup status.
- `GET /api/config/secrets`: return the status of secrets configured from the
  config page rather than the host environment — currently only
  `themeChangeNotificationUrl`. Never returns a stored value in full: only
  `configured` and a shortened `preview` (host, an ellipsis, and the last two
  path segments), so a config screen left open on a wall display cannot leak a
  token.
- `POST /api/config/secrets`: write one such secret. Values must be absolute
  `http:`/`https:` URLs of at most 2048 characters. An empty string clears the
  secret, which is what the Clear action posts — there is no separate delete
  path to keep in step.
- `GET /api/config/client`: return non-secret client config.
- `GET /api/orb-modules`: return every available status orb module — the
  compiled-in built-ins overlaid with normalized `config/orb-modules/*.json`
  files, merged by id (disk wins) — as `{ modules, errors }` with no-store
  caching. `errors` lists unreadable/invalid module files as
  `{ file, error }`. Consumed by both the web dashboard and the Apple TV
  client.
- `GET /api/theme`: return shared theme preferences as
  `{ selection, themes: { dark, light } }`. Legacy stored single-theme payloads
  are wrapped into both variants on read and normalized by clients. Missing
  `avatar` values and missing avatar fields are filled from the legacy
  `dashboard.avatar` fallback; present avatar color slots are preserved.
- `POST /api/theme`: write shared dashboard theme preferences. Namespaced
  `{ selection, themes }` payloads replace the stored theme set, while legacy
  single-theme partial payloads merge for compatibility. A legacy
  `autoFullscreenOnLoad` field is stripped recursively because fullscreen is a
  per-device setting that never lives in a theme. Writing a theme never pushes
  wallpapers to managed desktops.
- `POST /api/desktop/sync`: apply the current effective managed desktop
  wallpaper plan. The body's `force` flag selects the behaviour: `force: true`
  (the manual Apply button) bypasses the unchanged-wallpaper skip to repair
  machines that drifted manually, while the default deduplicated path (the
  automatic Back / dashboard-flip triggers) drops any target whose wallpaper
  already matches what was last applied, so the same image is never sent twice
  in a row.
- `GET /api/desktop/wallpapers/current`: return the theme's current wallpaper
  as image bytes, for clients that cannot read the theme themselves — iOS
  Shortcuts fetches this to set the phone's wallpaper. The dark/light variant
  resolves exactly as a managed desktop's sync resolves it, so a phone and a
  desktop asked at the same moment get the same picture. `?orientation=
  landscape` serves the landscape asset; the default is portrait, which falls
  back to the landscape asset when the theme has no portrait one. The response
  carries `X-Nova-Wallpaper-Id`, `X-Nova-Wallpaper-Updated-At`, and
  `X-Nova-Theme-Variant` so a Shortcut can skip a download it already has. 404
  when the current theme has no wallpaper.
- `GET /api/desktop/wallpapers/current/wallpaper.png`: the identical response,
  at a URL ending in a file extension, because some clients will not treat a
  response as an image otherwise. Both routes share one handler. The bytes and
  `Content-Type` are the asset's own, so this path can return a JPEG — the
  extension is for the client's parser, not a promise about the format.
- `GET /api/desktop/wallpapers/current/color`: the dominant highlight colour of
  that same wallpaper, as JSON, for clients that want the theme's accent
  without downloading and analysing the image. It resolves the variant and
  honours `?orientation=` exactly as the image routes do, and carries the same
  `X-Nova-Wallpaper-*` and `X-Nova-Theme-Variant` headers. The body has
  `highlight` (the raw extraction) and `contrast` (the same colour with its
  lightness clamped for legibility), each as hex, RGB and HSL, plus a
  `fallback` flag set when the wallpaper had no colour to find. 404 when the
  current theme has no wallpaper. Extraction rule and thresholds:
  `specs/desktop-theme-app-actions.md`.

Voice agent:

- `POST /api/voice/speaking`: nova-voice announces spoken-response start/end
  (`phase`, `turnId`, and on start the consonant `timingsMs`,
  `estimatedDurationMs`, `audibleOffsetMs`; on end `playedDurationMs`).
  Broadcast to every connected browser as the `voice-speaking` SSE event and
  replayed to clients that connect mid-speech (see Status Orb voice speaking
  behavior).

Climate controls:

- `POST /api/aircon/timer`: persist `aircon.offTimerEndsAt` as an ISO
  timestamp or clear it with `null`.
- `POST /api/panel-heater/timer`: persist `panelHeater.offTimerEndsAt` as an
  ISO timestamp or clear it with `null`.

Tasks:

- `GET /api/tasks?command=list`: list tasks.
- `GET /api/tasks?command=listen`: task-focused event stream compatibility.
- `GET /api/tasks?command=docs`: return task command docs.
- `POST /api/tasks?command=add`: add task.
- `POST /api/tasks?command=update`: update task.
- `POST /api/tasks?command=remove`: remove task.
- `PATCH /api/tasks`: update task.
- `DELETE /api/tasks`: remove task.
- `POST /api/tasks/bulk`: parse/import CSV tasks.
- `PATCH /api/tasks/[id]`: update task.
- `DELETE /api/tasks/[id]`: delete task.
- `POST /api/tasks/[id]/dismiss`: dismiss reminder alert only.
- `POST /api/tasks/[id]/chimed`: claim this occurrence's chime so no other
  screen and no later page load replays it.
- `POST /api/tasks/[id]/complete`: complete task.
- `GET /api/tasks/audio`: return reminder MP3 or status when `?status=1`.
- `POST /api/tasks/audio`: upload reminder MP3 using multipart form data.
- `DELETE /api/tasks/audio`: remove reminder audio.
- `GET /api/tasks/icloud-status`: return iCloud sync status.
- `POST /api/tasks/sync-icloud`: force iCloud sync.
- `ALL /api/tasks/mcp`: compatibility shim to `/api/mcp`.

Map/weather tiles:

- `GET /api/radar/[z]/[x]/[y]`: RainViewer radar tile proxy.
- `GET /api/satellite/[z]/[x]/[y]`: Esri satellite tile proxy.

MCP:

- `GET /api/mcp`: return MCP/server metadata.
- `POST /api/mcp`: JSON-RPC MCP endpoint.

System power:

- `POST /api/system/restart-stack`: queue a "restart everything short of a reboot"
  — what the System Power button uses. Writes a `restart-stack` request into the
  host control channel; the helper `docker restart`s Home Assistant and the other
  service containers, then bounces the dashboard last. Never self-exits (only the
  host helper can `docker restart` the other containers).
- `POST /api/system/restart-dashboard`: queue a dashboard-only restart. In
  production the route flushes a `{ queued, method: "self-exit" }` response and
  then calls `process.exit(0)` on the next tick; because the app is the sole
  process in the container the systemd unit launches with `Restart=always`,
  exiting relaunches a fresh container almost immediately, with no host helper or
  cron lag. In non-production it falls back to writing a `restart-dashboard`
  request into the host control channel so it never kills a dev server. Retained
  as a lower-level primitive; no longer wired to a UI button.
- `POST /api/system/reboot`: queue a host reboot by writing a `reboot-host`
  request into `data/system/control/`. A host-side helper performs the reboot;
  the containerised app never reboots the machine itself.

Miscellaneous:

- `GET /favicon.ico`: returns SVG icon content as `image/svg+xml`.
