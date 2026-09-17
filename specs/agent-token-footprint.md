# Agent token footprint

Plan: `majestic-aurora`. Written 2026-09-16.

This repo is read by agents, not by Adeline. This spec defines how it is
structured so that reading it is cheap.

## 1. The objective

**An agent should never need more than ~50 KB of this repo to do any given
task.**

That is the target, not "fit the repo into a context window". The repo is
~8.5 MB of tracked text (~2.4M tokens) and will not fit in any window worth
paying for. What matters is that finding and reading the relevant part is
cheap, which comes from four things:

1. Files small enough that reading one is not a decision.
2. Paths informative enough that an agent can guess where something lives.
3. Generated data excluded from agent reads.
4. An index that says where to look.

### Before and after

| Measure | 2026-09-16 (before) | 2026-09-17 (after) |
|---|---|---|
| Tracked text (excl. images, lockfiles, fonts, audio) | 8.5 MB | 8.6 MB |
| Source files (`.ts`, `.tsx`, `.css`, `.py`, `.mjs`) | 833 | 1,679 |
| Source files over 10 KB | 154 | 56 |
| Bytes in files over 10 KB | 3,977 KB | 858 KB |
| Median source file | — | 2.9 KB |
| Largest file | `app/globals.css`, 247 KB | `controls/rotary/RotaryEncoder.tsx`, 38 KB |
| Largest doc | `SPEC.md`, 185 KB | `specs/face-auth.md`, 64 KB (`SPEC.md` is a 3 KB index) |
| Flat files at `lib/` top level | 216 | 189 |
| Flat files at `app/components/` top level | 142 | 136 |

Total size barely moved — this campaign relocates code, it does not delete it.
What changed is the cost of a read: the median file is under 3 KB, and a facade
at each original path lists what its package contains.

Most top-level files that remain are those facades, kept on purpose so no call
site changed. The 56 files still over 10 KB are each recorded in
`lib/architecture.test.ts`: permanent ones carry their section 2 criterion,
and the rest are burn-down entries that may only shrink. The largest burn-down
entries — `RotaryEncoder.tsx`, `config/accent/AccentConfig.tsx`,
`dashboard/camera/CameraPanel.tsx`, `advanced-fold/AdvancedFold.tsx`,
`useAirconCommands.ts` and `tasks/TasksPanel.tsx` — share closure state across
their parts, so reducing them further needs a behaviour-preserving extraction
under test rather than a move.

## 2. Thresholds

**10 KB soft cap per source file.** Target 150–400 lines. Under ~80 lines,
merge into a sibling rather than creating a file.

A file may exceed the cap if **any one** of these holds. The exception is
named in the commit body, one sentence, naming which criterion:

1. **Single cohesive data table.** One `export const` array or object that is
   conceptually one thing — an icon registry, an effect catalogue, a font
   list. Splitting a table alphabetically is worse than leaving it. *Escape
   hatch:* if over 30 KB, move the table to `<name>.data.ts` beside a small
   `<name>.ts` so the logic is readable without the data.
2. **One irreducible state machine or algorithm** whose parts share closure
   state and cannot be made argument-passing without behaviour risk.
3. **Splitting would force more than five new exports** that exist only so the
   other half can call them. That means the seam is wrong. Look for a
   different axis; if none exists, stop.
4. **A spec pins the file by path.** `PHONOSCOPE_MODULE_SPEC.md` does this.
   Splitting requires the spec to be updated first.
5. **Generated or vendored.** Not currently applicable, but stated so the
   reviewer has the category.

Large table-driven tests are explicitly out of scope for splitting — a big
table-driven test is the correct shape. `lib/aircon-control.test.ts` (48 KB)
and `lib/phonoscope-drivers/phonoscope-drivers.test.ts` (35 KB) are permanent exceptions.

## 3. Directory convention

### 3.1 Shape

Three levels, no more:

```
<root>/<feature-package>/<file-role>.ts
```

`<root>` is `lib/` (server and shared logic) or `app/components/<area>/` (UI).
`<feature-package>` is a noun an agent would guess from a symptom — "the
aircon is wrong" leads to `lib/climate/aircon/`.

**This convention already exists in the repo. Extend it; do not invent one.**
The exemplars:

- `lib/ha.ts` — a facade that re-exports from `lib/ha/{client,entities,zones,
  registry,twins,health,states}.ts`.
