# UX sounds — library and per-action assignment

Adeline, 2026-09-16. Plan `piped-wondering-mountain`, task log
`20260916T060507Z-6ebf8190`.

Before this, the dashboard had exactly one UI sound: a single MP3 the owner
uploaded into `DeviceTheme.controlSound`, stored as a data URL, played by a
document-wide click listener for every button and by the shared sliders on every
value crossing. There was no way to give the dial a different click from a
button, no way to hear the Advanced fold break, and nothing at all for lights.

This spec replaces that with a **sound library** on the server and a **per-action
assignment map** in the theme.

| File | Holds |
|---|---|
| `public/sounds/ux/*.mp3` | the built-in library clips, shipped with the app |
| `data/sounds/*.mp3` | uploaded library clips |
| `lib/sound-library.ts` | manifest shape, ids, slugging, normalisation |
| `app/api/sounds/route.ts` | list / upload / delete |
| `app/api/sounds/[id]/route.ts` | serve one uploaded clip |
| `app/components/accentColor.ts` | `DeviceTheme.uxSounds`, defaults, normalisation |
| `app/components/dashboard/controlSound.ts` | the playback engine, `playUxSound(action)` |
| `app/components/haptics.ts`, `HapticFeedback.tsx` | global dispatch from `data-ux-sound` |
| `app/components/AccentConfig.tsx` | the Sound accordion: library block + assignment block |

## The library

A library entry is `{ id, name, origin, bytes, updatedAt }`.

- `origin: "builtin"` — the clip is a file in `public/sounds/ux/`, served
  statically at `/sounds/ux/<id>.mp3`. Built-ins cannot be deleted or renamed.
- `origin: "upload"` — the clip is a file in `data/sounds/<id>.mp3`, served by
  `GET /api/sounds/<id>`. Uploads can be renamed and deleted.

The manifest of upload entries persists in `preferences.soundLibrary` through
`lib/preferences.ts`. Built-ins are not stored in preferences — they are derived
from a constant list in `lib/sound-library.ts` at read time, so adding a built-in
is a code change and never leaves an orphaned manifest row.

`id` is a slug: lowercase, spaces and punctuation collapsed to single hyphens, 60
chars max, uniquified with a `-2` / `-3` suffix on collision. `name` is the
display label, 120 chars max, defaulting to the uploaded file's basename without
its extension.

### The built-ins

