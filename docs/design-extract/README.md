# Dashboard design extract

A measured snapshot of the live dashboard's visual system, read off the rendered DOM
by `designlang` 13.4.0 on 2026-11-05 (full mode: responsive widths, light and dark,
hover/focus states). It records what the dashboard looks like now. Use it as the
shared reference for the website, the Apple TV and iOS apps, and any new control
or feature, so values come from one place instead of being re-measured per surface.

## What is here

| file | use |
|---|---|
| `DESIGN.md` | Summary: colours with tonal ramps and contrast pairs, type scale, spacing, radii, shadows. Start here. |
| `design-tokens.json` | Full token set (DTCG format) for tooling or an app-side generator. |
| `variables.css` | The same tokens as CSS custom properties. |
| `tailwind-v4.css` | The tokens as a Tailwind v4 theme. |
| `motion-tokens.json` | Durations and easings in use. |
| `icon-system.json` | Icon sizes and styles in use. |
| `visual-dna.json` | Measured style fingerprint. |
| `responsive.json` | Layout behaviour at the sampled widths. |
| `voice.json` | Detected copy style; low value, heuristic. |
| `screenshots/` | Desktop dark and light, and mobile dark, captured during the run. |

## Core values (from `DESIGN.md`)

- Colours: primary `#5e8000`, secondary (lime accent) `#b5ff00`, accent (amber) `#ffa04d`,
  page background `#121212`, raised surface `#171717`, foreground `#919191`.
- Fonts: Chakra Petch (text), Share Tech Mono (readouts and labels).
- Spacing: 4 px base; steps 4, 8, 12, 16, 20, 24, 28, 32, 48.
- Radii: 2, 13, 999 px.

## Using it

- **Web and apps:** take colour, type, spacing and radius values from here. The
  Swift apps map the same names to their own asset or constants; do not re-sample
  colours from screenshots.
- **New controls and features:** pick values from these tokens first. For *what a
  control is and how it behaves*, `docs/control-inventory.md` and `specs/` are the
  authority; this folder only holds the measurements.
- **Changing the look:** change the dashboard, then re-run the extract and replace
  these files in the same change. This folder is output, so edit the dashboard, not
  the files here.

## Limits of this snapshot

- The run captured the first-visit "Choose your experience" dialog over the Home
  page. Page-level figures (dominant colours, "landing" intent, layout detections)
  are skewed by it. The component pages in the screenshots are accurate.
- Only the entry page was crawled. Camera, voice, grid and the other panels were not
  visited, so their one-off styling is not represented.
- `DESIGN.md` breakpoints print as `[object Object]px` (tool bug); use
  `responsive.json`. Its generated Do's and Don'ts are heuristics (they treat room
  names as call-to-action verbs); ignore them.
- The tool reported 12 WCAG AA contrast failures and 528 `!important` rules on the
  source. They are measurements of the current dashboard, not decisions.

## Re-running

designlang (npm package `designlang`, Node 20+, needs a Playwright Chromium) was
installed on the agent workstation outside every repo. Command:
`npx designlang <url> --out <dir> --full`. A full-mode run takes several minutes,
so start it in the background with output to a log. The generated component-anatomy
scaffold was left out because a `.tsx` file here would be type-checked with the app.
`design-tokens.json` carries an older generator version in its metadata than
`DESIGN.md`; the values come from the same run.
