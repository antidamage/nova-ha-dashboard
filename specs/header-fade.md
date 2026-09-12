# The header fade strip

Adeline, 2026-09-12. Plan `glowing-inventing-charm`.

The dark shadow that comes in under the status orb as the page scrolls. It was
hardcoded black, which is too heavy for some themes, so its colour and opacity
are now a theme slot.

| File | Holds |
|---|---|
| `app/components/dashboard/HeaderFadeStrip.tsx` | the element |
| `app/globals.css` | the two gradients |
| `app/components/NovaAvatar.tsx` | the scroll handler that drives it |
| `app/components/accentColor.ts` | the stored colour and opacity |

## What it is

Not part of the orb. It is a fixed strip behind the orb —
`<div className="header-fade-strip">` — painted as a gradient from a solid
colour to transparent, sitting at `z-index: 90` across the top of the viewport.

There are **two** gradients for it in `app/globals.css`, and both take the same
colour:

- portrait, `to bottom`
- landscape, `to right` (the strip runs down the sidebar edge instead)

## Colour, opacity and scroll compose

Three values multiply into what you see:

1. **The theme's colour** — a normal `ThemeColorValue`, per light/dark variant
   like every other theme colour.
2. **The theme's opacity** — the slot's own 0–100, which becomes the alpha
   *inside* the gradient's colour.
3. **`--nova-header-fade`** — the scroll progress, 0 to 1, set on `<html>` by
   the scroll handler in `NovaAvatar.tsx` and applied as the element's
   `opacity`. Portrait divides `scrollY` by the scale distance (300 by
   default); landscape divides `scrollX` by 400.

The theme's two values belong **inside the gradient colour**, leaving the
element's `opacity` to the scroll. Putting the theme's opacity on the element
as well would fight the scroll for the same property, and the strip would
either stop fading or never reach full strength.

## The slot

It is an ordinary colour widget among the other Theme Colours slots — **not in
the Status Orb settings, and not in a section of its own** (Adeline was
explicit about both). Modelled on `theme.border`, which is the codebase's
existing colour-plus-opacity slot.

**The default is black at the weight it has always had**, so no existing theme
changes appearance when this ships.
