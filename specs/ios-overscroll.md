# iOS page overscroll

Adeline, 2026-09-17: "on ios but particularly ipad, dragging can pull the entire
page down and reload it. we really don't want this. same for the sides, I don't
want the user to be able to pull beyond the edge of the page."

## The problem

iOS and iPadOS rubber-band a web page past its own scroll edges — vertically at
the top and bottom, horizontally at the sides — and Safari can turn a downward
drag at the top of the document into a pull-to-refresh, which reloads the page.
Neither belongs on a control surface: the reload throws away the session and
lands the user back at the top of the page, and the bounce moves chrome that is
supposed to look fixed.

**Which surface this was seen on is not yet established.** Safari draws
pull-to-refresh; a dashboard opened from the Home Screen runs standalone, where
there is no pull-to-refresh at all, and `specs/wallpaper-background-mode.md`
records that the dashboard does not run in the iPad's browser chrome. If the
reload happened in the installed web app, then this change does not explain it
and whatever causes it is still there. That is why the first step of Verifying
is naming the surface.

## Required behaviour

On iOS and iPadOS 16 and later:

- Dragging at any edge of the page never moves the page beyond its own scroll
  extent, on either axis.
- A downward drag at the top of the page does not reload it.
- The page still scrolls normally, and inner scroll surfaces keep their own
  behaviour.
- Nothing changes on desktop or the kiosk beyond the same gesture suppression.

The requirement is not claimed below iOS 16: there is no CSS switch there at all
(see What CSS cannot do).

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

Two side effects, one of them expected rather than proven:

- Chromium's own swipe-back/forward navigation is gated on root overscroll and
  is expected to stop. The CSS specification describes `contain` — a weaker
  value than `none` — as disabling "native browser navigation, including the
  vertical pull-to-refresh gesture and horizontal swipe navigation", and Chrome
  on Android therefore loses its pull-to-refresh. WebKit and Gecko implement
  their own gestures in the UI process, so **whether Safari's edge-swipe back
  stops is an assumption, not a measurement** — it is on the iPad check list,
  and this repo has been here before: `specs/status-orb-stack.md` records iOS
  Safari continuing to scroll a page "despite `touch-action: none`".
- Removing overscroll from the root also removes it from the page's outer edge
  on desktop, where it can be the trigger for a browser's trackpad swipe-back.

## What CSS cannot do, and what this does not cover

- `overscroll-behavior` landed in Safari and iOS Safari **16.0**. On 15.x and
  older there is no CSS switch, and this declaration does nothing.
- Safari draws its pull-to-refresh in the UI process. If an OS version ignores
  the declaration for that gesture, the fallback is a non-passive `touchmove`
  listener mounted beside `app/components/TouchClickGuard.tsx`, cancelling the
  gesture only when the root is already at its edge and no scrollable ancestor
  can consume it. **Not implemented here, on purpose**: implement it only if the
  iPad still reloads. It must not break the status orb's dial drag, which uses
  `touchmove` for rotation (`app/components/orb-info/useOrbDial.ts`).
- A sideways drag in portrait is not the overscroll of any scroller. The
  document only gains a horizontal extent in landscape (`.dashboard-home` is
  `width: max-content` there), and `.dashboard-shell` is `overflow: hidden`, so
  past the side edge the gesture belongs to the web view. This is the claim in
  "side effects" that most needs the device check.
- The modal-locked state is its own case: `app/components/ModalOverlay.tsx` sets
  the root's `overflow` to `hidden` and `body` to `position: fixed` while any
  dialog is open, so the root cannot be scrolled to an edge at all. Whether a
  drag there still bounces or reloads is not established by this change.
- A page opened from the Home Screen runs standalone, where there is no
  pull-to-refresh at all. That is a way around the reload, not a fix for it.

## Verifying

- `app/overscroll.contract.test.ts` reads the resolved stylesheet and asserts
  that the last `html, body` rule declares `overscroll-behavior: none` and that
  no root rule hands overscroll back. It guards removal and a later override on
  that selector; it cannot see a rule that targets `html` or `body` alone, and
  it does not read the served stylesheet.
- `e2e/dashboard.spec.ts` — "the page itself refuses overscroll": in a real
  browser the *computed* value on `html` and `body` is `none`, so the
  declaration survives the Tailwind v4 / Lightning CSS pipeline and nothing
  overrides it. The E2E harness needs the provider fixtures, so it runs where
  the repo sits beside `nova-dummy-data-provider`.
- Not reproducible on desktop: the gesture itself. On the iPad, first record
  whether it is Safari with chrome or the installed web app, then drag down at
  the top, sideways at each edge in both orientations, and once with a dialog
  open. The page must stop at its own edge and never reload.
- If Safari on the iPad still reloads after this, implement the `touchmove`
  guard described above.

Produced by Dashboard task `20260917T115648Z-6cf29353`, from Adeline's request
in session `01a0af30`.
