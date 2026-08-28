# Nova dashboard module system

Produced by plan `there-are-two-major-dazzling-corbato`
(`~/.claude/plans/there-are-two-major-dazzling-corbato.md`), 2026-08-28.

## Why

The dashboard has four registry patterns already — server capability modules
(`lib/modules/registry.ts`), the client panel registry
(`app/components/dashboard/panel-registry.tsx`), hot-dropped orb-module JSON
(`lib/orb-modules-disk.ts`), and versioned phonoscope modules
(`lib/phonoscope-store.ts`). Every one of them is **declarative data only**.
None can execute code that was not compiled into the bundle.

So extending a control's behaviour — putting a confirmation step in front of a
button, adding a control to an existing card, reacting to a state transition —
means editing `ClimateControls.tsx`, `TasksPanel.tsx` or
`app/api/entity/route.ts` directly and redeploying the whole dashboard.

This spec defines the missing layer: installable modules that carry real
runtime code, both server and client, and hook into named extension points on
the control surface. A module may add behaviour, add information, react to
events, or all three.

## Trust model

Modules are **not sandboxed**. Server code runs with the dashboard's full Node
privileges; client code runs with the page's. This is a deliberate decision:
Nova is a single-household, owner-operated system, modules are authored by the
owner, and there is no marketplace and no third-party publishing. A module is
trusted exactly as much as the dashboard's own source.

Consequences that follow from that and are **not** optional:

- The install path is authenticated the same way the rest of `/api/config` is.
  There is no anonymous module upload.
- A module that throws during load is disabled and its error recorded. It never
  takes the dashboard down.
- Nothing in this system may weaken the HA service allow-list in
  `lib/ha.ts:1231-1246`. Modules act *through* `setEntityAction`, never around
  it.

---

## 1. Package format

An installed module is a directory:

```
data/modules/<id>/
  module.json        manifest
  server.mjs         server half (optional)
  client.mjs         client half (optional)
  assets/            optional static files, served read-only
  config.json        written by the dashboard, never by the package
```

A module package as distributed is a ZIP of that directory's contents
(`config.json` excluded — it is installation state, not package content).

### Manifest — `module.json`

| field | type | notes |
|---|---|---|
| `id` | string | `^[a-z][a-z0-9-]{1,38}$`. Directory name. Immutable. |
| `name` | string | display name |
| `version` | string | semver |
| `description` | string | one line, shown in the config tab |
| `author` | string | optional |
| `repository` | string | optional URL |
| `entry.server` | string | relative path, default `server.mjs` |
| `entry.client` | string | relative path, default `client.mjs` |
| `hooks` | string[] | every hook id the module intends to use. Declared up front so the config tab can list them and so an unknown id is a load-time error, not a silent no-op. |
| `configSchema` | object | JSON Schema subset (§6) |
| `secrets` | string[] | secret **names** the module needs (§7) |
| `messages` | object | default message template per hook id (§5) |
| `routes` | boolean | whether the module serves its own HTTP routes (§8) |
| `minDashboardSchemaVersion` | number | compared against `DASHBOARD_CONFIG_SCHEMA_VERSION` (`lib/config-schema.ts:11`) |

Validated with zod before anything is written to disk. An invalid manifest
fails the install; it does not produce a half-installed directory.

### Packaging contract

Modules are built with esbuild to ESM.

- **All npm dependencies are inlined.** Only `node:*` builtins stay external.
  The dashboard cannot install packages at runtime and will not try.
- **Client bundles must not contain React.** React, the JSX runtime, and the
  shared Nova component set are handed to the module through the registration
  API. Two React copies break hooks — this is the single most likely way to
  get a module wrong, so the loader checks for a bundled React and refuses
  the module with a specific error rather than letting it fail at render time.
- Server bundles target Node 20 (the container is `node:20-trixie-slim`; there
  is no global `WebSocket`, so anything needing one bundles `ws`).
- No top-level side effects beyond defining the default export. All work
  happens inside `register()`.

### Module entry shape

```js
export default {
  async register(api) { /* … */ },
  async dispose() { /* optional: clear timers, close sockets */ },
};
```

`dispose()` is awaited on disable and before reload, with a 5 s timeout after
which the module is considered leaked and the failure logged. A module that
starts a timer or a socket and does not stop it in `dispose()` is a bug.

---

## 2. Loading

### Server

