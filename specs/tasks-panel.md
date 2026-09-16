# Tasks panel lists

Adeline, 2026-09-14. Plan `we-ve-separated-the-landscape-s-ancient-parnas`,
task log `20260914T101019Z-06c0031b`.

`app/components/TasksPanel.tsx`; the filter is `taskVisibleInTab` in
`app/components/tasks/task-model.ts`.

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

### Width

- **Landscape**: the Reminders sub-panel is twice its previous width.
- **Portrait**: the reminders Advanced cell may be up to twice the panel's width
  and scrolls sideways within the fold.

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
