# Config page URL breadcrumb trail

Plan: bubbly-roaming-adleman

## Problem

`/config` currently exposes exactly one level of URL state: a hash fragment
(`#appearance-dashboard`, `#appearance`, `#updates`, ...) set by
`ConfigWorkspace.selectCategory` and read by `ConfigAccordion`'s own
hash-match effect. Everything below the top-level category — which nested
accordion is open, how many levels deep — lives only in `sessionStorage`
(`configUiState.ts`, 5-minute TTL) and is invisible to the URL. A section
three or four folds deep (e.g. Appearance & Dashboard → Theme & Experience →
Theme Settings → Background) has no address that reopens it directly.

## Goal

The address bar always reflects the full path to the deepest currently
unfolded section, for any accordion anywhere on the page:

```
/config/appearance-dashboard/theme-experience/theme-settings/background/
```

Confirmed shape (interview, 2026-09-10):

- **Scope**: every `ConfigAccordion` instance gets a slug and contributes to
  the URL when open — including dynamically-generated ones (Phonoscope's
  per-item accordions), not just the hand-authored sections.
- **Deep links must actually work**: pasting or reloading a deep path opens
  that full chain from a cold load, on both the live server
  (`nova.tuatara-dory.ts.net`, `next start`) and the static-export public
  demo (GitHub Pages, `output: "export"`).
