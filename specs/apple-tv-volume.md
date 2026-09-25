<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# The Apple TV (amplifier) dial

Adeline, 2026-09-22. **Placeholder for the IR emitter** that will control the
amplifier's volume and power state. That endpoint and the emitter's own design
do not exist yet, so the dial is built now, mounted where it will live, and used
to fine-tune the layout. Its **volume reading sends nothing** — that stays a
placeholder until the emitter exists — while its **mute** goes to the Apple TV
(§The dial's mute) and its **preset buttons** hand the playlist's name to our own
app on the television (§Play, which also says the one thing that channel cannot
do).

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
playing the playlist? Let's make that work"* — and then, when the first version
played whatever the Music app happened to have queued: *"it's meant to play the
playlist that the preset is associated with it."*

`POST /api/appletv/play` (`app/api/appletv/play/route.ts`) takes the preset's
position, reads the stored list for it, and then:

1. `media_player.turn_on` — only when the entity reads `off`/`standby`, and then
   it **waits** for the device to be awake (the Companion wake is a request, not
   a state change, and an app launched into a sleeping device is lost silently).
2. `media_player.play_media` with `app` / `nz.co.skull.NovaAppleTVDashboard` —
   brings **our own app** forward, by bundle id rather than by the name it
   happens to have in the app list. Both bundle ids live in
   `lib/apple-tv/apps.ts`.
3. Leaves it a **play command** (`lib/appletv-command.ts`, stored at
   `data/appletv-command.json`), written *after* the launch so the app is on
   screen and polling before the command exists to be missed.
4. `media_player.shuffle_set` and `media_player.repeat_set` from the preset, best
   effort — `endless` asks for repeat-all, the closest pyatv knows (its states
   are off/all/track). A refusal here is not a failed press: the app is what
   plays the playlist.

### The app plays it, because it is where the MusicKit session is

`PresetPlaybackStore`
(`nova-appletv-dashboard/NovaAppleTVDashboard/PresetPlaybackStore.swift`) polls
`GET /api/appletv/command` every two seconds, skips any command id it has already
run (kept in `UserDefaults`, so a relaunch does not replay a press), resolves the
preset's **name** against her Apple Music library (`MusicLibraryRequest<Playlist>`,
matched case- and accent-insensitively) and plays **that playlist** through
`SystemMusicPlayer` — the Music app's own player, so what plays is the playlist
rather than a queue of loose songs, playback carries on after our app leaves the
screen, and the phonoscope keeps visualising it.

**Shuffle starts somewhere in the playlist, not at its first song** (Adeline,
2026-09-22). Queuing the playlist takes the entry playback begins on, so a preset
with its shuffle switch on starts on a **random entry** and an unshuffled one
starts on the first — the switch's promise is honoured at the moment it matters,
rather than only by the Music app's own shuffle mode.

**The modes are set on the queue the app has just assigned** — shuffle from the
preset's switch, repeat from its playback type — *before* playback starts, rather
than only by the dashboard's best-effort `shuffle_set` / `repeat_set`: a looping
preset would otherwise loop only while that fire-and-forget Home Assistant call
succeeded, and assigning a fresh queue can itself reset the modes. The mapping
fails **closed**, as the dashboard's own normalisation does — only the two values
it actually writes (`all`, `infinite`) loop, anything else plays the playlist once
rather than looping it on a misspelling, and a record carrying no `repeat` key at
all still plays, its absence meaning play once rather than "do nothing".
`infinite` maps to repeat-all because the television has no endless mode, the
same instruction `REPEAT_STATE` gives pyatv. MusicKit's `SystemMusicPlayer` has
no shuffle or repeat setting, so the modes go through MediaPlayer's
`MPMusicPlayerController.systemMusicPlayer`.

