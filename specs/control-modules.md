<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Control modules and presets

Adeline, 2026-09-22. Quick Access is becoming modular and configurable, and this
is the layer that makes it possible: the dashboard's controls become **device
types** (modules) with **saved presets** under them, and a **slot** on a surface
holds a preset.

The dashboard is backed by that configuration rather than by code from the
moment this ships — including for an installation that has never opened the
Devices tab, which is what the derivation in "Nothing stored yet" below is for.

## The two layers

A **control module** is what appears on the dashboard. A **driver module** is how
one kind of hardware is actually driven. Keeping them apart is what lets the same
control be pointed at a different make of device, and it is the second layer of
modularity asked for: the Gree unit's interface is a module assignable to any
climate device, not the Lounge's air conditioner.

| Module | Layer | Drawn by | Notes |
|---|---|---|---|
| Air Conditioner / Heater | control | Temperature knob | Configured to be an air conditioner or a heater; runs on the driver assigned to it |
| Gree Air Conditioner | driver | — | The Gree indoor unit: Auto/Manual/Off, fan steps, Quiet / Turbo / Fresh air, dry emulation |
| Sample Heater WiFi Switch | driver | — | A smart switch plus the room's own sensors, with the thermostat loop on this server. The sample to copy for a switch-and-sensor room |
| Room Lighting | control | Lighting dial | Any room's lights: colour, brightness, the room's preset buttons |
| Amplifier | control | Amplifier dial | Volume, mute, playlists. Placeholder dial for the IR emitter, as before |
| Outside Weather | control | Weather readings | Condition, temperature, feels-like, UV |

A control declares the **behaviours it links into**; a driver declares the ones it
**provides**. That listing is what makes a control portable — another household
can see what it has to supply before placing one — and it is a description of
machinery that already exists (`lib/aircon-control.ts`,
`lib/bedroom-heater-control.ts`, `lib/ha/lighting/zone-action.ts`), not a promise
about new machinery.

### Features are switches; behaviours are facts

A module's **features** are things a preset can switch off, and each one is wired
to something real in this change:

| Feature | On the module | Does |
|---|---|---|
| Fan ring | Air Conditioner / Heater (aircon variant only) | Shows or hides the fan step ring |
| Off timer | Air Conditioner / Heater | Shows or hides the timer ring |
| Quiet / Turbo / Fresh air | Air Conditioner / Heater (Gree driver) | Includes the unit's auxiliary switches, or leaves them out entirely |
| Grouped room sensors | Air Conditioner / Heater (heater driver) | Whether the knob reads the room from its configured sensor list at all. Off leaves it with no room temperature, because a bare switch has no reading of its own |
| Humidity readout | Air Conditioner / Heater (heater driver) | Includes the room's humidity in the knob's label |
| Preset buttons | Room Lighting | Shows the room's named presets beside the dial |
| Feels like, UV | Outside Weather | Includes each reading |

Auto arming and Dry emulation are deliberately **behaviours, not features**. Both
are decided server-side from what the unit itself reports, so a switch here would
be a control that appears to change behaviour and does not.

A feature with `driverIds` or `variantIds` is greyed out unless the preset's
driver and variant are ones it applies to, so "Quiet / Turbo / Fresh air" cannot
be switched on for a driver that has no such switches and a fan ring is not
offered on the heater, which has no fan.

The gate is implemented ONCE, in `lib/control-modules/features.ts`
(`featureApplies`), and both the editor that greys a row out and the model that
resolves the value call it. A feature that does not apply carries **no value at
all** rather than a default, so nothing downstream can read a default as "on" for
a part the control does not have — the defect that made this one function instead
of two agreeing conditions.

## The preset

A preset is one configured instance of a module, saved locally. It holds:

- `name` — the label on the dashboard, so a preset is the card's title now
  (`dashboard.aircon.title` used to be the only way to name the Lounge knob).
- `roomId` — the HA area it serves, or `null`, which means **inherit the room the
  slot is placed in**. Inherit is what makes a preset reusable: "this room's
  lights" is right in every room, while a preset naming the Lounge is wrong
  anywhere else.
