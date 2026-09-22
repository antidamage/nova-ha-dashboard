# The Apple TV (amplifier) dial

Adeline, 2026-09-22. **Placeholder for the IR emitter** that will control the
amplifier's volume and power state. That endpoint and the emitter's own design
do not exist yet, so the dial is built now, mounted where it will live, and used
to fine-tune the layout: **its volume and mute send nothing**. Its **preset
buttons do** — see §Play for the five commands a press sends, and for the one
thing the channel cannot do.

## The control

- `AppleTVEncoder` — `app/components/AppleTVEncoder.tsx`, built on
  `RotaryEncoder` like every other Nova knob. Its colour and level maths are
  `app/components/appleTVEncoderModel.ts`.
- **The knob turns the volume**, 0–100 in whole percent, and the reading sits on
  the knob's face where the climate knob keeps its target: `42%` above the
  lights, the mode word (`VOLUME` / `MUTED`) below them. The name **Apple TV**
  curves over the top.
- **Cycling the modes toggles mute** (Adeline's words). The two lights across
  its face are the modes — volume, then mute — and tapping the lights cycles
  them. Entering the mute light mutes and cycling back to volume unmutes, so one
  piece of state (`muted`) is the whole of it: the lit light, the face word, the
  ring's glow and what a caller is told can never disagree.
- **The ring is blue-green** (`#0e7f7a` → `#1fc9a6` → `#6ef0cf`) and its colour
  gradient runs **top to bottom** (`180deg`), the direction every other dial's
  ring takes — brightest at 12 o'clock, deepest at 6, with the knob's own sunken
  shading over it (`rotary-knob-face.css`; the unlock band writes the same
  convention out in `rotary-unlock-ring.css`). It is never a conic or radial
  sweep: the dials must not vary from each other (Adeline, 2026-09-22). The pale
  band's share grows with the volume — the usual subtle gradient shift — and one
  test pins the direction so it cannot drift back. The level alone decides the
  fill colour and the glow; a muted amp's glow is out entirely.
- **The glow is the same glow every dial has**: keyed to the dial's own colour
  and scaled by the level, gone while muted. *Corrected 2026-09-22:* it shipped
  reading that colour back through the hex parser, which produced `rgba(NaN, …)`
  — a value a browser drops — so this dial had no glow at all while every
  sibling had one. Both the model's tests and the dial's now reject a malformed
  glow, and the model test compares its channels with `volumeColour`.
- 50–200px, the colour knob's own floor and ceiling; the title arc, the
  light/dark knob skin and tuck-away all come from the base.

## Where it is mounted

Two mounts, the way every Nova knob has a Quick Access one and a panel one:

- **Quick Access, its own segment** — `QuickAppleTVSegment`
  (`app/components/dashboard/quick-access/QuickAppleTVSegment.tsx`), on the
  card's **first line** beside the lighting dial. The second line is the two
  climate dials (Adeline, 2026-09-22), which is what `specs/quick-access-card.md`
  describes in full.
- **The Lounge lighting zone panel**, beside that zone's lighting dial: the two
  dials are the same size at half the panel's 200px, so both fit as a pair
  (`LOUNGE_PAIR_DIAL_SIZE`, `ZoneControls.tsx`). The colour dial's wrapper
  padding is dropped in the pair so the two knobs share one centre line.

## The presets: Apple Music playlists

- Every preset in the list is one button under the dial: icon-only (the icon the
  editor gave it, the note until one is chosen), with the playlist **and how it
  plays** as its accessible label — `Play Excellent on the Apple TV (shuffled,
  endless)`. The names are long — "Sword Smoke & Temple Drums" is one of the
  three shipped — which is why the buttons carry no written label on either
  surface, and why the playback type has nowhere else to be read on them.
- **A press is one shot** (Adeline, 2026-09-22): it fires the preset's play
  event and lights nothing. The store holds no "chosen" preset, because a button
  left lit reads as *this is what is playing now* — an answer only the Apple TV
  could give, and one nothing reads back yet (see §Play, below).
- **The list is typed in, not fetched**: the Apple TV exposes no playlist list
  to the dashboard, so there are no favourites to read either and a drop-down
  would be a list of nothing. When an endpoint that can read the library lands,
  this becomes a `ConfigSelect` over it and the free-text rows go.

## Play: what a press actually does

Adeline, 2026-09-22: *"if I hit a preset, will it turn on the apple tv and start
playing the playlist? Let's make that work."* — and it does what the channel
allows, which is everything except choosing **which** playlist.

`POST /api/appletv/play` (`app/api/appletv/play/route.ts`) takes the preset's
position, reads the stored list for it, and then commands Home Assistant:

1. `media_player.turn_on` — only when the entity reads `off`/`standby`, then it
   **waits** for the device to be awake (the Companion wake is a request, not a
   state change, and an app launched into a sleeping device is lost silently).
2. `media_player.play_media` with `app` / `com.apple.TVMusic` — brings the Music
   app forward. The bundle id, not the name, so a television set to another
   language still launches the right app.
3. `media_player.shuffle_set` and `media_player.repeat_set` from the preset —
   `endless` asks for repeat-all, because pyatv knows only off/all/track and has
   no endless mode to request.
4. `media_player.media_play` — start.

**The playlist itself cannot be chosen, and this is measured, not assumed.** HA's
`apple_tv` integration is pyatv: it drives the Music app's transport and reads
its metadata, and it has no view of the library. The one deep-link route that
exists — the Companion `_launchApp` with a URL, which HA's `play_media` reaches
by passing `media_content_type: "url"` — was tried against the real television
with both an `https://music.apple.com/…/playlist/…` link and its `music://`
form, and neither did anything (`media_player.home_theatre` stayed `paused` on
the same item, no app or title change). The Music app registers no URL scheme to
deep-link into a playlist, so the press resumes what Music has queued and wears
the preset's settings on it.

The entity comes from the household config's `power.ampPowerControl.sourceEntityId`,
the same one the amp controller follows; product code names no device.

The three routes that would make the playlist itself selectable:

| Route | What it takes |
|---|---|
| A tvOS app of ours (the `Nova TV` app is already on the set) | MusicKit playback of a playlist — worth a spike, since it needs a command channel and a Swift build, and tvOS MusicKit has availability gaps |
| Music Assistant with the Apple Music provider | an install plus MusicKit developer/user tokens, and a player to receive it |
| Spotify instead of Apple Music | the Apple TV is a Spotify Connect target, so `media_player.play_media` with a playlist URI does the job |

Until one of those is chosen, a preset is "turn the Apple TV on and start Music",
not "play *this* playlist".
- **The three shipped presets** are `Excellent`, `Sword Smoke & Temple Drums`
  and `Cool` (`lib/apple-tv/playlists.ts`), stored in `dashboard.appleTV.playlists`
  and edited in the Lounge panel's Advanced section, under House Party. At most
  six, each name up to 60 characters; duplicates and spacing are normalised on
  the way in, by the client and by `/api/appletv` alike, so a hand-typed name
  cannot break a preset row. An entry carrying **no name at all** is refused with
  a 400 rather than dropped — the list is written whole, so storing a shorter one
  would answer 200 and take that button off the dial.
- A stored list is a list of **presets**, not of names:
  `{ name, icon, shuffle, repeat }`. The shipped default file still holds bare
  names, and those read as presets with nothing set — the file outlives the
  build that wrote it, and both the route and the model test that path. Reading
  a file also drops what a *request* is refused for: a blank name, or an entry
  with none at all.

## The icon a preset's button wears

Adeline, 2026-09-22: an icon per preset, chosen in the editor.

- The catalogue is `lib/apple-tv/preset-icons.ts` — 26 curated marks, each with
  the label the picker draws under it. The **default is no choice at all**: a
  preset with `icon: null` wears the note, which is also the picker's first
  tile, so an icon is taken back off a button by choosing the note.
- `app/components/dashboard/appleTVPresetIcon.tsx` joins those ids to their
  Lucide components, for the same reason the reminder sigils split that way: the
  route validates a stored choice without pulling React, or 26 icons, into the
  Node runtime. A dev tripwire logs a catalogue id with no component, and a unit
  test pins **each id to its own** Lucide component — which is how `Barbell` was
  caught not existing in Lucide v1.8 (`Dumbbell` is the real export).
- `AppleTVPresetIconPicker` is the **same modal and the same tile treatment as
  the reminder sigil picker** — `ModalOverlay` over `reminder-picker-grid` /
  `reminder-picker-option` — with this feature's own catalogue: the reminder set
  is grouped by reminder life-area and carries no music mark at all, so pointing
  this picker at it would offer a washing machine for a playlist.

## The playback type: shuffle, and how it plays through

Adeline, 2026-09-22: a playback type per preset, chosen in the editor.

- **Two controls, because they are two independent answers.** Shuffle is a
  switch (`aria-pressed`, stored as `shuffle: boolean`); the repeat button
  **cycles** the three ways Apple Music plays a playlist through — `Play once`,
  `Loop`, `Endless` — and shows the one it is on, in its label and in its
  accessible name (`Repeat Excellent: Loop`, so a cycling control is never a
  mystery to a screen reader). The cycle is play once → loop → endless → play
  once, which is the order the modes are declared in
  (`REPEAT_MODES`), and it is stored as `repeat: "off" | "all" | "infinite"`.
- **Only a real answer lights the button**: play once is what a playlist does
  when nobody says otherwise, so it stays quiet while shuffle, loop and endless
  take the highlight (`data-preset-shuffle` / `data-preset-repeat`).
- Nothing is retyped to change them: the icon and the playback type save the
  moment they are chosen, and both ride into the play event with the name.

## What is not wired yet

- **The volume and the mute state are placeholders.** They live in one page store
  (`app/components/dashboard/appleTVAmpClient.ts`) so the two mounts on screen
  at once agree — the way the climate knobs share one command instance — and
  nothing is stored on the host: the dial's reading and its mute are the
  amplifier's own, and the IR emitter that will drive them has no endpoint.
- **The mute is left alone on purpose, and this is the measurement.** The Apple
  TV reports `SetVolume` and `VolumeUp`/`VolumeDown`, and it reports **no
  `VolumeMute`** — so the Apple TV cannot be asked to mute. It can be asked to
  set a level, but nothing reads the level back (`volume_level` is absent, so
  the `Volume` feature is unsupported), which leaves an unmute with no honest
  value to restore: it would be the dashboard's remembered number, not the
  amplifier's, and the amplifier would jump to it. Adeline's instruction was
  *"it can be the apple TV that mutes, if possible; if not leave mute state for
  now"*, so it is left, and this is the why. A `volume_set(0)` mute is a
  one-line follow-up if she would rather have a mute that cannot restore.
- The demo build **sends nothing** for a press: it has no television behind
  `/api`, the same way its list is kept in sessionStorage, and
  `e2e/apple-tv-dial.spec.ts` asserts that turning the dial or pressing a preset
  writes nothing there. The command path itself is what
  `app/api/appletv/play/route.test.ts` covers, and what the released build was
  verified against the real Apple TV with.
- The preset list *is* stored, because it is configuration rather than device
  state: `GET`/`PUT /api/appletv`, through the dashboard's own preferences.

## Done means

- Quick Access shows the Apple TV dial on the first line with the lighting dial,
  the two climate dials on the next, and each dial's presets just under it.
- Tapping the dial's lights toggles mute (face `MUTED`, mute light lit); turning
  it changes the reading; the ring is the blue-green gradient.
- The Lounge panel mounts the same dial at the same size as its lighting dial,
  on one centre line, and the playlist editor lists the three presets in the
  panel's Advanced section under House Party.
- Adding a preset adds a preset button on both mounts; removing one takes it
  away; the list survives a reload. A name another row already carries is
  refused with a message rather than saved — the list drops duplicates on the
  way in, so storing one would make the other row vanish unexplained — and each
  new row is named uniquely, so two "Add playlist" clicks add two rows.
- **Pressing a preset fires its play event and marks nothing**: the Apple TV
  wakes if it is asleep, the Music app comes forward, the preset's shuffle and
  repeat are applied, playback starts, and no button is left `aria-pressed`.
  Which *playlist* plays is the one part the channel cannot do — §Play has the
  measurement and the three routes that would change it.
- A press that fails reports why (the route's message lands in the store's error,
  which the editor shows), and a preset position that has no preset is refused
  rather than playing something else.
- **Each preset's button wears the icon the editor gave it**, and the note until
  one is chosen; choosing the note in the picker takes an icon back off. Renaming
  a preset keeps both its icon and its playback type.
- **The repeat button cycles Play once → Loop → Endless**, saving each, and
  shows the one it is on; the shuffle switch turns on and off. Both are per
  preset: switching one row's shuffle leaves its neighbours alone.
- A save that fails leaves the dial and the editor showing the list the host
  still has, not the one it rejected.
- Unit tests: `lib/apple-tv/playlists.test.ts`,
  `lib/apple-tv/preset-icons.test.ts`, `appleTVEncoderModel.test.ts`,
  `AppleTVEncoder.test.tsx`, `appleTVPresets.test.tsx`,
  `appleTVPresetIcon.test.tsx`, `app/api/appletv/route.test.ts`,
  `app/api/appletv/play/route.test.ts` (the press: the wake, the app launch, the
  preset's shuffle and repeat, the refusals),
  `zones/AppleTVPlaylistEditor.test.tsx`,
  `zones/AppleTVPlaylistEditorSaves.test.tsx`,
  `zones/AppleTVPlaylistEditorControls.test.tsx`.
  e2e: `e2e/apple-tv-playlists.spec.ts` (the editor: its list, the icon picker
  and the playback pair) and `e2e/apple-tv-dial.spec.ts` (the dial, its preset
  row and both mounts), which share `e2e/apple-tv-dial.fixtures.ts`.