- **History**: folding/unfolding an accordion replaces the current history
  entry (matches today's category-switch behaviour) — no extra back-stack
  entries per fold.
- **Visible breadcrumb**: floating, top-centre, minimal, integrated with the
  existing config-page chrome. Clicking a crumb scrolls to that section
  without collapsing anything below it or shortening the trail — pure
  navigation, never a state mutation.

## Current tree inventory

`ConfigWorkspace.tsx` mounts exactly one category's JSX at a time
(`assistant`, `voice-people`, `appearance-dashboard`, `devices`, `modules`,
`system-data` — `ConfigCategoryId`). Accordions never coexist across
categories.

**Static top-level accordions, one per category, all already carry a proper
`id`:**
- assistant: `identity`, `agent`, `authority`
- voice-people: `voice-infrastructure`, `voice`, `voice-training`,
  `user-data`
- appearance-dashboard: `appearance`, `reminders`, `status-orb-info`,
  `climate`, `appletv-swipe`, `phonoscope`
- devices: `managed-computers`, `hardware-assistant`, `camera`
- modules: `modules` (per-module rows inside are plain rows, not nested
  accordions)
- system-data: `history`, `secrets`, `config-transfer`, `updates`, `system`

**One level deep, static, already id'd:** `FaceEnrolmentConfig`
(`id="face-enrolment"`) and `KioskActivityConfig`
(`id="kiosk-activity"`), both siblings inside `UserDataConfig`
(`id="user-data"`).

**Inside `AccentConfig`'s "Theme & Experience" (`id="appearance"`) —
`app/components/AccentConfig.tsx` — currently MISSING `id` (title-derived
persistKey only), one level deep then two:**
- `"Theme Settings"` (line ~2055) — one level deep
  - `"Theme Colours"` (~2056), `"Fonts"` (~2092), `"Status Orb"` (~2142),
    `"Background"` (~2156), `"Map"` (~2193), `"Reminders"` (~2231),
    `"Sound"` (~2249) — two levels deep, siblings of each other

**Phonoscope subtree** (`PhonoscopeConfig` → `id="phonoscope"` →
`ControlSettingsPanel` + `ColorThemeLibrary`) — static siblings one level
deep, already id'd: `phonoscope-house-party`, `phonoscope-color-groups`,
`phonoscope-color-themes`, `phonoscope-settings-groups`. Then **dynamic,
unbounded, build-time-unknown** instances, already id'd from data — reuse
these ids as-is, they're already slug-shaped:
- two levels deep: `color-theme-${theme.id}`, `color-group-${group.id}`,
  `settings-group-${group.id}`
- three levels deep: `entry-${entry.id}` (inside a colour-theme group),
  `lane-${lane.id}` (inside a settings group)
- four levels deep: `effect-group-${laneId}-${group.id}`,
  `effect-${binding.id}` (inside a lane)

`EffectGroupEntry`/`EffectEntry` do not nest a fifth accordion level
(existing comment: "deliberately not a fourth level of accordion").

## Why there is always exactly one "deepest open section"

`ConfigControls.tsx`'s sibling-close logic (`closeOpenSibling`) closes an
accordion only when another accordion opens under the *same nearest
enclosing `.config-accordion` ancestor* (top-level accordions all share "no
ancestor" and are therefore one exclusivity group per mounted category).
Because this rule is enforced recursively at every depth, at most one
branch can ever be open from the category down to whichever leaf is
currently open — there is never a fork to reconcile, only a single chain to
read off. The breadcrumb is exactly that chain.

## Slug policy

Every `ConfigAccordion` must have an explicit `id`:
- kebab-case, unique across the whole tree
- doubles as the `configAccordionKey` persistence key (`configAccordionKey`
  already does `id ?? title` — once every call site passes `id`, the
  title-fallback branch becomes dead code; confirm with a search for
  `<ConfigAccordion` call sites lacking `id` before removing it, don't
  assume the AccentConfig set above is exhaustive)
- for the ~7 nested AccentConfig accordions, use the kebab-case of their
  title: `theme-settings`, `theme-colours`, `fonts`, `status-orb`,
  `background`, `map`, `sound` (note: `Reminders` nested here needs a
  distinct id from the top-level `reminders` accordion, e.g.
  `theme-reminders`, to keep ids unique tree-wide)

## Chain computation

A function (new module, e.g. `app/components/configBreadcrumb.ts`) that,
given the mounted DOM under the active category's container
(`#config-category-content`), walks down: find the open accordion
(`.config-accordion.config-accordion-open`) whose nearest enclosing
`.config-accordion` ancestor is `null` (top-level) — call it the first
link — then repeatedly find the open accordion whose nearest enclosing
`.config-accordion` ancestor is the previous link, appending its `id` to
the chain, until no next link is found. Mirrors the ancestor-comparison
`closeOpenSibling` already does.

Runs on:
- the existing `CONFIG_ACCORDION_OPEN_EVENT`
- a new equivalent close event — today `toggleOpen`'s close branch (`if
  (open) { setOpen(false); setAccordionOpen(persistKey, false); return; }`)
  dispatches nothing; add a dispatch there (e.g.
  `CONFIG_ACCORDION_CLOSE_EVENT`) so collapsing the deepest open leaf
  shortens the URL
- category change (`selectCategory`)
- initial mount

## URL sync

`window.history.replaceState` (never `pushState`) rebuilds `pathname` to
`/config[/<category>[/<slug>]*]/ ` on every chain-change, trailing slash
included for consistency with the demo export's `trailingSlash: true` and
the confirmed example. This replaces:
- the hash-only `window.history.replaceState` call in
  `ConfigWorkspace.selectCategory`
- `ConfigAccordion`'s own per-instance hash-match effect (the `#${id}` deep
  link handling folds into the shared pending-queue mechanism below)

## Route change

`app/config/page.tsx` → `app/config/[[...slug]]/page.tsx` (optional
catch-all). Server-side data-fetching logic is unchanged — the page stays a
thin wrapper around `ConfigWorkspace`; all path interpretation happens
client-side, reading `window.location.pathname` at mount, parallel to how
the hash is read today. Caddy needs no change: `ops/iridium/nova.Caddyfile`
already matches `/config` and `/config/*` as one glob and proxies
unconditionally to the Next server.

## Deep-link resolution on load

Parse the initial pathname into `[category, ...slugs]`. Validate `category`
against `ConfigCategoryId`; if invalid/absent, land on the plain category
grid (today's behaviour for no hash/no remembered category).

Seed a shared "pending breadcrumb queue" (module-level array) with the
remaining slugs. Each `ConfigAccordion`, on mount and whenever the queue
changes, checks: is my `id` the next unconsumed entry in the queue, and is
my nearest enclosing accordion the one already opened by this same
resolution pass (or am I top-level and it's the first entry)? If so, open
exclusively (without the click-only scroll behaviour — see below) and
consume that queue entry.

This must tolerate async mounting: Phonoscope's dynamic accordions don't
exist in the DOM until their data has loaded, so the queue has to stay live
and get re-checked as new accordions mount, not just once at page load.

If a segment never matches (stale/deleted item, typo, old link) stop
silently and leave whatever prefix resolved open — never error, never
retry indefinitely (drop the queue once nothing has matched for one full
render pass after data is confirmed loaded, or once the category's initial
data fetch settles). Auto-scroll into view only once the *whole* requested
chain has resolved (last queued segment matched), not once per
intermediate level — avoids a jumpy multi-stage scroll on cold load.

## Legacy compatibility

- `UpdateBanner.tsx`'s `<Link href="/config#updates">` becomes
  `/config/system-data/updates/`.
- Add a one-time client-side redirect: on mount, if
  `window.location.pathname === "/config"` (or trailing-slash variant) and
  `window.location.hash` matches an entry in the existing `HASH_CATEGORY`
  map or a known accordion `id`, translate it to the new path form via
  `history.replaceState` before the rest of the resolution logic runs. This
  protects any existing bookmarks/saved links without adding a redirect
  table to maintain separately — it reuses `HASH_CATEGORY` as-is.

## Demo static export

`scripts/build-demo.mjs` builds with `NEXT_PUBLIC_NOVA_DEMO_MODE=true`,
which flips `next.config.ts` to `output: "export"`, `trailingSlash: true`,
deployed to GitHub Pages (`antidamage.github.io/nova-ha-dashboard/config/`)
— a real static host, no server-side fallback.

- `generateStaticParams` on the catch-all route returns root (`[]`) plus
  every *static* category/accordion path prefix — derive this list from the
  same tree data used to render the page (a shared constant, not a
  hand-duplicated list), so adding a new static accordion later doesn't
  require remembering to update a second place. Do **not** attempt to
  enumerate the dynamic Phonoscope leaves (unbounded, data-dependent).
- Add the standard GitHub Pages SPA fallback: after `next build` finishes,
  copy the built `config` page's output HTML to `404.html` at the export
  root (alongside the existing `.nojekyll` marker in `scripts/build-demo.mjs`).
  Any path under `/config/*` not covered by `generateStaticParams` — chiefly
  the dynamic Phonoscope leaves — 404s server-side on GitHub Pages, which
  then serves that same `404.html` shell; the client-side resolution logic
  above takes it from there exactly as it would on a real cold load.

## Breadcrumb UI

New component, e.g. `app/components/ConfigBreadcrumb.tsx`, mounted in
`ConfigWorkspace` above `#config-category-content`. Rendered only when a
category is active (hidden on the plain category grid).

- `position: fixed`, top-centre — same pattern as the existing fixed-top
  elements in `app/globals.css` (reload button / avatar header, ~lines
  2455-2500): `top: calc(Npx + env(safe-area-inset-top, 0px))`,
  `left: 50%`, `transform: translateX(-50%)`.
- Visually minimal: dark panel matching `config-page-button`/
  `config-category-*` styling (neutral-950/70 background, neutral-700
  border, small uppercase labels), `›` (ChevronRight, already imported
  elsewhere) between crumbs.
- Overflow: reuse `useHorizontalDragScroll` (already used for
  `config-category-nav`) since Phonoscope chains can reach 5 segments.
- Each crumb is a plain `<button>` that looks up the still-open DOM element
  for that slug (same registry/DOM-lookup the chain computation already
  does) and calls `scrollIntoView` on it — the same deferred
  two-animation-frame, `prefers-reduced-motion`-aware scroll
  `ConfigAccordion` already uses for a real click-to-open. It must **never**
  call `toggleOpen`/close anything, and must never shorten the displayed
  chain — purely a "jump to" convenience.

## What "done" means

- Every accordion in the tree, including Phonoscope's dynamic ones, opens
  to a real, reloadable, bookmarkable URL matching the open chain.
- Folding/unfolding never grows the browser back-stack.
- The breadcrumb strip always matches the deepest open section and never
  desyncs from it (verify against rapid open/close clicks, not just a
  single fold).
- The demo build still produces a working static site; a deep Phonoscope
  link works there via the `404.html` fallback.
- `UpdateBanner`'s deep link still lands on, and opens, the Updates
  section.
- Existing accordion exclusivity tests (`ConfigControls.test.tsx`) still
  pass; extend them to cover chain computation and the close-event
  addition rather than duplicating a second test file.
