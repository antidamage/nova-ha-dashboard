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

- `.dashboard-shell { padding-top: calc(20px + env(safe-area-inset-top, 0px)) !important }`
  — 20px is the `py-5` the shell carries from Tailwind, so the inset is added
  rather than replacing the normal spacing. Covers both the home shell and
  `.config-shell`. The landscape rule later in the file sets the whole
  `padding` shorthand with `!important` and wins there, which is correct:
  landscape reports a zero top inset on iPhone.
- Fixed top chrome (config links, mini clock, header strip) already offsets
  itself with `env(safe-area-inset-top)`.

## Verifying

Not reproducible on desktop — the inset is only non-zero in the standalone web
app on a notched device. Check on Adeline's iPhone with the dashboard opened
from the Home Screen icon. If the strip still shows a band, the installed icon
predates the meta: delete it and re-add from Safari.