`lib/modules/runtime/loader.ts` scans `data/modules` at boot (from
`instrumentation.ts`, after the existing background services, inside its own
try/catch), reads each manifest, and for every **enabled** module:

```js
const url = `${pathToFileURL(entryPath).href}?v=${mtimeMs}`;
const mod = await import(/* webpackIgnore: true */ url);
await mod.default.register(api);
```

The `webpackIgnore` comment is load-bearing — without it Turbopack tries to
resolve the specifier at build time and the import fails. The `?v=<mtimeMs>`
query is the **reload mechanism**: ESM caches by resolved URL and offers no
uncache, so a reload re-imports under a new URL. The old instance is disposed
first. This leaks the previous module graph; that is accepted, reloads are a
development and recovery action, not a hot path.

### Client

`GET /api/modules/[id]/client.mjs` serves the file as `text/javascript` with an
`ETag` derived from mtime + size. `ModuleHost` imports it the same way:

```js
await import(/* webpackIgnore: true */ `/api/modules/${id}/client.mjs?v=${version}`);
```

### Failure handling

Load errors, `register()` throws, and manifest/version mismatches all take the
same path: the module is marked `failed` with the error message and stack tail
stored in `installed.json`, it contributes no hooks, and the config tab shows
the error. Boot continues. This mirrors `lib/orb-modules-disk.ts:28-63` — a bad
file is reported, not fatal.

---

## 3. Hook kinds

Three kinds, deliberately distinct. A module declares every id it uses in
`manifest.hooks`.

### 3.1 Slots — render points

```js
api.slot("card.body.after", (ctx) => api.jsx(MyThing, { entity: ctx.entity }));
```

Client only. Returns `ReactNode`. Every contribution renders inside its own
error boundary; a throwing slot renders nothing and logs, it does not blank the
dashboard.

| slot id | context |
|---|---|
| `header.banner.before` | `{}` |
| `header.banner.after` | `{}` |
| `clock.after` | `{ now }` |
| `card.header.actions` | `{ cardId, entity? }` |
| `card.body.after` | `{ cardId, entity? }` |
| `card.footer` | `{ cardId, entity? }` |
| `thermostat.aircon.controls` | `{ entity, preferences }` |
| `thermostat.heater.controls` | `{ entity, preferences }` |
| `reminder.editor.fields` | `{ task, moduleData, setModuleData }` |
| `reminder.tile.badge` | `{ task }` |
| `zone.controls.after` | `{ zone }` |
| `config.module.panel` | `{ moduleId, config, status }` |

`cardId` is the `ControlCard`'s stable id, so a module can target one card
rather than all of them.

The climate hooks are named `thermostat.*` rather than `climate.*` on purpose:
`climate` is a Home Assistant domain, so `climate.transition` reads as an entity
id — both to a person and to the household-data detector in
`lib/no-household-data.test.ts`. `thermostat` is also the more accurate word,
since these are the server thermostat authority's hooks.

### 3.2 Interceptors — sit in front of an action

```js
api.intercept("entity.action", async (ctx) => {
  if (!isRisky(ctx)) return "proceed";
  return { confirm: { title: "…", body: "…", confirmLabel: "Do it" } };
});
```

Return values:

| value | meaning |
|---|---|
| `"proceed"` | this interceptor has no objection |
| `"cancel"` | the action does not happen |
| `{ confirm: ConfirmRequest }` | host renders `ConfirmDialog`; confirm ⇒ proceed, dismiss ⇒ cancel |

`ConfirmRequest` matches the shared `app/components/ConfirmDialog.tsx` props,
including the optional second stage. The outcome is reported back to the module
via optional `onConfirmed` / `onCancelled` callbacks on the request, so a module
can record or announce the decision.

Interceptor ids: `entity.action`, `zone.action`, `reminder.complete`,
`reminder.delete`.

Ordering and timing:

- Interceptors run **in registration order**; the first `cancel` wins and the
  rest are not consulted.
- Client interceptors run in `useDashboardCommands.ts` **before** the optimistic
  state write and before `pausePolling`. A cancelled action must leave no
  optimistic state and no poll hold behind. The POLLING COOLDOWN CONTRACT in
  `app/components/dashboard/state.ts` is unchanged by this feature.
- Server interceptors run in the API route before `setEntityAction`. A server
  cancel returns `409` with `{ cancelled: true, by: <moduleId> }`.
- An interceptor that has not settled within **5 s** is treated as `"proceed"`
  and the timeout logged. Controls must not be able to wedge on a bad module.