- `lib/orb-info/` — the file-role vocabulary, already applied.
- `app/api/` — route-per-directory throughout.

### 3.2 File-role vocabulary

Fixed, so an agent can predict a path without listing the directory:

| filename | contains | may import |
|---|---|---|
| `types.ts` | types/interfaces only, zero runtime | only other `types.ts` |
| `constants.ts` | literal tables, defaults, key names, event names | `types.ts` |
| `schema.ts` | zod schemas and inferred types | `types.ts`, `constants.ts` |
| `<noun>-model.ts` | pure functions: compute, project, format, normalise | types, constants, schema |
| `store.ts` | disk / localStorage / `globalThis` state ownership | model, fs |
| `client.ts` | outbound HTTP/WS/service calls | types, constants |
| `<verb>.ts` | side-effecting operations (`commands.ts`, `sampling.ts`) | anything in the package |
| `events.ts` | pub/sub wiring | types, store |
| `use<Thing>.ts` | one React hook | anything |
| `<Component>.tsx` | one exported component | anything |

**That ordering is also the allowed dependency direction.** An import going up
the table — a `types.ts` importing a `store.ts` — is a review failure. This is
the mechanical cycle-prevention rule.

### 3.3 The facade rule

**Do not create `index.ts` barrels. Keep the original file at its original
path as a thin facade.**

`lib/power.ts` stays at `lib/power.ts`, becomes ~70 lines of
`export … from "./power/*"`, and the body moves into `lib/power/`.

Why:

1. **Zero import churn.** Fourteen files import `lib/power`. None change. A
   campaign touching 154 files cannot also rewrite every call site.
2. **The facade is a free table of contents.** An agent reading a 70-line
   facade learns the package's whole surface and which sibling to open. This
   is a larger token win than the split itself.
3. `moduleResolution: "bundler"` resolves `./power` to `power.ts` in
   preference to `power/index.ts`, and `lib/ha.ts` + `lib/ha/` already prove
   the pattern works here.

**A facade may re-export only from files inside its own package directory.**
A facade re-exporting across packages is what creates cycles.

Four cases where a facade is wrong:

- **Anything reached by `next/dynamic` or `await import()`.** The 19 config
  sections in `ConfigWorkspace.tsx` (the block of `dynamic()` imports), and `MapPanel` via
  `panel-registry.tsx:32` and `useRadarPreload.ts:28`, are lazily loaded on
  purpose. Their facade re-exports **only the component**, and that component
  file must not import the package's server-side or heavy siblings.
- **Files split across the client/server boundary.** Never let one facade
  re-export both a `"use client"` module and a server-only module — that
  drags `fs`/`ssh2` into the browser graph, or poisons a server module with
  client-only code. Use two facades, `x.ts` and `x.client.ts`.
- **`types.ts` is imported directly, never through a facade**, so a type-only
  import never pulls runtime code.
- **`isolatedModules: true`** — every re-exported type must use
  `export type { … }`. A plain `export { SomeType } from …` fails the build.

### 3.4 Target trees

```
lib/
  climate/    aircon/ heater/ policy/ instances/ preferences/
  power/      ratings/ tariff/ modelling/ attribution/ store/ sampling/
  lighting/   presets/ thresholds/ convergence/ events/ zones/
  ha/         (exists — client, entities, zones, registry, twins, health, states)
  phonoscope/ store/ drivers/ effects/ theme-state/ module/
  voice/      host-settings/ settings/ personality/ training/
  camera/     (exists — recorder/ config/ snapshots/ hls/)
  orb/        modules/ info/ timer/
  tasks/      model/ csv/ store/
  config/     schema/ scaffold/ secrets/ demo/
  events/     the dashboard-events split
  types/      the lib/types.ts split, by domain
  modules/    (exists — the dashboard module system)
```

```
app/components/
  primitives/  ConfigSelect SlideSwitch IconButton ModalOverlay ConfirmDialog
               LockableField MomentaryFeedbackButton NumericEntryPopover
  controls/    rotary/ dots/ color-encoder/ temperature/ timer/ font/ slider/
  theme/       accent/ fonts/ library/ clipboard/ sections/ override/
  avatar/      NovaAvatar NovaOrbGlass orbRenderer avatarThemeModel
  config/      workspace/ accent/ voice/ camera/ agent/ reminders/ updates/
               modules/ system/ face/ watchface/ speakers/
  dashboard/   (exists) + camera/ climate/ power/ reminders/ quick-access/ map/
  tasks/ phonoscope/ auth/ modules/ orb-info/ face/   (exist — extend)
```

