# Tasks panel lists

Adeline, 2026-09-14. Plan `we-ve-separated-the-landscape-s-ancient-parnas`,
task log `20260914T101019Z-06c0031b`.

`app/components/TasksPanel.tsx`; the filter is `taskVisibleInTab` in
`app/components/tasks/task-model.ts`.

## Data model

`lib/tasks.ts` stores and manages tasks.

- Sources: `local`, `icloud-calendar`, `icloud-reminders`.
- Fields: `id`, `name`, `start`, `end`, `createdAt`, `dismissedAt`,
  `alertDismissedAt`, `alertDismissedFor`, `alertChimedFor` (the chime claim
  described under Task alerts and audio), `annoy`, `repeat`, `source`,
  `sourceId`, `sourceCalendar`, `occurrenceDate`, `readOnly`.
- Repeat support: hourly; morning-night (12-hour cadence); every N days
  (1–365). A repeat's duration must be shorter than its interval.
- Store behavior: a missing task file reads as empty; invalid rows are
  normalized or discarded; a completed repeating task advances to its next
  occurrence once the current one passes; an accidentally dismissed current
  repeating occurrence is repaired; mirrored/read-only iCloud tasks cannot be
  edited through the local update APIs; alert dismissal is separate from
  task completion; completing a repeating task advances it where
  appropriate; task operations broadcast task events to SSE clients.

## CSV task parser

Input format is `start,end,name[,repeat]`.

- Blank lines and comment lines are ignored.
- Time-only values use the reference date; a time-only end before the start
  rolls to the next day.
- Repeat values accept `hourly`, `morning-night`/`morning`/`night`, `days:N`,
  or a bare integer day count.

## Task import/export

- The import modal exposes iCloud status and Sync Now; CSV text can be
  previewed and validated before a bulk import posts to `/api/tasks/bulk`.
- Export emits local tasks as `start,end,name,repeat` text, with commas in
  task names replaced by spaces.

## Task editing

- Local tasks can be created and edited inline: name, start, optional end,
  repeat settings.
- iOS-style edit mode supports selection and deletion.
- Completing a task calls `/api/tasks/[id]/complete`; dismissing only the
  reminder calls `/api/tasks/[id]/dismiss`.
- Mirrored iCloud tasks show source metadata and are read-only; converting
  one to local clones it through the add API and deletes the mirrored local
  copy.
- Realtime updates arrive over `/api/events`; initial state loads from
  `/api/tasks?command=list`. `TasksPanel` is always mounted so current-task
  state is tracked even when the Reminders zone isn't selected, and a
  current-task bar can show while another zone is selected. Local time ticks
  every second. Status labels are Active, Due, Done, and Upcoming.

## Two lists, not two tabs

- The **Today** / **Upcoming** tab switch is gone. The panel shows **two lists,
  each under its own heading, Today on top** (Adeline, 2026-09-14). Portrait and
  landscape alike.
- Membership is unchanged: a reminder is in Today or Upcoming by exactly the
  rule `taskVisibleInTab` already applies, and in neither if it has ended
  before today.
- Headings are the panel's existing small uppercase heading style ("TODAY",
  "UPCOMING").
- An empty list keeps its heading and shows its existing empty line: "No
  reminders today" / "No upcoming reminders".
- Edit mode, selection, Delete, the row editor and Add behave as before across
  both lists; the Delete button that sat beside the tabs stays in that row.

## Done means

- Both headings render, Today first, each with its own reminders.
- `TasksPanel.test.ts` still passes; a render test covers the two headings and
  their order.

## Round 2 (Adeline, 2026-09-15)

Plan `we-ve-separated-the-landscape-s-ancient-parnas` round 2, task log
`20260914T101019Z-06c0031b`. The Reminders sub-panel is an `AdvancedFold`
(`specs/advanced-fold.md`) with the household timer above the line.

### Only the timer above the line

- Above the fold line: **the `TimerEncoder` and nothing else** (the panel's
  small heading may stay).
- Below the line: the Add / Edit / Import / Export actions, the edit-mode
  Delete row, the message banner, and the Today and Upcoming lists.

### The editor replaces the lists

- **Add** and **editing a reminder** show the editor **in place of** the
  Today/Upcoming lists (and the action row), inside the Advanced region. Only one
  editor is ever open.
- The editor's first row is a **back arrow** button (lucide `ArrowLeft`, labelled
  "Back" for assistive tech) that **cancels** — same effect as Cancel — and
  returns to the lists.
- **Save / Create is always reachable**: the editor scrolls inside its region
  and its Save/Cancel row stays visible (sticky at the bottom of the editor) at
  430×932, 820×1180 and landscape 1366×768.
- A read-only (iCloud) reminder opens its read-only panel in the same place,
  with the same back arrow.

### Icon

- The editor has an **Icon** row showing the reminder's current glyph as a
  button. Tapping it opens `ReminderIconPicker`. The choice is the **same roster
  glyph the reminder bar shows** — saved through the reminder roster (keyed by
  the normalised reminder name, as `RemindersConfig` does), not a new field on
  the task. For a new reminder it is written after the task is created, keyed by
  its name. Renaming a reminder carries its glyph to the new key.

### Width (Round 3, Adeline, 2026-09-16)

- **Landscape and portrait**: the Reminders sub-panel is the panel's own
  width — not doubled. The panel holding the `TimerEncoder` above the line is
  square: landscape (`data-axis="y"`) the Advanced region grows vertically as
  needed below the line; portrait (`data-axis="x"`) it grows horizontally as
  needed within the fold, same as every other `AdvancedFold` sub-panel. This
  replaces the Round 2 "twice its previous width" rule.