- `driverId`, and `variant` where the module can be either — an air conditioner
  or a heater.
- `features` — the switches above. A missing entry means the module's default, so
  a preset saved before a feature existed keeps behaving as it did rather than
  silently gaining one.
- `binding` — this installation's entity ids. **Which fields are meaningful comes
  from the module**, resolved by `editorFields(module, driver)`: the control
  contributes what every variant shares, the driver contributes what its hardware
  needs. A control with a driver therefore shows the driver's fields, and an
  aircon preset can never be asked for a heater's switch list.

### A room, and what a preset's role is

For Room Lighting the room IS the device: the zone whose lights it switches, so a
lighting preset's room picker is its whole configuration. For a climate preset the
room is where its unit lives, and the binding names the unit.

### Two harms the model is built to avoid

- **A preset's `id` is its instance id.** It keys the room's control state
  (`DashboardState.climateControl`) and its remembered settings
  (`preferences.climate[id]`, or `preferences.aircon` / `.bedroomHeater` for the
  legacy first of each kind). Adopting the derived defaults therefore cannot move
  a heater's saved target, because the derived ids are the ones already in use.
- **An id, and a name, are made unique when they are made.** The id is what the
  store and the control state key on, so a duplicate id would make one of the two
  presets unreachable; the name is made unique as well so two rows in the Devices
  list cannot read alike. Nothing keys on the name — renaming a preset onto
  another's name is allowed and changes nothing but what is displayed.
  `newPreset` picks an unused id and an unused name up front.

## Storage

Presets and slots live in the dashboard config at `dashboard.controls`
(`lib/config-schema/controls.ts`), written by the config page through
`PUT /api/control-modules` into `data/dashboard-config.json`.

They are deliberately **not** in the household package. Arrays replace wholesale
in the config merge, and the runtime store holds a complete document, so a stored
empty list would shadow a household one — the household layer cannot supply an
array the runtime store also carries. Presets are runtime configuration, like
reminders, and this is the only storage shape that cannot produce two answers.

Installed *modules* are different: a module is an artifact, not configuration, and
lives under `data/control-modules/<id>.json` so it survives a deploy and a
self-update.

## Nothing stored yet: the derivation

`effectiveControls(config)` returns the stored presets when there are any, and
**derives the whole set** when there are none (`lib/control-modules/presets.ts`):

```
one aircon preset   per declared aircon instance, else the legacy dashboard.aircon block
one heater preset   per declared heater instance, else the legacy dashboard.bedroomHeater block
home-lights         Room Lighting on the Home zone ("everything")
amplifier           Amplifier
outside             Outside Weather
```

Slots follow the same order the card had before it was configurable: lights,
amplifier, the climate knobs, outside. The Bindings come from the same config, so
the derived card is the card that was there yesterday — that is the acceptance
test, `lib/control-modules/presets.test.ts`, and it is why the first preset is
named `lounge` and not something new.

Two consequences, both deliberate:

- **Stored wins outright, and "stored" is a flag rather than a count.** With the
  block saved, the derivation is not consulted at all — including when the stored
  list declares no heater, because "this home has no heater" is an answer rather
  than an absence. That is the same two-level fallback
  `dashboard.climate.airconUnits` already uses over the legacy blocks, and it is
  why `lib/climate-instances.ts` now asks the preset list first
  (`lib/control-modules/stored.ts`).

  The rule is checked with `dashboard.controls.configured`, which the save route
  sets, NOT with "the preset list is not empty". The two differ on the one case
  that matters: deleting every preset is the owner asking for a card with nothing
  on it, and a length check would silently resurrect all five derived controls
  instead. Absent means never configured, which is the derivation.
- **The Devices tab shows the effective set either way**, and says so, with one
  action ("Save these as presets") that turns the derivation into real
  configuration. Nothing is written behind the owner's back by opening a page.

## Slots and the panels

A slot is a reference, never a copy: `{ id, surface, presetId, roomId, visible }`.
Editing a preset updates every slot showing it, deleting a preset takes its slots
with it, and a slot whose preset or module is gone renders **nothing** rather than
an empty control, because an empty control is a permanent hole on the card.