After the campaign, the top level of `app/components/` should be directories
plus a handful of genuinely global components. `ls app/components` should be
an informative answer to "where does X live", which it currently is not.

## 4. Splitting axis

Apply the first that yields three or more roughly balanced files:

1. **Types and constants out first. Always.** Cheapest, safest, highest value:
   pure motion, cannot change behaviour, and it converts the most common agent
   task — "what shape is this" — from a 60 KB read to a 4 KB read. Do this
   even when no further split follows.
2. **By state ownership.** Anything touching `globalThis`, module-level `let`,
   `fs`, or `localStorage` goes into exactly one `store.ts` per package. This
   is the duplicate-state and cycle firewall.
3. **By I/O boundary.** Outbound calls (`client.ts`) separate from the logic
   that decides to make them. Fewer mocks in tests; the pure half reads alone.
4. **By feature or concern, following the file's own section comments.** This
   repo comments heavily (`/* ==== VOICE SPEAKING ORB ==== */`). Those
   headings are authored guidance about where the seams are.
5. **By export group** — last resort. Cluster exports by which call sites use
   them together.

**Never split on** line count alone, alphabetical order, or "types vs logic"
applied so literally that a five-line union gets its own file.

## 5. Tests

- A test file moves with the code it tests, into the same package directory.
  Vitest collects by glob, so no config change is needed.
- **Do not split a test in the same work unit as its source.** Move
  `power.test.ts` to `lib/power/power.test.ts` importing the facade,
  unchanged. Splitting both at once destroys the evidence that behaviour did
  not drift. Split tests later, separately, if at all.
- **Contract tests read source text by literal path.** They break on *moves*,
  not edits — the failure class a splitting agent will not anticipate. Update
  them in the same commit as any move of a file they name:
  - `app/liteMode.contract.test.ts`, `app/reminderOutline.contract.test.ts`,
    `app/selectLayering.contract.test.ts`,
    `app/components/phonoscope/styling.contract.test.ts`,
    `app/components/ColorEncoder.test.tsx:299,309` all read
    `app/globals.css`. `styling.contract.test.ts` also reads two `.tsx` files
    by literal name; `liteMode.contract.test.ts` also reads `layout.tsx`.
  - `lib/no-household-data.test.ts` waives by **file path**, and a waiver that
    matches nothing also fails. Moving a waived file breaks it in both
    directions. Grep the waiver list before any move.
- **`test:aircon` hard-codes an emit path**: `tsconfig.aircon-test.json` plus
  `node --test .tmp/aircon-tests/lib/aircon-control.test.js`. Splitting
  `lib/aircon-control.ts` changes the emitted tree, so it is its own work unit
  with the config and `package.json` script edited alongside it.

## 6. Client/server boundary

194 files carry `"use client"`; none carry `"use server"`.

- Every file extracted from a `"use client"` file either carries the directive
  itself, or every one of its importers does.
- No new file may pull `fs`, `node:*`, `ssh2`, or a package's `store.ts` into
  a client graph.
- `npm run build` is the only check that models this. It must run **after**
  the last edit of a work unit, not before.

## 7. CSS

`app/globals.css` is 9,048 lines, 247 KB, **BOM at byte 0**, with
`@import "tailwindcss"` at line 5. It is imported once, at `app/layout.tsx:2`.

- Tailwind v4 (via `@tailwindcss/postcss`, no `tailwind.config.*`) resolves
  `@import` itself, so plain CSS `@import` of partials needs no build change.
- **The entry file stays at `app/globals.css`.** Move the contents, not the
  entry — relocating it risks changing Tailwind's source-detection root, which
  fails silently as an unstyled panel nobody notices for a month.
- **There is no `@layer` discipline. Source order is load-bearing.** The
  partial import order must reproduce current document order exactly. This is
  the strictest constraint in the campaign.
- **Media queries stay adjacent to their base rules**, not in a `responsive/`
  bucket — moving them changes cascade order. Create `responsive/` files only
  for genuinely cross-cutting breakpoint blocks (the `@media (aspect-ratio
  <= 1)` blocks around lines 5894–8203), imported at the exact ordinal
  position they occupy today.
- `@keyframes` are name-scoped and order-independent — the only free-motion
  content. Check for duplicate names before consolidating.
