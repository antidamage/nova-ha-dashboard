# The config page header

Adeline, 2026-09-23.

The chrome across the top of `/config`: the three fixed icon buttons, and the
theme's orb shadow that fades in behind them as the page scrolls.

| File | Holds |
|---|---|
| `app/components/ReloadButton.tsx` | the Reload button (shared with the dashboard) |
| `app/components/config/workspace/ConfigPageActions.tsx` | the Back and Log out buttons |
| `app/components/config/workspace/ConfigWorkspaceLayout.tsx` | mounts the cluster, the strip, and the row that reserves the band |
| `app/components/config/workspace/useConfigHeaderFade.ts` | the scroll handler that drives the strip on this page |
| `app/styles/config/layout.css` | the offsets, the reserved band, and the layering |
| `app/styles/config/navigation.css` | the breadcrumb trail's own fixed placement in the same band |

## One fixed cluster, three icons

Reload, Back and Log out are pinned to the top left in that order, each in the
shared `.dashboard-config-link` box (44px square, icon-only) with its own offset
class: `.dashboard-reload-link` at 16px, `.dashboard-back-link` at +52px,
`.dashboard-logout-link` at +104px — the same 8px step
`.dashboard-theme-override-link` takes off Reload on the dashboard.

They are icon-only on purpose: a text label widens the cluster across the band
and into the page's own chrome. Each carries its name in `aria-label`, `title`
and the demo tooltip — `e2e/helpers.ts` (`gotoConfig`) and `e2e/config.spec.ts`
select them by that accessible name.

**One copy of each.** The pair used to be rendered twice: a row in the page
column, plus a second fixed bottom-right copy so it was never a scroll away on a
long category. A viewport-anchored cluster needs neither, so the second copy and
its `.config-bottom-actions` rule are gone.

## The band, and the row that reserves it

The band's members are **direct children of the shell**, not of the page column:
`ConfigWorkspaceLayout` renders them inside `div.config-header-band` beside the
strip. That is structural, not tidiness. `background.css` gives every other direct
child of `.dashboard-shell` `position: relative; z-index: 1`, which makes
`.config-layout` a stacking context — and a `z-index` only orders an element
against its siblings *inside its own context*. Left in the column, the trail's 100
and the icons' 110 would be measured against each other while the whole column,
them included, painted under the strip's 90 at the shell's level. Excluding the
band from that rule (the way `.dashboard-config-link` already is, which is why the
Reload button was never affected) is what puts them in the strip's own context.

The column keeps `div.config-header-band-spacer` in their place, and `layout.css`
gives it `min-height: calc(44px + var(--nova-status-bar-clearance))` — the height
of the box, with the same clearance term the buttons' own `top` uses, so on a
standalone iOS device the reserved band follows them. Page content can therefore
never start underneath the icons, which is why the row sits ahead of
`UpdateBanner` in that column. It stays in flow rather than becoming an
absolutely-positioned spacer, so the page's top rhythm is what it was when the
buttons lived in it.

## The orb shadow, and what is in front of it

`/config` mounts the same `.header-fade-strip` element the dashboard uses — the
"Orb Shadow" theme slot (`specs/header-fade.md`), a fixed gradient at `z-index: 90`
across the top of the viewport, coloured by the theme and dialled by
`--nova-header-fade`.

Nothing else sets that property here: there is no status orb on this page, so
`useConfigHeaderFade` is the page's own driver — `scrollY / 160`, clamped to 0..1,
written on `<html>`, removed on unmount, the same continuous function of scroll
position the dashboard's orb handler uses so the strip reverses the instant the
page scrolls back up. It deliberately never toggles the
`nova-header-controls-disabled` class: that pair of rules fades the header buttons
out and drops their input as the orb shrinks, and on this page the three icons
*are* the header.

The band's two occupants are in front of that strip, because on this page they
are the chrome: `.config-shell .dashboard-config-link` in `layout.css` and
`.config-breadcrumb` in `navigation.css` sit at 110 and 100 in the *shell's*
stacking context, above the strip's 90 — and they are in that context, rather than
inside the page column's `z-index: 1` one, because the band is a direct child of
the shell. The icons also keep full opacity at every scroll position instead of
fading with `--nova-header-fade`.

The icons take precedence inside the band: 110 against the trail's 100, so a tie
can never leave back/log-out unreachable. The trail is also capped in width
(`navigation.css`) so it stops clear of the cluster at every viewport — the two are
belt and braces for the same rule, because the trail is later in the DOM and a
level `z-index` would hand it any overlap.

"Behind them" is a claim about paint order, not about the numbers, and the e2e case
proves it that way: it makes the strip hit-testable (it is `pointer-events: none`)
and asserts that the element at each icon's centre and at the trail's centre is
still that icon or crumb. Comparing computed `z-index` values across a stacking
context proves nothing — it read true while the band was in fact painting under the
strip.

The breadcrumb trail is fixed as part of this change — the same top-offset,
top-centre pattern as the icons (`specs/config-breadcrumb-navigation.md`), which
is why it is in this band at all and why this change updates the spec and the e2e
assertion that used to pin it into the page's flow.

The category nav keeps `z-index: 70`, so where the two overlap the strip paints
over it; in practice it scrolls away with the page (its `sticky` offset is
bounded by its own grid row), so a scrolled page's top band holds only the three
icons, the trail and the shadow.

## What "done" means

- The three icons do not move with the page at any scroll position, and stay
  clickable — including past the halfway point where the dashboard's own header
  buttons disable themselves.
- The strip is invisible at scroll 0 and fades in with scrolling, reaching full
  strength at 160px, in the theme's colour and opacity.
- The breadcrumb trail is fixed — it does not move with the page either — and
  paints in front of the strip.
- The trail never covers the icon cluster, at any viewport: its width is capped
  clear of it and the icons outrank it in the band, so Back and Log out stay
  readable and clickable with a trail showing.
- Nothing in the page column starts underneath the icons at rest: the row's
  reserved 44px band puts the category nav's top edge at 80px, clear of the
  icons' bottom edge at 60px.
- `e2e/config.spec.ts` covers those claims: the icons' and the trail's viewport y
  are identical before and after a scroll, the trail's position is `fixed`, the
  strip's opacity goes 0 → 1 → 0, the band paints in front of the strip (asserted
  by hit-testing with the strip made hit-testable, not by reading `z-index`), and
  the trail stops clear of the icon cluster at 600px.
