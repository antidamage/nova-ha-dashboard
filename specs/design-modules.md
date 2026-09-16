# Design modules — switchable presentation layers

Plan: `we-want-to-take-noble-key` (`~/.claude/plans/we-want-to-take-noble-key.md`).

A **Design** is a swappable presentation layer for the dashboard route. The
current UX becomes one Design ("Nova Classic"); others can be added and
selected from `/config`, next to the colour-theme selector.

## The orthogonality rule

Design and colour theme are two independent axes.

- Changing the Design must never alter a colour-theme value.
- Loading a saved colour theme must never change the active Design.
- Background and status-orb settings stay colour-theme properties.
- `/config` is core: it is **not** styled by a Design. The only config change
  is the Design selector itself.

## Storage

The active Design is **shared**, not per-device — the same axis the colour
theme lives on.

- `preferences.design = { activeId: string }`, plus `preferences.designUpdatedAt`.
- `GET/POST /api/design`. `POST` validates the id's **shape only** and stores a
  well-formed but unknown id as given — deliberately, so uninstalling a design
  does not rewrite the stored preference. Whether an id names a design that
  exists is decided at render time by `resolveDesign()`, which falls back to
  `DEFAULT_DESIGN_ID`, so a preferences file naming a removed design can never
  blank the dashboard.
- Writes are gated by authentik at the edge: `/api/design` is listed in the
  `@admin_writes` matcher in `ops/iridium/nova.Caddyfile` (both server blocks),
  alongside `/api/theme`. `GET` stays open, like `/api/theme`'s.
- `localStorage["nova.dashboard.design.v1"]` is a read cache only. The server
  is authoritative.

### Every client follows a change

One design is shared by the whole house, so a change made on any screen has to
reach the rest — otherwise the wall panel keeps the old presentation until
somebody reloads it. After the write lands (never before — an announcement must
not name a design that failed to persist), `POST /api/design` calls
`publishDesign()` in `lib/dashboard-events.ts`, which broadcasts an SSE event
named `design` carrying the new id.

`useActiveDesignId` subscribes through `subscribeToDashboardEvents`, the
**shared** EventSource. That is not incidental: opening a second one would spend
another of the browser's ~6 connections per origin, a budget this dashboard has
already starved once (see the header comment in
`app/components/sharedDashboardEvents.ts`). A receiver ignores an id its build
does not know, so a half-deployed house keeps rendering something.

The switch is live — the design root remounts under its new key and the scoped
stylesheet takes over. No page reload is involved, and none is needed: every
built-in design's CSS is already present.

Demo mode has no server and therefore no stream, but it is a single client, so
the local change event already covers it.

Design-specific *settings* (as opposed to which design is active) live inside
each colour-theme variant under a `designs.<designId>` namespace, so a theme
carries the look of every design it has been used with. That namespace is
preserved verbatim — see "Settings namespace" below. Not yet implemented; the
contract reserves it.

## Resolving the active design without a hydration break

Three constraints, all load-bearing:

1. `app/page.tsx` is `export const dynamic = "force-static"` and `app/layout.tsx`
   is prerendered. Demo mode builds with `output: "export"` and
   `scripts/build-demo.mjs` renames `app/api` out of the tree first. **The
   server cannot know which design is active**, and in demo there is no server.
2. `specs/maintenance-rule.md`: an element whose SSR markup depends on
   client-only state must not be gated directly on it — gate the reveal on a
   post-mount flag so the first client render matches the server.
3. Swapping a Design swaps a whole component tree, not a CSS variable. The
   theme/camera bootstrap precedent (which only sets CSS custom properties and
   attributes on already-rendered markup) does not cover it.

So:

- `app/api/design/bootstrap/route.ts` — modelled on
  `app/api/camera/bootstrap/route.ts` (`dynamic = "force-dynamic"`,
  `runtime = "nodejs"`, `Cache-Control: no-store`) — returns a script setting
  `window.__NOVA_DESIGN__` and the `data-nova-design` attribute on `<html>`.
  It is loaded with a parser-blocking `<script src>` in `<head>`, before the
  inline theme bootstrap, so the attribute is set pre-paint. Demo mode inlines
  the value instead, since the route will not exist.
- `DesignHost` renders `DEFAULT_DESIGN_ID` on the server **and on its first
  client render**, then reads `window.__NOVA_DESIGN__` in an effect and swaps.
  Hydration therefore always matches, at the cost of one discarded render when
  the active design is not the default. This cost is accepted deliberately: it
  is the price of `page.tsx` being static, and it is invisible for the default
  design, which is the overwhelmingly common case.