### 3.3 Events — fire and forget

```js
api.on("thermostat.transition", async (event) => { /* … */ });
```

No return value, no ordering guarantee, errors swallowed and logged.

| event id | emitted from |
|---|---|
| `entity.action.applied` | `app/api/entity/route.ts`, after `setEntityAction` |
| `zone.action.applied` | `app/api/zone/route.ts` |
| `thermostat.transition` | `lib/climate-control.ts` authority tick, on commanded-state change |
| `reminder.due` | task-alert scan in `lib/dashboard-events.ts` |
| `reminder.completed` | `lib/tasks.ts` `completeTask` |
| `reminder.uncompleted` | `lib/tasks.ts` `uncompleteTask` |

**Server events are the authority.** `thermostat.transition` in particular must
fire with no browser open — that is the whole reason "heater turned off when
the room reached 22 degrees" is reachable at all. Client-originated events are
forwarded to the server bus via `POST /api/modules/events` and are advisory.

---

## 4. Event payload

Every event carries a common envelope:

```ts
type ModuleEvent = {
  id: string;              // event id
  at: string;              // ISO 8601, when the event HAPPENED
  source: "server" | "client";
  actor?: string;          // client id, "climate-control", "agent", …
  entity?: { id, friendlyName, domain, state, previousState? };
  zone?: { id, name };
  task?: { id, name, moduleData? };
  target?: number;         // e.g. commanded temperature
  trigger?: string;        // "schedule" | "sensor" | "manual" | "agent" | …
  reason?: string;         // human-readable cause
  data?: Record<string, unknown>;
};
```

`at` is the time of the event, never the time of delivery. Anything that queues
and batches downstream (the Discord module does) must carry `at` through so a
message delivered 29 seconds late still reads with the right timestamp.

---

## 5. Message templates

Templates belong to the consuming module, not to this system, but the shape is
fixed here so the config form can render them generically.

- `manifest.messages` supplies a **default template per hook id**.
- The Modules config tab renders one field per entry, seeded with the default.
- An **empty field means that hook stays silent**. This is the off switch;
  there is no separate per-hook enable checkbox for messages.
- Placeholders are `{dotted.path}` against the `ModuleEvent`, plus the
  convenience aliases `{entity}` (friendly name), `{state}`, `{target}`,
  `{zone}`, `{reminder}` (task name), `{trigger}`, `{reason}`, `{at}`.
- An unresolved placeholder renders as the empty string and is logged once per
  template per process, not per event.

---

## 6. Config schema and the config form

`manifest.configSchema` is a **restricted JSON Schema subset**, because the form
is generated and must only use the controls in the inventory
(`nova-ha-dashboard/CLAUDE.md`). No raw inputs, no JSON textarea — module config
is explicitly not text-editable in the UI.

Supported at the top level only (no nesting beyond one level of `object`):

| schema | rendered as |
|---|---|
| `{"type":"boolean"}` | `CheckboxRow` |
| `{"type":"string"}` | `ConfigSelect` if `enum`, otherwise a single-line field using the same styling as the reminder name field |
| `{"type":"string","format":"secret"}` | secret picker (§7), value never displayed |
| `{"type":"number","minimum","maximum"}` | `SliderControlPanel` (which gives tap-to-type via `NumericEntryPopover`) |
| `{"type":"string","x-nova-control":"template"}` | message-template field |
| `{"type":"object"}` | one nesting level, rendered as a `ConfigAccordion` sub-group |

`readOnly: true` renders as a static readout — used for values the module
resolves at runtime, e.g. a resolved Discord user id.

Anything outside the subset fails manifest validation with a message naming the
offending property. Better to reject at install than to render a broken form.

### Export / import

- Export produces `<id>-config.json`: `{ moduleId, version, exportedAt, config }`
  with every `format: "secret"` value **omitted**, not blanked.
- Import validates against the installed module's schema, then merges. Missing
  secret references are reported in the UI as "needs a secret" rather than
  silently leaving the module broken.
- Uses the same download/upload idiom already in `ConfigWorkspace.tsx` for
  dashboard config (`downloadJson` + hidden file input).

---

## 7. Secrets

Module secrets live in the **existing dashboard secrets store**
(`app/api/config/secrets`), never in `config.json` and never in the package.

- `manifest.secrets` lists names, e.g. `discord.botToken`.
- Config stores the *reference* (the name), so export/import carries the
  reference and never the value.
