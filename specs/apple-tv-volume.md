# The Apple TV (amplifier) dial

Adeline, 2026-09-22. **Placeholder for the IR emitter** that will control the
amplifier's volume and power state. The hardware endpoint and the emitter's own
design do not exist yet, so the dial is built now, mounted where it will live,
and used to fine-tune the layout. It sends nothing.

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

- Every playlist in the list is one button under the dial: icon-only (a note),
  with the playlist as its accessible label and its state in `aria-pressed`.
  The names are long — "Sword Smoke & Temple Drums" is one of the three shipped
  — which is why the buttons carry no written label on either surface.
- **The list is typed in, not fetched**: the Apple TV exposes no playlist list
  to the dashboard, so there are no favourites to read either and a drop-down
  would be a list of nothing. When an endpoint that can read the library lands,
  this becomes a `ConfigSelect` over it and the free-text rows go.
- **The three shipped playlists** are `Excellent`, `Sword Smoke & Temple
  Drums` and `Cool` (`lib/apple-tv/playlists.ts`), stored in
  `dashboard.appleTV.playlists` and edited in the Lounge panel's Advanced
  section, under House Party. At most six, each up to 60 characters; blanks,
  duplicates and spacing are normalised on the way in, by the client and by
  `/api/appletv` alike, so a hand-typed name cannot break a preset row.

## What is not wired yet

- The volume, the mute state and the chosen playlist are **placeholders**: no
  command is sent and nothing about them is stored on the host. They live in one
  page store (`app/components/dashboard/appleTVAmpClient.ts`) so the two mounts
  on screen at once agree — the way the climate knobs share one command
  instance — and `e2e/apple-tv-dial.spec.ts` asserts that pressing them sends no
  write.
- The playlist list *is* stored, because it is configuration rather than device
  state: `GET`/`PUT /api/appletv`, through the dashboard's own preferences.
- When the emitter's endpoint exists, this becomes a real command path: the
  store's setters grow a `fetch`, and the dial, its ring and its presets stay as
  they are.

## Done means

- Quick Access shows the Apple TV dial on the first line with the lighting dial,
  the two climate dials on the next, and each dial's presets just under it.
- Tapping the dial's lights toggles mute (face `MUTED`, mute light lit); turning
  it changes the reading; the ring is the blue-green gradient.
- The Lounge panel mounts the same dial at the same size as its lighting dial,
  on one centre line, and the playlist editor lists the three playlists in the
  panel's Advanced section under House Party.
- Adding a playlist adds a preset button on both mounts; removing one takes it
  away; the list survives a reload. A name another row already carries is
  refused with a message rather than saved — the list drops duplicates on the
  way in, so storing one would make the other row vanish unexplained — and each
  new row is named uniquely, so two "Add playlist" clicks add two rows.
- A save that fails leaves the dial and the editor showing the list the host
  still has, not the one it rejected.
- Unit tests: `lib/apple-tv/playlists.test.ts`,
  `app/components/appleTVEncoderModel.test.ts`, `AppleTVEncoder.test.tsx`,
  `appleTVPresets.test.tsx`. e2e: `e2e/apple-tv-dial.spec.ts`.
