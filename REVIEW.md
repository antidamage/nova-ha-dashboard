# Code Review — Nova HA Dashboard

Scope: full pass over `lib/` (~15.8k LOC) and `app/` (~22.3k LOC) for code style,
structure, commenting, and function/class documentation, plus performance,
testing, and a new end-to-end suite. This document records what was **applied**
in this pass and what is **recommended** as follow-up.

## Summary

The codebase is in good shape: domains under `lib/` are focused and loosely
coupled, names are precise, and comments mostly explain *why* rather than restate
*what* — consistent with the standards in [SPEC.md](SPEC.md) §2. The review found
two real correctness bugs (now fixed), a hydration mismatch that hid the demo
theme editor (fixed), and a set of oversized UI/logic modules that are the main
remaining structural debt. No architectural rewrites were required.

## Applied in this pass

### Correctness fixes

1. **Theme editor invisible in the demo (SSR/CSR hydration mismatch).**
   [AccentConfig.tsx](app/components/AccentConfig.tsx) gated its theme panels with
   `style={{ visibility: themeReady ? … }}`. The server rendered `hidden` (no
   `localStorage`) while the client's first render computed `visible` (the demo
   bootstrap had populated the shared-theme cache). React refuses to patch a
   hydration-mismatched attribute, and because `themeReady` was *already* true on
   the client, no re-render ever corrected it — leaving the editor permanently
   hidden in the demo. Fixed with a post-mount `mounted` gate so the first client
   render matches the server (both hidden) and a corrective re-render follows.
   Caught by the new E2E suite.

2. **CSV task import rejected the documented `none` repeat keyword.**
   [parse-task-csv.ts](lib/parse-task-csv.ts) flagged any non-empty repeat field
   that `parsedRepeat` mapped to `undefined` as an error — including the
   intentional `none` / `no repeat` keywords the parser explicitly recognises.
   Fixed by distinguishing "explicit no-repeat" from "unrecognised".

### Performance (behaviour-preserving — see below)

3. [lib/ha/zones.ts](lib/ha/zones.ts): `countDomains` and `assembleZones`
   rewritten from O(domains × entities) / O(areas × entities) scans to single-pass
   tallying and a one-time `Map<area_id, entities[]>` grouping. Guarded by
   `state.golden.test.ts`.

4. [instrumentation.ts](instrumentation.ts): background services (update
   scheduler, camera recorders) are now skipped in demo mode, matching the
   static-export demo which has no server.

### Tests & tooling

- New Playwright E2E suite (see [SPEC.md](SPEC.md) §26) with a root runner
  `run-e2e.ps1`, plus `@vitest/coverage-v8` wired in (`npm run test:coverage`).
- Seven new `lib/` unit-test files raising `lib/` line coverage ~31% → ~42%.

## Findings & recommendations (not yet applied)

### Structure: oversized modules

These exceed a comfortable single-responsibility size. None are *broken*, but each
mixes several concerns and would benefit from extraction. Priority order balances
size against test coverage (lower coverage = higher refactor risk → write tests
first):

| File | LOC | Coverage | Suggested split |
| --- | --- | --- | --- |
| [app/components/AccentConfig.tsx](app/components/AccentConfig.tsx) | 1716 | E2E only | Extract the theme-variant editor, color-widget builders, and theme-library wiring into child components/hooks. |
| [lib/power.ts](lib/power.ts) | 1511 | 8% | Separate the pure tariff/billing/format helpers from the stateful sampler + HA publishing; unit-test the pure half first. |
| [lib/orb-modules.ts](lib/orb-modules.ts) | 1396 | high | Already modular; split the built-in module catalogue from the normalization core. |
| [app/components/accentColor.ts](app/components/accentColor.ts) | 1332 | partial | Split the `useDeviceTheme` hook from the pure palette math (`applyDeviceTheme`, mixing). |
| [app/components/TasksPanel.tsx](app/components/TasksPanel.tsx) | 1325 | E2E only | Extract `TaskEditor`, `ReadOnlyTaskPanel`, the alert overlay, and the row into their own files. |

Recommended approach: refactor one module at a time, each behind its existing
tests plus a few new ones, verifying with `npm run test:unit` and `./run-e2e.ps1`.
The safety net added in this pass exists precisely to make these safe.

### Documentation

- `lib/` modules are generally well-documented. Thinner spots worth a short
  file/function header: [lib/dashboard-events.ts](lib/dashboard-events.ts),
  [lib/ha.ts](lib/ha.ts), and the larger API route handlers under `app/api/`.

### Style

- Consistent and clean overall (precise names, small functions, "why" comments).
  No systemic style issues found; no churn-only reformatting recommended.

## Test coverage status

- **Unit (vitest):** 206 tests, 43 files. `lib/` lines ~42%, `app/` lines ~15%.
- **E2E (Playwright):** 22 tests over the main surfaces (dashboard load, zone
  navigation, lighting, climate, tasks, `/config`, theme) — covers `app/` UI
  behaviour that unit tests do not.
- **Toward higher coverage:** the cheapest remaining wins are the untested pure
  `lib/` modules — `lib/power.ts` helpers, `lib/dashboard-events.ts`,
  `lib/ha.ts`, `lib/update-scheduler.ts`, `lib/api/light-shortcut-endpoint.ts`.
  Component coverage is best raised via the E2E suite rather than jsdom, given
  the canvas/WebGL/SSE surfaces.

## Performance notes

- Implemented: the zones hot-path rewrite (above).
- Candidate follow-ups (safe, behaviour-preserving): build one
  `Map<entity_id, HaState>` per state snapshot and thread it through
  `buildRouterStatus`/`buildSunStatus`/`buildWeatherStatus` to replace repeated
  `stateById` linear scans; memoize compiled regexes in
  [lib/ha/entities.ts](lib/ha/entities.ts) `safeRegex`.

## Verification

```powershell
npm run test:unit       # 206 vitest tests
npm run test:coverage   # coverage report under coverage/
./run-e2e.ps1           # 22 Playwright tests against the demo build
npx tsc --noEmit        # type check (clean)
```
