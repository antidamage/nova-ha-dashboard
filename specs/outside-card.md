# The Outside card

Adeline, 2026-09-12. Plan `glowing-inventing-charm`. The Outside zone had no
spec until now; this records what it is and the landscape rearrangement that
prompted writing one.

| File | Holds |
|---|---|
| `app/components/dashboard/OutsideControls.tsx` | the whole card |
| `app/components/dashboard/WeatherPanel.tsx` | the weather tiles |
| `app/components/dashboard/CameraPanel.tsx` | the HLS/DVR player |
| `app/components/dashboard/panel-registry.tsx` | registers it as the `outside` primary panel |

## What it holds

Three things, in this order: the **outside light**, the **weather**, and the
**camera**. The camera is behind the `camera` experience feature and simply
absent when that is off.

## Layout

- **Landscape: they flow left to right** — light, then weather, then camera
  (Adeline, 2026-09-12). Before this the light and weather shared a two-column
  row and the camera spanned underneath them, which made the card taller than
  the column and left it scrolling vertically.
- **Outside must not scroll vertically.** A landscape column is exactly
  `--dashboard-column-height` tall (`specs/landscape-layout.md`), and the card
  has to fit it.
- **The camera is sized from the column's height, not its width.** `.camera-stage`
  is `aspect-ratio: 16 / 9; width: 100%`, so a wide column made a tall picture —
  that is what forced the scrolling. Driving the 16:9 from the height instead
  keeps the feed as large as the row allows and no taller.
- Landscape columns are as wide as their content needs (Adeline, 2026-09-12);
  the old `min(760px, 100vw - 80px)` cap is gone. Sideways scrolling between
  columns is normal in landscape; vertical scrolling inside one is not.
- **Portrait**: the three stack, one per row, and each folds sideways to its
  own Advanced section (`specs/portrait-layout.md`).
- **Each of the three is its own fold** (Adeline, 2026-09-14,
  `specs/advanced-fold.md`): light, weather and camera each scroll vertically
  on their own and each carries its own Advanced line — the light's zone light
  events, the weather's daily forecast, and the camera's recent events and
  Saved Captures. The card still grows sideways; "Outside must not scroll
  vertically" now means the card, not the three areas inside it.

## The light

The outside light is **a colour knob with On and Off beneath it**, not the
`LabeledSwitch` it used to be. It is the `QuickLightsSegment` shape from
`specs/quick-access-card.md`: a `ZoneColorEncoder` with a `quick-button-pair`
under it.

- **On forces 100% white, every time** (Adeline, 2026-09-12). Not a default, not
  a remembered preference — pressing On always commands full-brightness white,
  whatever the knob was left on. It is `useZoneLighting`'s
  `applyPreset("white")`, which sends `WHITE_SPECTRUM` at brightness 100; the
  server has understood the `white` zone action since before this change.
- The knob still turns after that and changes the colour as any other zone
  knob does. The next On returns it to white.
- **Off** is `turnOff()`.
- The light is found the way it always was — the zone's first `light` entity,
  else its first illumination entity. No entity id is hardcoded here;
  `light.outside_light` sits in `everythingExcludedEntityIds` so Outside is its
  own zone rather than part of Home.

### Why the panel context grew

`useZoneLighting` needs a `ZoneActionHandler`, and the Outside panel had no way
to reach one: `PrimaryPanelContext` carried no `onZoneAction`, even though
`ZoneControls` already had it from `Dashboard`. It is threaded through the
context and the `primaryPanel.render({...})` call now. The old switch did not
need it because it issued a raw entity action instead, which cannot express
"white at 100%".

## Tests

`e2e/quick-access-layout.spec.ts` covers the Quick Access knobs, not these.
Cover the light's On path (it must command white at 100, not a bare `turn_on`)
and the landscape flow order.
