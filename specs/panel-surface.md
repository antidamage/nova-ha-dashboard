# Panel surface colour

Adeline, 2026-09-13. Direct request, no plan codename. Task log
`20260913T012605Z-5e343ffc`.

The stacked dashboard panels were painted with `--cyber-panel` and
`--cyber-panel-soft`, both derived from the theme's Background colour. They now
have their own colour-plus-opacity slot.

| File | Holds |
|---|---|
| `app/components/accentColor.ts` | `theme.panel`, its default, normalisation, CSS vars |
| `app/components/AccentConfig.tsx` | the slot in Theme Colours, copy/paste |
| `app/components/themeSections.ts` | `panel` in the Theme Colours section |
| `app/layout.tsx` | the pre-hydration paint of the same vars |

## The slot

- `theme.panel: { color: ThemeColorValue; opacity: 0-100 }`, per light/dark
  variant, same shape as `theme.border` and `theme.headerFade`.
- Shown in Theme Colours as **Panels** ("Panel fill"), next to Background.
  Opacity is folded into the ColorEncoder dial like Borders and Orb Shadow.
- Copy/paste of a single colour carries the opacity, as for Borders.
- Theme colour mixing (`mixDeviceThemeColors`) blends the colour and keeps the
  configured opacity.

## CSS

- `--cyber-panel` = `rgb(<panel applied rgb> / <opacity>)` — true alpha. The
  wallpaper, fluid background or page background shows through below 100.
- `--cyber-panel-soft` is derived from the panel colour, not the background:
  each channel `min(255, round(p * 0.93 / 0.84 + 255 * 0.07))`, same opacity.
  That factor reproduces the old background-derived soft tone exactly when the
  panel sits at its default.
- `--cyber-panel-rgb` is also set (space-separated channels).
- Existing `color-mix(... var(--cyber-panel) 88%, transparent)` rules keep
  working; their alpha multiplies with the slot's.

## Default

Today's look at 100% opacity. When a stored theme has no `panel`, the colour is
seeded from that theme's Background: same `rgb` and `cursor`, intensity
`round(background.intensity * 0.84)`. Scaling intensity by 0.84 equals the old
16% mix toward black. No existing theme changes appearance on upgrade.

The seed happens once, in normalisation. After that, changing Background no
longer moves the panels.

## Done

- The slot edits every panel live, both variants, and persists (local and
  shared scope, theme library save/load).
- Opacity 0 makes panels fully transparent; 100 is opaque.
- Themes saved before this change render identically.
- `tsc` and the theme tests pass.