- **Do not introduce `@layer` in this campaign.** That is a behaviour change
  wearing a refactor's coat.

Target: entry file of BOM, header comment, `@import "tailwindcss"`, then ~28
partial imports in original order, and nothing else. Contents under
`app/styles/` grouped by feature: `tokens/`, `base/`, `avatar/`, `reminders/`,
`config/`, `dashboard/`, `tasks/`, `orb/`, `motion/`.

`app/styles/readCss.ts` — a test helper, not shipped — reads the entry,
resolves the `@import`s in order, and returns the concatenation. The five
contract tests point at it instead of reading `globals.css` directly. This
preserves each contract's meaning (a class defined anywhere in the bundle
counts) and keeps order-aware assertions working. The helper also asserts it
finds every file under `app/styles/` exactly once, making it the import-order
tripwire.

**Verification for the CSS split:** concatenate the partials in import order
and diff against the original, whitespace-normalised. It must be equivalent.
Anything else is a cascade change.

## 8. Generated data — excluded from agent reads

These are data, not logic. No agent reasons about them; they are only ever
swallowed by an unlucky grep or glob:

| Path | Size |
|---|---|
| `config/demo-theme-library.default.json` | 267 KB |
| `config/dashboard-preferences.default.json` | 227 KB |
| `test/fixtures/ha-snapshot/*` | 464 KB |
| `package-lock.json` | 160 KB |
| `config/demo-theme.default.json` | 25 KB |

~1.1 MB. Enforced as `permissions.deny` `Read` rules in
`D:\Projects\Agent\.claude\settings.json`, and stated here for agents that do
not read that file.

## 9. Naming — identifiers stay descriptive

Shortening identifiers was considered on 2026-09-16 and **rejected**. It saves
roughly 3–5% of repo bytes and costs accuracy on every task: descriptive names
are precisely what lets an agent grep for a symbol and follow a call chain
without reading the surrounding context. Comments and descriptive names are
the highest information-per-token content in the repo.

Recorded here so it is not relitigated. No renaming pass. A splitting commit
that renames anything, including a local, is rejected.

## 10. Documentation

- **One spec per feature area, under `specs/`.** No root mega-spec.
- `specs/README.md` is the index.
- `ARCHITECTURE.md` at the repo root is the map: module boundaries, which
  directory owns what, where to look for X.
- A later plan covering ground an existing spec describes **edits that spec in
  place**. Git history is the revision log. Do not accumulate dated
  near-duplicates.

`SPEC.md` is dissolved into `specs/` and becomes a thin index.
`nova-ha-dashboard/CLAUDE.md` already teaches the per-area convention and
never mentions `SPEC.md`, so this moves the repo toward the convention it
already documents.

## 11. Enforcement

- **`lib/architecture.test.ts`** is the ratchet: no file in `lib/` or `app/`
  exceeds 10 KB except an explicit path-keyed allowlist, and no `types.ts` has
  a runtime import. Same waiver technique as `lib/no-household-data.test.ts`,
  so it reads as native to this repo.
- **`scripts/check-file-sizes.mjs`** is the on-demand view: whole tree, not
  just `lib/` and `app/`, so the Python services are included; grouped by
  directory; exits 1 on any file over the cap. It is deliberately **not** wired
  into `npm test` — it has no allowlist, so during the burn-down it would red
  the suite on all 149 pre-existing offenders and teach everyone to ignore it.
  The ratchet is the gate; this is the report.
- A **skill** fronts the script so calling it is trivial for any agent. Source
  in-repo plus a `deploy-skills.ps1` mirroring to both
  `C:\Users\Addie\.claude\skills` and `C:\Users\Addie\.codex\skills`, matching
  the four existing deploy scripts.

## 12. Definition of done

Per work unit (one facade package: facade, new directory, moved tests,
call-site edits, one commit):

1. `npx tsc --noEmit` clean.
2. `npm run test:unit` — pass count at or above baseline, with **identical
   test names**. A moved test that stopped being collected shows up as a
   missing name, not a failure.
3. `npm run test:aircon` and `npm run package:skills`.
4. `npm run build` succeeds.
5. `npm run test:coverage` — total covered lines must not drop. A drop means a
   branch stopped being exercised: dead code created, or a re-export missed.
6. Relevant `e2e/*.spec.ts` for UI phases.
7. Diff is motion-only. The reviewer should be able to reconstruct the
   original file by concatenating the new ones.