### Every panel holds slots (Adeline, 2026-09-25)

> every panel that isn't an existing modular control can default to a single
> modular slot, with the current content as a module inside of it, so no visible
> change, but still have the ability to reassign the content. e.g. the grid page
> will need its entire content layout in a single module slot that grows down.

- **The surfaces are the panels**: `quick-access`, `clock`, `reminders`, `zones`
  (the room menu), `zone-panel` (every zone's control panel) and `tasks`.
  `ControlSlotSurface` is the list, and the config schema reads it, so a slot
  can only name a panel the build has.
- **`panel-content` is the module a panel's own content is placed as.** It names
  the renderer of the same id, which draws the content the PANEL hands it rather
  than a device: the clock face, the room menu, the zone's controls, the metering,
  the task list. It has no fields, no variants and no behaviours — its whole job
  is to be something placeable.
- **The derivation places one per panel**, so a dashboard that has never been
  configured looks exactly as it did. `PANEL_SURFACES` in
  `lib/control-modules/panel-surfaces.ts` is the list, and each panel's preset is
  named for the panel ("Clock", "Zone controls").
- **No visible change is a DOM claim, not a slogan.** A panel whose only slot is
  its own content renders its children directly — no wrapper element, no grid, not
  one node of difference from the markup the panel had before slots existed
  (`app/components/dashboard/panel-slots/PanelSlots.tsx`), which is what it takes
  for a stylesheet full of child selectors to survive. The grid appears the moment
  something else is placed there — a second module, or a control instead of the
  content — and then it is the same grid Quick Access uses.
- **The panel keeps its own element and classes.** The grid renders inside the
  panel where the page can wrap it (the room menu, whose `+ .tasks-stage` sibling
  selector a wrapper would break) and around it where the page composes it (the
  clock, the task list, a zone's controls).
- **A panel with several slots is laid out by the same rule** — 2x2 for four,
  3x2 for five, one line where there is no room for two columns, and one column on
  a phone.
- **The Devices tab lists every panel's placements**, one group per panel, with
  its own slot list: reassign, reorder, or replace the panel's content. A panel's
  body is what the panel shows unless a CONTROL is placed beside it — the fallback
  the live dashboard taught us to keep (2026-09-25: a configuration saved before
  these surfaces existed has no slots for them at all, and reading that as "nothing
  is placed here" blanked every panel on the page). Its own content is a preset
  like any other: reassigning the slot moves the panel to whatever that preset
  draws, and the *panel* — its box, its chrome, its place in the layout — is not
  something a slot takes away.
- **A panel's content serves no room**, and a preset placed on a panel that
  inherits its room inherits the PANEL's: a zone's panel is that zone, every other
  panel is the Home zone — the same rule the card's slots have always used. Its
  own content preset's `roomId` is null and so is its slot's.
  - Without that, a lighting preset left on "Inherit the room it is placed in"
    resolved to no room at all on a panel, was dropped as unusable, and drew
    nothing while the Devices tab listed it as placed — found by the independent
    review of PR #51, and the same for a knob. The review is why the inheritance
    is a rule here rather than a claim.
- **Only a panel's OWN content may be placed on it.** Another panel's content
  draws that other panel's content, so the picker does not offer it and the host
  compares preset ids rather than "is a panel-content item": a foreign one placed
  by hand would otherwise pin this panel's content in place.
- **Known, and left**: a panel whose content has been taken off draws that content
  for the first paint of a load, until the client configuration arrives — "not
  configured yet" and "configured to nothing" are only distinguishable once one
  of them is known, and drawing nothing until then is the worse of the two
  (a blank clock on every load, and a blank panel for ever if the fetch fails).
- **Where the panels are drawn**: `app/components/dashboard/panel-slots/` holds
  the host, the item view, the grid style and the measurement, and
  `app/components/quick-access/dial-model.ts` + `quickSlotModel.ts` hold the model
  they share with the card — Quick Access was the first panel and those files are
  the ones the suite and the reviewers know.

A panel's slots are a GRID, not a stack of lines, and the slot's own order is its
position in it. A module's declared `region` (`dial-line`, `climate`, `readings`)
is the reading order it announces and no longer decides which row it lands on:
nothing falls back to a renderer's default any more, because there are no rows to
fall back to.

- **The arrangement is the panel's own while the panel has room for it**, and the
  rule is `app/components/dashboard/panelSlots.ts`
  (`balancedColumns`/`panelSlotGrid`): the balanced grid — 2x2 for four slots,
  3x2 for five — giving up a column at a time while a slot would come out
  narrower than the panel's own minimum, down to a single line along the panel's
  long axis.
- **Every slot on a panel is the same size**, whatever it draws, and the slots
  evenly subdivide the panel; a slot's content is centred across it and starts at
  its top, and scales up or down to fit it. A panel with one component is the 1x1
  case of the same rule (Adeline, 2026-09-25).
- So the card the demo ships — five modules — is three columns of two, and the
  four-module card is the 2x2 Adeline named. The worked example, with the
  numbers, is specs/quick-access-card.md, "The layout slots".

## The config page

### Devices → Controls & Devices

A **list of device types**, each with its own presets grouped beneath it
(`app/components/config/devices/`). Closed by default, opened on tap, and one
type opening does not close another: comparing two types is the reason the list
exists.

- The group header carries the module's name, its one-line summary, a right-hand
  count ("2 presets") and, for a driver, a `Driver` tag.
- Each preset is a **tappable row**: its name, what it drives ("Air Conditioner /
  Heater · Air conditioner on Gree Air Conditioner"), the room it serves, whether
  the dashboard is showing it, and either its first error or a "2 to finish" chip.
- Tapping opens the editor: name, HA room (including "Inherit the room it is
  placed in"), variant, driver, features, the driver's binding fields, the
  behaviours it links into, and its own problems.

The binding fields are pickers rather than typed ids wherever the house has an
entity to offer, and a list keeps its **order** as ordered chips: the temperature
sensor list's order is a safety property, so a control that re-sorted it would be
re-deciding which reading the thermostat trusts. The field itself is a PICKER over
the entities the registry reports, not a text box: a control is chosen from what
the house actually has rather than typed from memory.

A driver type lists the presets running on it as a **reverse index** — the same
rows, under the hardware they drive — so "what is the Gree unit actually
driving?" needs no opening of anything. The rows are the presets themselves, not
a copy of them: tapping one opens the same editor, and changing its driver moves
it between the two groups.

At the top, the **Quick Access** panel is the slot list: what the card shows, in
order, with up/down/remove. It is the other half of the same idea — a preset is a
device you configured, a slot is where the dashboard shows it.

### Modules

`app/components/config/modules/DeviceModules.tsx` lists every device module with
its layer, category and behaviour count, a **Download** for each, and an
**Install** for a package. Installed ones show as "installed here" and can be
removed; shipped ones cannot.

A package is one JSON document:

```json
{ "packageVersion": 1, "module": { "id": "…", "layer": "control", … } }
```

`module.fields` is a list of the binding fields' **ids** (`["switchEntityIds"]`),
not their definitions: the labels, the picker candidates and the editor treatment
belong to the product, so an uploaded device type cannot arrive with a
differently-behaving field. One function does that conversion in both directions —
`modulePackageDocument` in `lib/control-modules/library.ts` — because the first
version of this feature wrote the *resolved* module (fields as objects) into the
file while reading ids back, so every install wrote a package the next read
rejected and nothing could travel between dashboards at all.
`library.test.ts` round-trips a package through it rather than trusting the two
halves to agree.

It is validated against the shipped vocabulary before a byte is written
(`lib/control-modules/library.ts`): every behaviour id must exist, every declared
driver must exist — on the module AND on each of its features, where a feature may
also only gate on a variant that module declares — an installed module may not
claim a shipped module's id, no id may be empty, and a **control module must name
a renderer this build ships**.

That last limit is the honest boundary of this change, and it is a refusal rather
than a warning: a renderer is compiled into the dashboard, so a package cannot
bring its own drawing.

**The package format is strict; the config schema is not, on purpose.** Every
object a package is read through is `.strict()`, so a key this build does not know
is refused by name at install. `ControlsConfigSchema` keeps zod's default and drops
one instead, because the two documents fail in opposite directions: a package
carrying a setting the build cannot honour would render a control that silently
does nothing (and it can be re-uploaded), while an unknown key in the CONFIG is
usually an install that has been rolled back a version, and refusing the document
there would leave the dashboard unable to start over one stale field. A module that needs to carry real code is an installable
module (`specs/module-system.md`), which is why both live on the Modules tab under
their own headings.

A package carries the **definition only**. Presets stay behind: they name this
house's entity ids and rooms, and a module that travelled with them could not be
installed anywhere else.

## API

| Route | Does |
|---|---|
| `GET /api/control-modules` | The module registry, the effective presets and slots, the problems, the rooms and the entities the pickers may offer, and whether the set is derived. Re-reads the install directory, which is how an upload appears without a restart |
| `PUT /api/control-modules` | Writes `dashboard.controls` whole. A save carrying a STRUCTURAL problem (an unknown module, an unassigned driver, a duplicate id) is refused with 400 — nothing can render it. A save carrying a missing device field is accepted and the problems returned, so a half-built preset is not a reason to lose the other five |
| `POST /api/control-modules/packages` | Installs or upgrades a package |
| `GET /api/control-modules/packages/<id>` | Downloads a module as a package |
| `DELETE /api/control-modules/packages/<id>` | Removes an installed module |

`DashboardState` carries `controls` and `controlModules`, so the client resolves a
preset against the same registry the server used — installed packages included.

## What is not wired

Named here rather than discovered later:

- **No per-preset renderer code.** A control module names one of the four shipped
  renderers. Anything needing its own drawing needs the installable module system.
- **Every panel holds slots now** (Adeline, 2026-09-25, above), and the zone
  panels' own contents are still built by their own components rather than by a
  preset's feature switches: a room's Climate card reads the config directly, so a
  preset's FEATURE switches do not reach it. The panel hands its content over as a
  module, which is what makes the content reassignable — it is not a module that
  re-implements the control. The consequence worth knowing: a room's own Climate card still
  reads the config directly, so a preset's FEATURE switches do not reach it — the
  Lounge knob in its zone panel and the Lounge knob on this card can differ in
  which rings they show until the zone panels are modular too. The two agree on
  what they command, because both go through the same command hooks.
- **A package's feature switches are limited to the ids the shipped renderers
  read.** A renderer names its features literally, so a package can choose which
  of the SHIPPED features a device type offers — and gate them on drivers and
  variants — but a feature id this build has never heard of would install into a
  switch that does nothing. A new *kind* of feature is product code.

- **A binding field is chosen from the registry, not typed.** An entity that Home
  Assistant reports but that is absent from its entity registry — a template
  sensor with no `unique_id`, say — cannot be bound to a NEW preset from the
  Devices tab, though a preset that already carries it keeps it. The derived
  presets are unaffected: they read the config, not the registry.

- **A climate binding does not feed the dry-emulation target from the preset
  yet.** `binding.dryTargetHumidityPct` is stored and shown, and the server reads
  it from the derived instance; a preset edited after adoption carries its value
  into the instance, so the field is live, but the knob's Dry support itself is
  still computed from the unit's own reported modes.

## Done means

- A home with nothing stored gets the same five controls in the same three rows it had
  before, proven by `lib/control-modules/presets.test.ts` and the existing
  Quick Access layout specs.
- A device type's presets can be created, edited, placed, unplaced, reordered and
  deleted from Devices → Controls & Devices, and the dashboard follows.
- A lighting preset placed in a room controls that room; a preset naming a room
  keeps it wherever it is placed.
- A device module downloads as a package and installs on another dashboard, and
  a package naming an unknown behaviour, a shipped id or no renderer is refused by
  name.
- `lib/control-modules/*.test.ts` and
  `app/components/dashboard/quick-access/quickSlotModel.test.ts` pass, `tsc` is no
  worse than the base, and the layout specs still pass.
- A package round-trips: what an install writes is a package that installs again,
  with its binding fields travelling by id.
- A switch in the feature list changes what the control does, or is not offered:
  no feature is greyed out on one variant and resolved-on for it.
