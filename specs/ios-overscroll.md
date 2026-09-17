# iOS page overscroll

Adeline, 2026-09-17: "on ios but particularly ipad, dragging can pull the entire
page down and reload it. we really don't want this. same for the sides, I don't
want the user to be able to pull beyond the edge of the page."

## The problem

iOS and iPadOS rubber-band a web page past its own scroll edges — vertically at
the top and bottom, horizontally at the sides — and Safari turns a downward drag
at the top of the document into a pull-to-refresh, which reloads the dashboard.
Neither belongs on a control surface: the reload throws away the session and
lands the user back at the top of the page, and the bounce moves chrome that is
supposed to look fixed.

## Required behaviour

- Dragging at any edge of the page never moves the page beyond its own scroll
  extent, on either axis.
- A downward drag at the top of the page does not reload it.
- The page still scrolls normally, and inner scroll surfaces keep their own
  behaviour.
- Nothing changes on desktop beyond the same gesture suppression.

## Implementation

`app/styles/base/reset.css`, on the `html, body` block:

```css
overscroll-behavior: none;
```

- `none` rather than `contain` is what is wanted. `contain` still allows the
  bounce inside the scroller and only stops it chaining onward; the viewport's
  next scroller is the browser UI, so the bounce is the whole complaint.
- It has to be the root scroller. An inner element's `overscroll-behavior`
  cannot suppress the viewport's own overscroll.
- The shorthand covers both axes, so `overscroll-behavior-x` / `-y` are not set
  separately.
- The Advanced fold's existing `overscroll-behavior: contain` on its own scroll
  surface (`app/styles/dashboard/advanced-fold.css`) is untouched and still
  keeps its scroll chaining in check.

Two side effects, both deliberate:

- Safari's own edge-swipe back/forward navigation stops working at the left and
  right edges of this page. On a dashboard that gesture was already a way to
  lose the page by accident.
- Chrome on Android suppresses its pull-to-refresh the same way.

## What CSS cannot do

- `overscroll-behavior` landed in Safari and iOS Safari **16.0**. On 15.x and
  older there is no CSS switch, and this declaration does nothing.
- Safari draws its pull-to-refresh in the UI process. If an OS version ignores
  the declaration for that gesture, the fallback is a non-passive `touchmove`
  listener mounted beside `app/components/TouchClickGuard.tsx`, cancelling the
  gesture only when the root is already at its edge and no scrollable ancestor
  can consume it. That is a behaviour change of its own, and it must not break
  the status orb's dial drag, which uses `touchmove` for rotation
  (`app/components/orb-info/useOrbDial.ts`).
- A page opened from the Home Screen runs standalone, where there is no
  pull-to-refresh at all. That is a way around the reload, not a fix for it.

## Verifying

- `app/overscroll.contract.test.ts` reads the resolved stylesheet and asserts
  the root rule declares `overscroll-behavior: none`, so a split, a reorder or a
  later block cannot silently drop or override it.
- The gesture itself is not reproducible on desktop. Check on the iPad: drag
  down from the top of the dashboard, and drag from each side. The page should
  stop at its own edge and never reload.

Produced by Dashboard task `20260917T115648Z-6cf29353`, from Adeline's request
in session `01a0af30`.