For the campaign:

- Zero files over 10 KB without a named exception.
- `ARCHITECTURE.md` and `specs/README.md` exist and are accurate.
- The convention is referenced from `AGENTS.md`, both `CLAUDE.md` files, the
  Hermes system prompt, the Turnstone prompts, and the pi spec.
- Baseline table in §1 updated with after-figures.

## 13. Reviewer checklist

Mechanical, not eyeballed. Run these, do not judge them:

1. **Public surface unchanged.** Extract the exported-symbol set from
   `git show HEAD~1:<path>` and from the new facade. They must be equal. A
   missing re-export that no test covers is the most likely silent breakage.
2. **`export type` used** for every re-exported type. `tsc` catches this, so
   verify `tsc --noEmit` actually ran.
3. **No new import cycles.** `npx madge --circular --extensions ts,tsx lib app`
   against the phase-0 baseline; the count must not increase. Grep the new
   package directory for imports of its own facade — always wrong.
4. **`"use client"` integrity**, per §6, and confirm the build ran after the
   last edit.
5. **Dynamic import paths** still resolve to a module that does not
   transitively pull the package's server half. A build that succeeds but
   ships MapLibre in the initial bundle is a regression no test sees.
6. **One state owner.** `grep -n "globalThis\|^let \|^var "` across the new
   package: at most one file. Two is a reject.
7. **No behaviour drift.** No logic edits in a splitting commit — no renamed
   locals, no reordered statements, no changed defaults, no "while I was in
   there" fixes. A genuine bug found goes in a separate follow-up commit with
   its own test.
8. **CSS order** (phase 1 only) — the byte-equivalence diff from §7.
9. **Waiver lists** updated for every moved path (§5).
10. **Size outcome** — every new file under 10 KB, or an exception named per
    §2 in the commit body.

## 14. Execution phases

Dependency-ordered, not size-ordered. A work unit is one facade package, one
commit, independently revertible.

| Phase | Contents | Why here |
|---|---|---|
| 0 | `architecture.test.ts`, `madge --circular` baseline, `readCss.ts` | gives every later unit a machine-checkable definition of correct |
| 1 | CSS — `globals.css` → `app/styles/**` | isolated from TS, biggest single win, fastest feedback |
| 2 | Leaf types — `lib/types.ts`, `lib/config-schema.ts`, `lib/modules/types.ts` | everything depends on these; pure motion |
| 3 | Server domain logic — power, ha, climate-control, aircon-control (own unit), orb-modules, dashboard-events, tasks, managed-computers, camera/recorder, voice-host-settings, voice-settings | not in the browser graph; failures show in tests, not paint |
| 4 | Phonoscope — store, drivers, theme-state, effects | gated on a `PHONOSCOPE_MODULE_SPEC.md` read |
| 5 | Non-lazy UI — RotaryEncoder, DotControls, TasksPanel, NovaAvatar, MapPanel, dashboard panels | client-boundary risk; needs e2e |
| 6 | Lazy config sections — the 19 dynamic targets, plus accentColor + AccentConfig as one unit | independently smoke-testable; capture `.next` chunk sizes before and after |
| 7 | Python services — `face-auth/service.py`, `camera-events/service.py`, `tuya_mobile_mqtt_bridge/bridge.py` | separate deployables, zero coupling; parallel-safe |
| 8 | Cleanup — delete transitional stubs and dead facades, final tree docs | |

Within a phase, units touching disjoint directories may run concurrently;
merges serialise. Work happens in a **separate worktree**, never a feature
branch in the main directory.

## 15. Models and effort

| Role | Model | Effort |
|---|---|---|
| Orchestrator; writing this spec | Opus 5 | high |
| Adversarial reviewer, every unit | Opus 5 | high |
| Workers: phases 1, 3, 4, 5, 6, 8 | Opus 5 | high |
| Workers: phases 2, 7; docs and hygiene tasks | Sonnet 5 | medium |

## 16. Known follow-ups, deliberately out of scope

- `lib/ha/lighting/zone-rules.ts` imports `hsvToRgb` from `app/components/colorEncoderModel` —
  server code reaching into `app/components`. The target is `lib/color/hsv.ts`.
  Not fixed during the campaign: it is a behaviour risk, and a reviewer must
  not reject a split for preserving it.
- Splitting the large table-driven tests (§2).
- Introducing `@layer` to the stylesheet (§7).
