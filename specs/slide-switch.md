# The slide switch

Adeline, 2026-09-14. Plan `we-have-a-concept-unified-lamport`, task log
`20260914T040659Z-182a2a14`.

One switch for the whole surface, in place of the block thumb the climate
cards used.

| File | Holds |
|---|---|
| `app/components/dashboard/ClimateControls.tsx` | `LabeledSwitch`, redesigned in place and re-exported |
| `app/globals.css` | `.cyber-switch*` and `.climate-switch-row` |
| `app/components/ConfigControls.tsx` | `CheckboxRow`, which keeps its own narrower job |

## The control

- An iOS-style slide switch: a rounded track with a round thumb that slides
  from one end to the other, animated.
- **Off on the left of the track, On on the right**, as today's `leftLabel` /
  `rightLabel`.
- **The label colours are static.** They do not swap, brighten or dim with
  state — both read as `--cyber-title-on-bg` through the theme's title-tone
  logic (`titleColorSlotFor`, `app/components/accentColor.ts`), which is what
  keeps them legible on any background. State is shown by the track fill and
  the thumb's position, not by the words.
- The track fills with `--cyber-highlight` when on and sits on
  `--cyber-border-dim` when off. Anything drawn inside the thumb uses
  `--cyber-title-on-highlight`.
- It keeps what the old switch had: `MomentaryFeedbackButton` for the press,
  `role="switch"`, `aria-checked`, `aria-label`, and the disabled treatment.

## Where it is used

**Every toggle on the surface is this switch** — dashboard and config alike.
If a setting is on or off, it is a slide switch.

Checkboxes are now only for turning on a group of settings. `CheckboxRow`
stays for exactly that and is no longer the default for a lone boolean.

Converted:

- `LabeledSwitch`'s own callers (climate, Outside), by redesigning it in place.
- The one-off `role="switch"` buttons in `AgentConfig.tsx`, `CameraConfig.tsx`,
  `NovaAvatarConfig.tsx`, `RemindersConfig.tsx` and `UpdateConfig.tsx`.
- `.power-mode-toggle` in `PowerPanel.tsx` (Credits / kWh), which is a native
  checkbox styled as a switch.
- Each `CheckboxRow` that toggles a single setting rather than opening a group.

`nova-ha-dashboard/CLAUDE.md`'s inventory is updated to say this, so the next
session does not reach for a raw checkbox.

## Done means

- One switch component, the same look everywhere it appears.
- The labels do not change colour when the switch is thrown, in either theme
  variant.
- No lone boolean anywhere on the config page is still a checkbox.
- Keyboard and screen-reader behaviour is unchanged from the old switch.
