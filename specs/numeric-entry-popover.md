# Numeric entry popover on Nova's sliders

Produced by plan `add-a-feature-to-optimized-nygaard`
(`~/.claude/plans/add-a-feature-to-optimized-nygaard.md`), 2026-08-22.

## Why

Every Nova slider is drag-only. `EnvelopeSliderControlPanel` even carries a
comment saying the ramp control deliberately has no numeric readout because it
"is dragged, not read off". That is fine for feel and useless for precision:
there is no way to set a Visualiser ramp attack to exactly 0.25s, and on the
Nocturnium touchscreen dragging is the only affordance there is.

A tap — press and release without dragging — on any slider opens a small
numeric field above the control, already focused, so a value can be typed.

## Scope

The behaviour belongs to the shared primitives in
`app/components/DotControls.tsx`, so it applies app-wide:

| control | thumbs the popover can target |
|---|---|
| `DotLineControl` | the single value |
| `DotRangeControl` | minimum, maximum |
| `DotEnvelopeControl` | attack, hold, release |

`DotSpectrumControl` is a colour picker and is **out of scope**.

Controls may opt out with a prop (`numericEntry={false}`), not by special-casing
a call site.

## Gesture contract

**A tap** is a pointerup where total movement from pointerdown is **< 5px** and
elapsed time is **< 400ms**. Anything else is a drag. Both conditions must
hold: a stationary press held past 400ms is a drag, not a tap.

Both `DotLineControl.onPointerDown` and `DotEnvelopeControl.begin` currently
jump the value the instant the pointer lands. That jump is **deferred** until
the gesture is known to be a drag. The gesture is promoted to a drag when
either:

- movement exceeds 5px, or
- the 400ms timer fires while the pointer is still down.

On promotion the deferred jump is applied **at the original pointerdown
coordinates**, and the precision-drag accumulator (`accumulatePrecisionDrag`) is
seeded from there before any accumulated movement is applied. Drag feel and
maths are unchanged from today.

A tap:

- does not change the value,
- does not fire `onCommit`,
- opens the popover for the thumb the gesture picked (nearest-thumb logic is
  unchanged).

**Consequence, stated deliberately:** tapping a slider track no longer jumps the
thumb to that position. That affordance is replaced by typing. Dragging from
anywhere on the track still works exactly as before.

Keyboard interaction (`keyStep` on `DotLineControl`, `keyboard()` on the
others) is untouched.

## The popover

**Placement.** Portalled and `position: fixed`. Anchored horizontally near the
targeted thumb, clamped so it never leaves the viewport. Vertically it sits
**above** the control, flipping below only when there is not enough room above.
It is never anchored to the bottom of the viewport — on the kiosk the KWin
virtual keyboard covers the bottom of the screen, and on iOS the bottom strip is
the gesture blind spot already handled by `isBottomGestureBlindSpot()`.

**Portal target.** `useModalPortalTarget()` (`app/components/ModalOverlay.tsx`)
with a `document.body` fallback — the same rule `ConfigSelect` follows. A slider
inside `ColorWidget`/`ModalOverlay` must keep its popover a DOM descendant of the
dialog, or the modal's `inert` background makes it untappable on touch.

**Size.** Small: roughly 180–220px wide, sized to the field plus the OK button.
Not a modal, no backdrop, no scroll lock.

**Contents, in order:**

1. Label — the parameter or phase name plus unit, e.g. `ATTACK (S)`, `OPACITY
   (%)`. Styled with the existing `rect-envelope-tag` 9px tag family.
2. The input.
3. The allowed range as static hint text, e.g. `0 – 4`.
4. An `OK` button.
5. A `±` button, **only when `min < 0`**. iOS's decimal keypad has no minus
   key, so a signed control is otherwise unenterable on touch.

**The input.**

- `type="text"` with `inputMode="decimal"` — not `type="number"`, which brings
  spinners and inconsistent decimal handling across browsers.
- `pattern="[0-9]*[.,]?[0-9]*"` and a comma-to-dot normalisation on parse.
- Autofocused on open, with its contents selected, so the first keystroke
  replaces the existing value rather than appending to it.
- Class `cyber-text-input`, the config-page text field style.
- Spreads `useEditLock()` from `app/components/phonoscope/editing-lock.tsx`.
  Mandatory: without it the Visualiser panel's save echo rewrites the field
  mid-edit.