Six clicks, sourced from `D:\Downloads\Click sounds\`:

| id | name |
|---|---|
| `chunky-mechanical-click` | Chunky mechanical click |
| `light-mechanical-click` | Light mechanical click |
| `medium-mechanical-click` | Medium mechanical click |
| `soft-mechanical-click` | Soft mechanical click |
| `light-ratchet` | Light ratchet |
| `medium-ratchet` | Medium ratchet |

Plus the six timer chimes, so a chime can be assigned to any action rather than
only the timer alert. Each is a byte copy of the matching `public/sounds/timer-*.mp3`
under a library id of its own; the timer picker keeps reading its own files, and
the `timer-chime` sentinel (whatever the theme's timer sound currently is) is
unchanged and still `timerAlert`'s default:

| id | name | copied from |
|---|---|---|
| `chime-classic` | Chime (classic) | `timer-chime.mp3` |
| `chime-magical` | Chime (magical) | `timer-magical.mp3` |
| `chime-motion-tracker` | Chime (motion tracker) | `timer-motion-tracker.mp3` |
| `chime-retro-boop` | Chime (retro boop) | `timer-retro-boop.mp3` |
| `chime-soft-boop` | Chime (soft boop) | `timer-soft-boop.mp3` |
| `chime-tink` | Chime (tink) | `timer-tink.mp3` |

Assigning `chime-classic` pins that clip; assigning the `timer-chime` sentinel
follows the theme's timer-sound setting.

### Upload limits

MP3 only, validated by MIME `audio/mpeg` or an `.mp3` extension, as
`app/api/tasks/audio/route.ts` does. Maximum 1 MB per file, the existing
`CONTROL_SOUND_FILE_MAX_BYTES`. Maximum 40 uploaded entries. The route follows the
task-audio pattern throughout: `runtime = "nodejs"`, `dynamic = "force-dynamic"`,
`formData()` plus `File` validation, recursive `mkdir` before `writeFile`, a
descriptive error string on rejection, and a status push through
`lib/dashboard-events.ts` so open dashboards learn about a new clip without
polling.

Deleting an entry that is still assigned to an action leaves the assignment
dangling; a dangling id resolves to **the button-press default**, not to silence,
so a deleted clip never quietly kills an action.

## The twelve actions

`DeviceTheme.uxSounds` maps each action to a **sound id**, the sentinel
`"button-press"`, or `null`.

| Action | Fires when |
|---|---|
| `unlockDial` | A `RotaryEncoder` unlocks (tap of 60–400 ms, under 5 px travel), or the status orb dial unlocks. Once per unlock, never on re-lock. |
| `dialClick` | One per detent crossed — a `RotaryEncoder` LED cycle step, a ring value step, and each orb-dial step through the stack. |
| `foldBreak` | `AdvancedFold` crosses the rubber-band hurdle and opens. Not on a dead break, where there is nothing to open onto. |
| `foldHeal` | `AdvancedFold` closes back to the boundary — by drag, inertia, wheel or manual scroll. Not on the unconditional close at mount or axis flip. |
| `sectionChange` | A zone or menu selection changes the selected panel. Not when the same panel is re-tapped. |
| `buttonPress` | Any other enabled `button` / `[role="button"]` click, and every shared-slider value crossing. Today's behaviour. |
| `timerAlert` | The household timer completes — each repeat of the 30 s / 5 min cadence. |
| `reminderAlert` | A task reminder alert opens, and each repeat within its audio window. |
| `reminderConfirm` | A reminder or wash occurrence is acknowledged. |
| `timerSet` | `TimerEncoder` de-focuses with a non-zero value and the timer starts. Never on a drag to zero — cancellation is silent, per `specs/status-orb-stack.md`. |
| `lightsOn` | A light this surface commanded comes on from fully off. |
| `lightsOff` | A light this surface commanded goes fully off. |

### Precedence

Exactly one action fires per gesture. The more specific one wins:

- A zone or menu button fires `sectionChange` only; `buttonPress` is suppressed.
- A dial detent fires `dialClick` only; the unlock tap that preceded it fired
  `unlockDial` and nothing else.
- A fold break or heal driven by a gesture fires only the fold action.

Elements declare themselves with a `data-ux-sound="<action>"` attribute. The
global click listener in `HapticFeedback.tsx` walks up from the event target to
the nearest element carrying one, and falls back to `buttonPress`. An element
carrying `data-ux-sound="none"` is silent — that is how a control which plays its
own sound at a more precise moment opts out of the generic click.

### Lights on and off

These are tied to no panel. They fire on the **transition**, not on the command:

- **Off** means brightness reaches zero, matching `specs/zone-light-events.md` —
  brightness is the on/off axis.
- **On** means a light that was fully off reports non-zero brightness.
- The sound plays **only on the surface that issued the command**. The client that
  sent the command plays it locally once the state it commanded lands; no server
  attribution is added, and no other screen chimes. A light changed by a physical
  switch, by voice, or by a Home Assistant automation is silent everywhere.
- **Once per command**, even when the command covers a whole zone of lights. A
  zone going from mixed to fully off plays `lightsOff` once.
- A command that changes colour or brightness without crossing the on/off
  boundary plays neither.

## Defaults

Every action in every theme, built-in and saved preset, defaults to the sentinel
`"button-press"` — except two, which keep the sound they already had, so that
adding this feature does not quietly disable a deliberate choice:

- `timerAlert` defaults to the theme's existing `timerSound` chime
  (`/sounds/timer-*.mp3`).
- `reminderAlert` defaults to the uploaded reminder MP3 (`/api/tasks/audio`).

The sentinel `"button-press"` resolves at playback time to the theme's existing
`controlSound` clip. It is listed in every assignment dropdown as **"Button press
(theme)"**. Because it is a sentinel rather than a copied id, re-uploading the
theme's control sound changes every action still sitting on the default — the
behaviour the single-sound design had.

`null` is **"None"** and is the **first** option in every assignment list.

## Playback

`playUxSound(action)` replaces `playControlSound()`.

- Resolution order: the theme's `uxSounds[action]`; `null` returns immediately;
  `"button-press"` or a dangling id resolves to the theme's `controlSound`
  source; any other id resolves to that library clip's URL.
- Decoded `AudioBuffer`s are cached **per sound id**, not as the single
  `decodedSource` / `decodedBuffer` pair the old engine used. A clip is decoded on
  first use and pre-decoded when it is newly assigned, so the first press after an
  assignment change is not swallowed.
- The **two-newest-voices cap** is unchanged and stays global across actions: a
  third overlapping voice trims the oldest with the same 20 ms release ramp.
- Volume stays the single `controlSound.volume` slider, applied to every action.
  There is no per-action volume.
- The `AudioContext` is still created lazily and resumed on the first gesture.

## Config UI

Both blocks live in the existing **Sound** accordion of `AccentConfig.tsx`, below
the `timerSound` selector, replacing today's single upload row.

**Sound library** — a list of entries, each with its name, a preview button, and
for uploads a rename field and a delete button. Below the list, one upload control
reusing `ControlSoundConfig`'s existing file handling. Built-ins are listed first,
then uploads, each group alphabetical by name.

**Sound assignments** — twelve `ConfigSelect` rows in the order of the action
table above, each labelled with the action's plain-English name. Every list reads
`None`, then `Button press (theme)`, then the library entries in the same order
the library block shows them.

Both blocks obey the parameter-group structure rule and carry no explanatory UX
prose.

## Theme plumbing

`uxSounds` is a `DeviceTheme` field, so it rides the shared config, the theme
library and section copy/paste exactly as colours do. It joins `controlSound` in
`themeSections.ts`'s `sound` section, so copying the Sound section between theme
variants carries the assignments with it.

`normalizeTheme` passes `uxSounds` through a `normalizeUxSounds` that fills any
missing action with its default and drops any key that is not one of the twelve.
A theme saved before this change therefore reads back with a complete default map,
which is the migration — there is no separate migration step.

**New sub-object warning.** `uxSounds` is a new preference sub-object; it needs
its own merge branch wherever theme objects are merged, or a partial write wipes
it.

## Done means

- The six clicks are selectable on every one of the twelve actions.
- Uploading an MP3 in config adds it to every assignment dropdown without a
  reload.
- Setting an action to None silences exactly that action and nothing else.
- Switching theme switches the whole set of assignments.
- Saving a theme preset and loading it back restores the assignments, and the
  saved preset JSON contains **no audio bytes**.
- Turning a light fully off from the dashboard plays `lightsOff` on the surface
  that did it and on no other; flipping the physical switch plays nothing
  anywhere.
- The Advanced fold break and heal are audible and distinguishable.
