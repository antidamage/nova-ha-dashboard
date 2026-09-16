# iOS home-screen web app

Adeline runs the dashboard as a bookmark added to the iPhone Home Screen, which
iOS launches standalone (no Safari chrome). This spec owns how the page meets
the status bar in that mode.

## The problem

Adeline, 2026-09-16: "the area behind the time and battery level on iOS
displays a random colour from the dashboard when it shouldn't … preferably it
would just show the webpage."

In standalone mode with the default status-bar style, iOS reserves the
clock/battery strip for itself and fills it with a colour sampled from the
page's background. The dashboard background is `var(--cyber-bg)`, which is
whatever the active theme's background colour is — so the strip reads as an
arbitrary dashboard colour sitting above the page.

An earlier pass (task `20260913T233721Z-0df7bfa8`) added `viewportFit: "cover"`,
which is necessary but not sufficient: on its own it fixes Safari-with-chrome,
not the standalone web app, because iOS still owns the strip.

## Required behaviour

- The page draws **under** the status bar. No solid band of any colour above
  the dashboard — the dashboard's own background, grid and wallpaper continue
  behind the clock and battery.
- Nothing the page renders is hidden behind the strip: the top of the shell
  clears it.
- Status bar glyphs stay light (the dashboard is dark in every theme).
- Nothing changes on desktop, the kiosk, the iPad, or Safari with chrome —
  those all report a zero top safe-area inset.

## Implementation

`app/layout.tsx`:

- `viewport.viewportFit = "cover"` — the page may paint into the safe areas.
- `metadata.appleWebApp = { capable: true, statusBarStyle: "black-translucent" }`
  — the page draws under the status bar instead of iOS reserving and tinting
  it. `capable: true` emits `apple-mobile-web-app-capable`, which is what makes
  `black-translucent` apply at all.
- No `appleWebApp.title`. That emits `apple-mobile-web-app-title` and would
  rename an already-installed home-screen icon.
- No `theme-color` meta anywhere, deliberately: it would re-tint the strip.

`app/globals.css`:

- `--nova-status-bar-clearance` on `:root` is the single source for "how far
  down the page has to start". It is `env(safe-area-inset-top, 0px)` by
  default, and every top consumer reads the token rather than the raw inset:
  the shell's trailing padding rule, the config links, the mini clock/date, the
  config breadcrumb, and the sticky header strip.
- `.dashboard-shell { padding-top: calc(1.25rem + var(--nova-status-bar-clearance)) !important }`
  sits in the trailing safe-area rule, after every breakpoint block — the 640px
  and tablet blocks set the whole `padding` shorthand with `!important` and
  would reset anything placed earlier. 1.25rem matches the `py-5` the shell
  carries from Tailwind, so the clearance adds to normal spacing rather than
  replacing it.

### The Dynamic Island floor

Adeline, 2026-09-16, after the status bar went translucent: the page still had
to come down "by an amount equal to the height of the dynamic island, plus
padding". In the standalone web app iOS reports a **zero** top safe-area inset
even though the island overlaps the page — `black-translucent` tells WebKit the
page owns that strip, so there is nothing for it to declare as inset. The
padding was therefore adding zero.

So the token is floored on phone-sized standalone launches:

```css
@media (max-width: 640px) {
  html[data-nova-ios-standalone="true"] {
    --nova-status-bar-clearance: max(env(safe-area-inset-top, 0px), 59px);
  }
}
```

- 59px is the top inset of a Dynamic Island device — the island plus its
  margin, not the 37px island alone.
- `max()` means a correctly reported inset still wins, so this cannot
  double-count or under-shoot on a different device.
- `[data-nova-ios-standalone]` is set on `<html>` before first paint by the head
  bootstrap in `app/layout.tsx`, from `navigator.standalone` — the iOS-only
  "launched from the Home Screen" signal. A `(display-mode: standalone)` copy of
  the rule covers any engine that reports the mode but not the property.
- Width-gated to 640px so an iPad standalone install (no island, inset reported
  correctly) and Safari-with-chrome are untouched.
- Both rules live at the end of the file so no later block redefines the token.

## Verifying

Not reproducible on desktop — the inset is only non-zero in the standalone web
app on a notched device. Check on Adeline's iPhone with the dashboard opened
from the Home Screen icon. If the strip still shows a band, the installed icon
predates the meta: delete it and re-add from Safari.