## Value handling

On commit the entered text is:

1. normalised (comma → dot, whitespace stripped) and parsed as a float;
2. **clamped** to `[min, max]` — typing `500` into a 0–100 control yields `100`,
   silently, no error state;
3. snapped to the control's `step`, so a typed value is always one a drag could
   also have produced;
4. sent through the same `onCommit` path a pointer release uses.

Unparseable text is treated as a cancel — the value is left alone and the
popover closes.

Displayed precision follows the control's existing readout (the envelope's
seconds readout, the slider panel's integer readout).

**Closing:**

| action | result |
|---|---|
| `Enter` or `OK` | commit, close |
| `Escape` | cancel, close, value unchanged |
| blur / pointerdown outside | commit, close |

## Locks held while the popover is open

- `beginControlInteraction()` on open, `endControlInteraction()` on close, and
  `incomingValueHoldUntilRef` set to `Number.POSITIVE_INFINITY` while open then
  released to `Date.now() + CONTROL_INTERACTION_COOLDOWN_MS` on close — the same
  pattern a drag uses. A poll must not overwrite the value mid-edit.
- `useEditLock()` on the input, as above.

## Kiosk: keep the keyboard up until focus is lost

The Nocturnium kiosk uses **KWin's built-in virtual keyboard**, which appears
automatically when a text input takes focus. It is hidden again by
`nova-monitoring/kiosk/virtual-keyboard-idle-guard.py`, which polls
`/dev/input/event*` touchscreen devices and calls
`org.kde.kwin.VirtualKeyboard.active false` after `NOVA_KEYBOARD_IDLE_SECONDS`
(10) of touchscreen inactivity. It knows nothing about focus, so pausing to
think for ten seconds mid-entry kills the keyboard.

The fix is a focus flag the guard can consult:

- **Dashboard**: `GET /api/kiosk/text-editing` returns `{ "active": boolean }`;
  `POST` with `{ "active": true }` refreshes an in-memory timestamp, `{ "active":
  false }` clears it. `active` is true when the last heartbeat is younger than
  **10s**.
- **Client**: while the popover is open it POSTs `active: true` immediately and
  then every **4s**; on close it POSTs `active: false` once. Failures are
  ignored — this is a hint, not a dependency, and the popover must work
  identically when the endpoint is unreachable.
- **Guard**: before hiding, GET the endpoint (URL from
  `NOVA_KEYBOARD_EDITING_URL`, default `http://192.168.8.20/api/kiosk/text-editing`,
  short timeout). If `active` is true, skip the hide and check again next tick.
  **Fail open**: any error, timeout, or malformed reply means hide as before.

## Send-on-commit only (the Phonoscope slider lag)

Separate defect, folded into the same change because it is the same code path.

`PhonoscopeConfig.queueSave` coalesces preview samples to a 75ms cadence and
POSTs `/api/phonoscope/config` on that cadence **for the entire duration of a
drag**. Each reply re-renders the panel from the server echo and rebroadcasts to
the renderer, so one drag is dozens of saves. Every phonoscope slider wires its
`onPreview` to that path, contradicting the contract already written in
`ConfigControls.tsx`: *"onPreview is local UI state only; onCommit is the single
write."*

Required behaviour: **a slider in the Phonoscope panel must not write to the
server while it is being dragged.** `onPreview` updates React state only. The
POST happens on:

- pointer release (`onCommit`),
- a keyboard step,
- the numeric popover's confirm.

Accepted trade-off, recorded so it is not later mistaken for a regression: the
renderer no longer follows the thumb live during a drag — it updates on release.
If live preview is wanted back it must be a lightweight renderer-only channel,
not a full config POST.

## Done means

- Tapping a Visualiser ramp thumb opens the popover above the control, focused;
  typing `0.25` + Enter sets that phase to 0.25s and the renderer follows.
- The same works on at least one non-Phonoscope slider (accent intensity) and on
  one inside a `ColorWidget` modal.
- Dragging, including precision drag and press-and-hold, is unchanged.
- Dragging a ramp thumb across its full range produces **exactly one** POST to
  `/api/phonoscope/config`, on release.
- On the kiosk: the keyboard appears on tap and is still up after a 15s pause,
  and goes away once the popover closes.
- On iOS: the decimal keypad appears and the popover is not in the bottom
  gesture blind spot.