- A non-default design would otherwise show a frame of Nova Classic first, so
  core CSS carries one rule hiding the default design's root while the
  `data-nova-design` attribute names a different design. Accepted gap: that
  guard keys off the attribute, so if the bootstrap `<script src>` itself fails
  to load (rather than failing to read preferences, which it handles), no
  attribute is set, and a non-default design shows one frame of Nova Classic
  before the effect swaps it. It self-heals in a frame and only on a
  same-origin network failure, so it is not worth a second mechanism.
- `DesignHost` renders `<Root key={id} />` — the key forces a full remount on a
  switch, which is what discards the outgoing design's local state.

## Contract

`app/design/contract.ts`:

```ts
export type DesignManifest = {
  id: string;            // ^[a-z][a-z0-9-]{1,38}$ — same id rule as modules
  name: string;
  description: string;
  version: string;
  author?: string;
};

export type DesignModule = {
  manifest: DesignManifest;
  Root: ComponentType;
  /** Experience-mode parity (specs/maintenance-rule.md): required, not optional. */
  lite: { statusOrb: boolean; background: boolean; camera: boolean; worldMap: boolean };
};
```

`lite` is not documentation: `DashboardGlobalServices` consults the active
design's `lite.statusOrb` on `/` and does not mount the status orb for a
design that declares it `false`. That's what satisfies the Experience Mode
Parity rule (`specs/maintenance-rule.md`) rather than merely stating it.

`app/design/registry.ts` owns `builtinDesigns`, `listDesigns()`,
`resolveDesign(id)` and `DEFAULT_DESIGN_ID`. Nothing outside the registry
imports a design folder directly, so a future runtime-installed design source
plugs into the same interface without a second architecture.

## CSS scoping

Each design's stylesheet is authored with every selector under
`html[data-nova-design="<id>"]`. All built-in stylesheets are statically
imported, so all are present and only the active one matches; switching needs
no reload.

`globals.css` has no `@layer` blocks and Tailwind v4 emits into cascade layers,
so globals already beat every Tailwind utility. Adding one attribute selector
does not change that relationship.

Nova Classic keeps using `globals.css` as-is for now: extracting the dashboard
surface rules out of that 6480-line file is a separate, screenshot-verified
step (plan task 4) and is deliberately not bundled with the switching mechanism,
so a regression in one cannot be blamed on the other.

## Settings namespace (reserved, not yet built)

`DeviceTheme` gains `designs: Record<string, Record<string, unknown>>`.
`normalizeTheme` in `app/components/accentColor.ts` returns a hand-built object
literal and therefore drops any field it does not name — that is the single
place a design namespace would be lost. Everything else on the path already
preserves unknown fields by spreading, verified end to end:
`sharedThemeValue` strips only `autoFullscreenOnLoad` and
`followVisualizerWhenActive`; `themeResponseValue` and `mergeLegacyThemeUpdate`
spread; `normalizeThemeLibrary`'s `themeSetWithoutSharedConfig` strips one key
and spreads the rest.

When implemented, the namespace normaliser must apply **no field-level
normalisation at all** — deep-clone and keep. Schema defaults are applied at
read time, never at store time. That is what lets a namespace belonging to an
uninstalled design survive a save/load round trip byte-for-byte.

## Config surface

`AccentConfig`'s first section already holds a "Theme Library" block with
`<ThemeLibraryControl>`. The Design selector is a sibling block directly after
it, built on the same portalled cyber-listbox (`useSelectMenu`,
`cyber-select-trigger`, `cyber-select-menu`) so it reads as the same kind of
control. It has no Save/Rename/Duplicate/Delete row — designs are a registry,
not a user library.

Nothing else on the config page changes.

## Demo parity

`specs/maintenance-rule.md` requires the demo to support every feature. `lib/demo-config.ts`
intercepts `/api/*` client-side and backs the theme with `sessionStorage`;
`/api/design` joins it on the same terms. In demo, `sessionStorage` *is* the
server, so "shared, not per-device" still holds.

## Verification

- `npm run build`, `npx tsc --noEmit`, `npm run test:unit`.
- `npm run test:e2e` — the existing eleven specs exercise the DOM this touches
  and must pass unchanged.
- `app/liteMode.contract.test.ts` passes unchanged.
- `app/design/design.contract.test.ts`: manifest ids unique and well-formed;
  every design declares all four `lite` flags; the registry default resolves;
  an unknown id falls back rather than throwing.
- Switching design in `/config` changes the dashboard without a reload, and the
  choice survives a reload.