**And the screen belongs to Apple Music, not to our app.** Once the app reports
that playback started, `POST /api/appletv/command/result` brings the Music app
forward, so the television shows Apple Music playing the playlist with our app
behind it. The app is the launcher — the only thing that can turn a name into a
playlist — not the surface (Adeline, 2026-09-22: *"I don't wanna play them
through the app, can we play them through normal apple music on apple tv?"*).

**Unverified on the device, and it is worth watching the first time:** that the
app reports playback as started *before* the Music app is launched, so the
television is already playing when the screen changes, and that bringing the
Music app forward does not disturb the queue the app just set (both drive the
same system player, but that is reasoning rather than a measurement — the set was
in use while this was written), and that the modes set through
`MPMusicPlayerController.systemMusicPlayer` reach the player actually running
MusicKit's queue: two different objects, tied only by Apple's documentation that
both control the Music app, with nothing in the app that could notice if they
did not. And that a report only moves the screen for the press it belongs to:
the forward is sent for every successful report, including one a later press has
already superseded, so pressing again while the first press is still reporting
can bring the Music app forward while the newer command waits for our app to poll
- and a backgrounded app is free to be suspended, which delays that press and
drops it once its window expires. The guard, if this reproduces: skip the forward
when a newer command has already been written.

**A name that matches no playlist plays nothing.** The wrong music is worse than
silence, so there is no fallback to "whatever was loaded": the app reports
`NO PLAYLIST NAMED <NAME>` through `POST /api/appletv/command/result`, and
`GET /api/appletv` carries it to the editor, which shows it under the list
("Last press: …") — the preset's name is the thing to fix. A command older than
two minutes is not handed over at all, so a press made while the television was
asleep cannot start music when it next wakes.

### Why the dashboard cannot do this itself — measured, not assumed

HA's `apple_tv` integration is pyatv: transport and metadata, with no view of the
library. The one deep-link route that exists — the Companion `_launchApp` with a
URL, which HA's `play_media` reaches by passing `media_content_type: "url"` — was
tried against the real television with both an `https://music.apple.com/…/playlist/…`
link and its `music://` form, and neither did anything
(`media_player.home_theatre` stayed `paused` on the same item, no app or title
change).

The three routes considered, and Adeline's choice (2026-09-22):

| Route | Verdict |
|---|---|
| **Our own tvOS app plays it through MusicKit** | **Chosen.** The app already holds a MusicKit session for the phonoscope (`SystemMusicPlayer`, `MusicAuthorization.request()`), so nothing new has to be paired or consented to; `SystemMusicPlayer` and `MusicLibraryRequest` are both available on tvOS |
| Music Assistant with the Apple Music provider | Held back: a real install plus MusicKit developer and user tokens |
| Spotify instead of Apple Music | Held back: it would change which service the presets use |

The entity comes from the household config's `power.ampPowerControl.sourceEntityId`,
the same one the amp controller follows; product code names no device.

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

- **The volume reading is a placeholder.** It lives in one page store
  (`app/components/dashboard/appleTVAmpClient.ts`) so the two mounts on screen at
  once agree — the way the climate knobs share one command instance — and nothing
  is stored on the host: the amplifier's own volume is the IR emitter's job, and
  that endpoint does not exist. (The *mute*, which used to be a placeholder
  beside it, is wired — the bullet below.)
- **The mute is the Apple TV's, wired as `volume_set`.** The Apple TV reports
  `SetVolume` and `VolumeUp`/`VolumeDown` and **no** `VolumeMute`, and nothing
  reads its level back (`volume_level` is absent, so the `Volume` feature is
  unsupported). Asked which way to go, Adeline chose (2026-09-22): mute as
  `volume_set 0`, and unmute restoring the level **the dial is holding** —
  accepting that the number restored is the dashboard's rather than the
  amplifier's, because there is no other honest number to read.

  `POST /api/appletv/mute` takes `{ muted, level }`, `level` being the dial's
  0–100 reading, so the light and the reading can never disagree about what was
  asked for. The reading flips at once and rolls back if the television refuses
  — a later tap keeps its own answer rather than being undone by an earlier
  failure — which is what `appleTVAmpMute.test.tsx` pins.

  **The dial's volume reading is still the page store's**, and the amplifier's own
  volume remains the IR emitter's job; whether the Apple TV's *own* volume
  reaches this amplifier (over CEC, or its IR blaster) has not been exercised on
  the device — the first mute tells, and the spec will say which it turned out to
  be.
- The demo build **sends nothing** for a press: it has no television behind
  `/api`, the same way its list is kept in sessionStorage, and
  `e2e/apple-tv-dial.spec.ts` asserts that turning the dial or pressing a preset
  writes nothing there. The command path itself is what the route tests cover —
  `app/api/appletv/play/route.test.ts`, `command`, `command/result` and
  `lib/appletv-command.test.ts` — and what the released build is verified against
  the real television with.
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
- **Pressing a preset plays the playlist it names, and marks nothing**: the
  Apple TV wakes if it is asleep, our own app comes forward, and it resolves the
  preset's name against the Apple Music library and starts that playlist through
  `SystemMusicPlayer`, with the preset's shuffle and repeat applied. No button is
  left `aria-pressed`. A name that matches no library playlist plays nothing and
  says so (§Play), rather than falling back to whatever was loaded.
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
  `app/api/appletv/play/route.test.ts` (the press: the wake, the app launch,
  the command left behind, the refusals), `app/api/appletv/mute/route.test.ts`
  and `appleTVAmpMute.test.tsx` (the mute and the dial's side of it),
  `app/api/appletv/command/route.test.ts`
  and `command/result/route.test.ts` (the handover and the app's answer),
  `lib/appletv-command.test.ts` (the record, its ids and its window),
  `appleTVPlayResult.test.ts` (the editor's reader),
  `zones/AppleTVPlaylistEditor.test.tsx`,
  `zones/AppleTVPlaylistEditorSaves.test.tsx`,
  `zones/AppleTVPlaylistEditorControls.test.tsx`.
  e2e: `e2e/apple-tv-playlists.spec.ts` (the editor: its list, the icon picker
  and the playback pair) and `e2e/apple-tv-dial.spec.ts` (the dial, its preset
  row and both mounts), which share `e2e/apple-tv-dial.fixtures.ts`.
