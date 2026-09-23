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

## The band, and the trail's two homes

Two things live at the top of `/config`: the fixed icon cluster, and the breadcrumb
trail once it has pinned. `ConfigWorkspaceLayout` renders both inside
`div.config-header-band`, a **direct child of the shell** rather than of the page
column. That is structural, not tidiness: the shell's lift in `background.css`
originally applied to every direct child of `.dashboard-shell` including
`.config-layout`, which made that column a stacking context — and a `z-index` only
orders an element against its siblings *inside its own context*. Left in the column,
the trail's 100 and the icons' 110 were measured against each other while the whole
column, them included, painted under the strip's 90 at the shell's level. Excluding
the band from that rule (the way `.dashboard-config-link` already is, which is why
the Reload button was never affected) is what puts them in the strip's own context.

The trail is one readout with two homes, and exactly one of them is ever visible:

- **Resting**, in `div.config-breadcrumb-slot` — a row of the page column directly
  under the category menu, which is where the trail sits at the top of the page.
- **Pinned**, in the band on the icon cluster's own line, once the page has scrolled
  far enough that the row's top has reached that line.
  `useConfigBreadcrumbPin` writes `data-nova-trail` on the shell from those two
  measured lines, and `navigation.css` decides which copy shows.

The two copies are level at the moment of the handover — the resting copy's top is
the row's top, which the threshold puts exactly on the cluster's line — so the
switch has nothing to see. The copy that is hidden keeps the row's height, so
nothing below the trail moves when it picks up. That, and sharing the line with the
fixed icons instead of sliding under the page's own shadow, is the difference from
a plain `position: sticky`.

The resting copy is never washed by the shadow on its way up to the line, and that
is why the config column is deliberately **not** a stacking context:
`background.css` excludes `.config-layout` from its direct-child `z-index: 1` lift,
and `layout.css` lifts the two elements in that column that need it — the update
banner and `#config-category-content` — leaving the trail's slot unpositioned so
nothing between the shell and the trail creates a context of its own. Shared a level
with the strip, the resting trail's `z-index: 100` beats its 90; everything else in
the column stays at 1, under the strip, exactly as before.

Those two are named rather than matched with `> *`, and that matters: a blanket child
rule is two classes deep, so it out-ranks the category nav's own `position: sticky;
top: …; z-index: 70` — one class — and turns the strip into a `relative` box sitting
8px down the page. The nav needs no lift (it carries its own z-index), and any new
visible child of that column belongs in the list or has to declare its own stacking.
The trail's row is also taken out of the grid while it is empty (`:empty`), so the
category grid on a category-less page does not carry its pair of gaps.

The column also keeps `div.config-header-band-spacer` ahead of `UpdateBanner`, with
`min-height: calc(44px + var(--nova-status-bar-clearance))` — the height of the icon
box, with the same clearance term the buttons' own `top` uses, so on a standalone
iOS device the reserved band follows them, and page content can never start
underneath the fixed icons. Both of those rows stay in flow, so the page's top
rhythm is what it was when the buttons lived in the column.

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
- The breadcrumb trail rests in its own row in the page column at the top of the
  page, exactly as before this change, and pins to the icon cluster's line once the
  page has scrolled past that row — not moving with the page thereafter, and in
  front of the strip.
- Nothing below the trail moves when it picks up: the row it came from keeps its
  height, and at the threshold the two copies are on the same line.
- The trail never covers the icon cluster, at any viewport: its width is capped
  clear of it and the icons outrank it in the band, so Back and Log out stay
  readable and clickable with a trail showing.
- Nothing in the page column starts underneath the icons at rest: the reserved 44px
  band puts the category nav's top edge at 80px, clear of the icons' bottom edge at
  60px.
- `e2e/config.spec.ts` covers those claims: the icons' viewport y is identical
  before and after a scroll, the trail's own case shows it resting in its row and
  then pinned on the cluster's line with the row's height unchanged, the strip's
  opacity goes 0 → 1 → 0, the band paints in front of the strip (asserted by
  hit-testing with the strip made hit-testable, not by reading `z-index`), and the
  pinned trail stops clear of the icon cluster at 600px.