- Reminder events render as cards in a wrapping grid (`.task-card-grid`, min
  220px per card), not stacked rows, in both the Today and Upcoming lists.

### CI

- `lib/tasks.test.ts` "creates one wash reminder, arbitrates chimes and
  preserves acknowledgement" passes locally and failed on GitHub
  (`expected [false, true] to deeply equal [true, false]`). It must pass with
  `TZ=UTC` and `TZ=Pacific/Auckland`, independent of run order.

### Done means (round 2)

- Above the line only the timer shows; everything else is past it.
- Add and Edit replace the lists; the back arrow returns to them without saving;
  Save is visible without scrolling the page at 430×932.
- Choosing an icon in the editor changes that reminder's tile in the reminder
  bar.
- Width doubled in landscape; portrait cell up to 2× panel width.
- `TZ=UTC npx vitest run lib/tasks.test.ts` passes.

## No panel heading

Adeline, 2026-09-16: the panel has no "Schedule / Reminders" header. The
highlighted Reminders menu item already names it.

## Task alerts and audio

- Server alert scanning runs every second while clients are connected; a
  task alert is emitted as a rising edge when a task enters its alert
  window.
- Banners are a **per-device opt-in**, off by default:
  `nova.dashboard.reminderBanner.v1`
  (`app/components/dashboard/reminderBannerSetting.ts`), surfaced as the
  Reminder Banners checkbox in Appearance & Dashboard → Reminders. The
  switch covers the bottom bar and the full-screen overlay; it does not
  govern sound cadence, which is per-reminder (below).
  - Enabled: the client adds `task-alerting` to the body, shows the
    overlay/banner UI, and dismisses the alert (swallowing the tap) on a
    capture-phase tap outside the banner, or on the banner itself.
  - Disabled: no bottom bar or overlay renders, and the capture-phase tap
    swallow is not installed, so it doesn't eat taps meant for the reminder
    icon bar.
- Audio plays from `/api/tasks/audio` when an MP3 exists. A reminder chimes
  **once per occurrence, household-wide**: the first screen to play it
  claims the occurrence via `POST /api/tasks/:id/chimed`, which sets
  `alertChimedFor` to the alert session key and broadcasts the task; every
  other screen, and every later page load, sees the claim and stays quiet.
  Dismissing the alert also spends the chime, so dismissal implies silence
  even if the sound never played. `alertChimedFor` is cleared wherever
  `alertDismissedFor` is — repeat roll-forward, completion, or any
  reschedule that moves `start`/`end` — so a new occurrence gets a new
  chime.
- A reminder with `annoy: true` ("Keep chiming until dismissed" in the
  editor, off by default) is exempt from the once-per-occurrence claim: it
  repeats on the configured interval until dismissed, ended, or completed.
- The audio window and repeat interval come from
  `tasks.alertAudio.alertWindowMs` and `tasks.alertAudio.repeatMs`,
  delivered over `/api/config/client`. Browser audio blocking is logged
  rather than treated as fatal.

## Reminder icon bar

A fixed row of sigils between the clock and zones panels
(`app/components/dashboard/ReminderIconBar.tsx`), rendered on every device
regardless of the banner setting.

- Placement: portrait/narrow is a full-width row between the clock and zones
  panel; wide landscape (`min-width: 1126px` and `orientation: landscape`)
  moves the bar into the 300px sidebar column, centred under the status orb,
  sitting on top of the zones menu, with tiles wrapping within the column
  rather than overflowing it.
- Sigils come from a curated Phosphor catalogue (`lib/reminder-glyph.ts`,
  joined to components in `app/components/reminders/icon-registry.tsx`) plus
  a 1–2 character text glyph option.
- Assignments live in `lib/reminder-icons.ts`, keyed on the **normalised
  reminder name**, not the task id — iCloud mirrors get fresh ids on every
  sync and `updateTask` refuses to write to a mirrored task, so a name key is
  the only way a read-only Apple reminder can carry a user-chosen icon.
  Assignment order on first sight: existing entry (sticky) → keyword table →
  LLM → generic bell. The LLM step (`POST /v1/classify-icon` on the voice
  orchestrator, proxied to the loopback-bound `llama-server`, catalogue ids
  sent as an allow-list compiled into the response schema and re-validated
  on both sides) is asynchronous and best-effort — it never blocks or fails
  a reminder write.
- Bar membership: a repeating reminder (local `repeat`, or an iCloud RRULE
  recorded as `Task.recurs`) auto-joins; one-offs get a sigil but no tile.
  Toggling membership by hand sets `showInBarLocked` and the auto rule stops
  applying to that reminder.
- Tile state: dimmed to `dashboard.reminders.inactiveOpacity` when nothing is
  due, full opacity when due or active, and a slow glow pulse in the orb's
  alert colour once overdue past `dashboard.reminders.overduePulseAfterMs`
  (published as `--nova-alert-rgb` from the theme's avatar `gradientAlert`
  slot). Overdue is `isTaskOverdue` in `app/components/tasks/task-model.ts`,
  separate from `statusForTask` (which collapses everything past its end
  into "Done") — a repeating local task with an end rolls itself forward and
  so is never overdue; end-less reminders and iCloud mirrors are what
  actually reach the state.
- Tapping a tile completes its reminder. Pressing and holding for
  `undoHoldMs` within `undoWindowMs` of that tap restores it through
  `POST /api/tasks/[id]/uncomplete`, replaying a pre-completion snapshot —
  completing a repeating reminder also rolls it to the next occurrence, so
  clearing `dismissedAt` alone would not undo anything.
- Lite mode: everything here is CSS, so `html[data-nova-lite] *`
  neutralises the pulse; no rAF, no canvas, no polling of its own (the 1s
  tick and task feed are shared), so no `useLiteMode()` gate is required.