- `api.secret(name)` resolves it server-side. It is not exposed to client code
  at all — there is no client API for reading secrets.
- A missing secret is a `status: "needs-setup"` for the module, surfaced in the
  config tab, not a crash.

---

## 8. Module-owned HTTP routes

`api.route(method, path, handler)` registers under
`/api/modules/[id]/[...path]`. Needed when a module must be reachable from
outside the dashboard's own UI (the Discord module relays inbound messages this
way, so that the voice-host mTLS identity stays in the dashboard where it
already lives instead of being copied into module config).

- Only registered when `manifest.routes` is `true`.
- Handlers receive a stripped context: parsed body, query, headers. They do not
  get the raw `NextRequest`.
- Same authentication as the rest of the dashboard API. A module route is not a
  public endpoint.

---

## 9. Storage and lifecycle

```
data/modules/
  installed.json        { [id]: { version, enabled, source, installedAt, status, error? } }
  <id>/                 the module package + config.json
```

`data/` is excluded from `deploy-nova-dashboard.ps1`'s tar and is never replaced
by `nova-release`'s release swap, so **installed modules and their config
survive both deploys and self-updates**. That is why they live there rather than
in `config/`.

Writes go through a serialising queue and atomic temp-file + rename, matching
`lib/tasks.ts:20` and `lib/dashboard-config.ts:220-241`.

Operations: install (from upload or URL), enable, disable, reload, delete,
download (re-pack to ZIP), read/write/export/import config.

### Install limits

Modelled on `installPhonoscopePackage` (`lib/phonoscope-store.ts:1017`):

| limit | value |
|---|---|
| compressed package | 10 MB |
| extracted total | 40 MB |
| single file | 20 MB |
| file count | 200 |

Allowed entries: `module.json`, the two declared entry files, `*.mjs`/`*.js` in
the package root, and `assets/**` restricted to `png jpg jpeg webp svg woff2
json md`. Anything else — path traversal, absolute paths, symlinks, dotfiles,
nested archives — rejects the whole package. Extraction happens in memory
(fflate) and is written out only after every entry has passed.

### Default modules

`dashboard.modules.defaults[]` in the config schema:

```json
{ "id": "discord-bot", "repository": "https://github.com/…", "tarballUrl": "…", "enabled": true }
```

On boot, any default not present in `data/modules` is fetched and installed
through the same validated path as an upload. Network failure is a warning in
`installed.json` and a retry on the next boot — never fatal, never a boot
blocker, never a blocking wait on the dashboard becoming ready.

---

## 10. Registration API surface

What `register(api)` receives.

**Both halves:** `api.id`, `api.version`, `api.config` (frozen snapshot),
`api.onConfigChange(cb)`, `api.log(level, msg, data?)`,
`api.slot` / `api.intercept` / `api.on` as applicable.

**Server only:** `api.secret(name)`, `api.route(...)`, `api.emit(id, event)`,
`api.storage` (namespaced read/write JSON under `data/modules/<id>/`),
`api.setStatus(status)` — the object surfaced in the config tab,
`api.fetch` (plain fetch, no wrapper — modules are trusted).

**Client only:** `api.react` (the host's React), `api.jsx` (the JSX runtime's
`jsx`/`jsxs`, so a module can be built without a JSX pragma resolving to its
own React), `api.components` (`ControlCard`, `CheckboxRow`, `ConfigSelect`,
`MomentaryFeedbackButton`, `SliderControlPanel`, `IconButton`, `ModalOverlay`,
`ConfirmDialog`), `api.request(path, init)` (fetch scoped to the module's own
routes), `api.emit(id, payload)` (forwards to the server bus).

The component set is deliberately the shared inventory from
`nova-ha-dashboard/CLAUDE.md`. A module rendering a raw `<button>` looks wrong
on this surface; giving it the real controls is what stops that.

---

## 11. Done means

- A fixture module installs from a ZIP through the config tab, with no rebuild
  and no restart.
- It renders into a slot on the dashboard.
- It cancels an entity action through an interceptor, and separately gates one
  behind `ConfirmDialog` with both outcomes reported back to it.
- It receives a server-emitted `thermostat.transition` with **no browser open**.
- Enable, disable, reload, delete and download all work, and config export
  contains no secret values.
- A deliberately broken module (throws in `register`) shows as failed in the
  config tab and the dashboard is otherwise unaffected.
- Installed modules survive a `deploy-nova-dashboard.ps1` deploy.
