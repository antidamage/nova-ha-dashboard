# Nova web dashboard — custom UX component inventory

The reuse rule itself lives in the repo-root `AGENTS.md` under "UI
implementation conventions": when a surface already has a custom component for
a control, find and reuse it rather than dropping to a raw `<input>`, an
unstyled `<button>`, or a platform default. This file is the inventory for that
rule on this surface.

Keep it current when adding, renaming, or retiring reusable controls. Search
the named component before introducing a one-off equivalent.

- `DotLineControl` and `DotSpectrumControl` —
  `app/components/DotControls.tsx`. `DotLineControl` is Nova's custom
  magnitude/step slider, used by `SliderControlPanel` and camera/climate
  settings. `DotSpectrumControl` no longer has a colour-picking caller on the
  Nova Classic surface — colour is `ColorEncoder`'s job.
  `DotLineControl` eases its thumb toward incoming values by default; pass
  `snapRemote` for a control whose displayed number must always be a real value
  rather than a frame of that animation.
- `DotRangeControl` — `app/components/DotControls.tsx`. This is Nova's
  two-thumb, touch-sized minimum/maximum range control. Use it through
  `RangeSliderControlPanel` for driven visualiser parameters and future bounded
  configuration ranges.
- `DotEnvelopeControl` — `app/components/DotControls.tsx`. This is Nova's
  three-thumb attack/hold/release timeline. Its thumb widths are excluded from
  measurement, allowing adjacent thumbs to represent zero-duration hold or
  release phases.
- `useNumericEntry` / `NumericEntryPopover` — `app/components/NumericEntryPopover.tsx`.
  The small portalled field a slider tap opens, so an exact value can be typed
  rather than dragged for. `DotLineControl`, `DotRangeControl` and
  `DotEnvelopeControl` all wire it through the tap-versus-drag helper in
  `app/components/sliderTapGesture.ts`; a control opts out with
  `numericEntry={false}` rather than being special-cased. This is the surface's
  only shared numeric input — reuse it instead of adding a raw `type="number"`,
  and note that the press it depends on no longer moves the value on its own.
- `ConfigSelect` — `app/components/ConfigSelect.tsx`. This is the generic
  portalled cyber-listbox for configuration choices; use it instead of a native
  `<select>` when a specialised library or font picker is not required. Options
  may carry an optional `group`, which emits a heading the first time each group
  appears — use it for long lists (the status-orb module picker) rather than
  building a second grouped picker. Lists that set no `group` render exactly as
  before.
- `SliderControlPanel` — `app/components/ConfigControls.tsx`. This is the
  standard configuration-page slider wrapper, with separate preview and commit
  boundaries. It
  is used throughout `AccentConfig`, `AgentConfig`, `PhonoscopeConfig`,
  `VoiceConfig`, `FontControl`, climate configuration, and hardware
  configuration.
- `RangeSliderControlPanel` — `app/components/ConfigControls.tsx`. This is the
  standard configuration wrapper for `DotRangeControl`, preserving separate
  preview and commit boundaries plus explicit minimum/maximum readouts. Passing
  `onRandomChange` adds the optional `RND` tag — a compact checkbox under a 9px
  `rect-envelope-tag` label, the same tag family the envelope thumbs use — for
  ranges whose target may be drawn at random. Reuse it rather than adding a
  second randomise affordance.
- `EnvelopeSliderControlPanel` — `app/components/ConfigControls.tsx`. This wraps
  `DotEnvelopeControl` with standard preview/commit behavior and per-phase
  duration readouts.
- `CheckboxRow` — `app/components/ConfigControls.tsx`. This is the standard
  styled configuration checkbox/toggle row used by appearance, reminders, and
  voice input-device settings.
- `ConfigAccordion` — `app/components/ConfigControls.tsx`. This is the
  persistent, exclusive, auto-scrolling configuration section used across the
  config workspace.
- `ColorEncoder` — `app/components/ColorEncoder.tsx`. Nova's rotary colour
  control and the surface's **only** colour picker: tap cycles hue /
  brightness / saturation (plus opacity when `channels` includes it), drag
  right or up turns it up. The active channel is named under the lights
  (`HUE`/`BRIGHT`/`SAT`/`OPAC`); `defaultChannel` picks which light is lit on
  load — lighting opens on brightness, pickers on hue. Scaled by one `size` prop, 50–200px. Use
  `ColorEncoderPanel` (`app/components/ConfigControls.tsx`) over a stored
  `ThemeColorValue` in config; `ZoneColorEncoder` in `dashboard/ZoneControls.tsx`
  is the lighting-card wrapper. HSVA maths and the lossless `ThemeColorValue`
  adapters are in `app/components/colorEncoderModel.ts`. See
  `specs/color-encoder.md`. The old `ColorSpectrum`, `ColorIntensitySlider` and
  `ConfigColorPicker` are gone — do not reintroduce a spectrum pad.
- `RingedColorEncoder` — `app/components/RingedColorEncoder.tsx`. A copy of
  `ColorEncoder` (not a wrapper; its `.ringed-encoder*` CSS is copied too, so
  the two evolve independently) that carries up to five slider rings: 270°
  arcs round the colour ring, thumbs that bend with the track, labels curved
  through the bottom gap. Its label sits on the knob above the lights, and it
  clicks on press and on a release that changed something — never mid-drag.
  Geometry maths is in `ringedColorEncoderGeometry.ts`; demo at
  `/color-encoder-rings`. See `specs/color-encoder-rings.md`. Use it where a
  colour slot carries its own sliders instead of stacking separate sliders
  under a `ColorEncoder`.
- `ColorWidget` — `app/components/ConfigControls.tsx`. This is one colour slot
  on the config page: an inline cell holding a `ColorEncoder` and any
  slot-specific extras, plus the copy/paste colour actions. It is deliberately
  **not** a swatch card and **not** a modal — the dial replaced both
  (`specs/color-encoder.md`, "The config surface"). Do not reintroduce a
  popover to edit a colour.
- `MomentaryFeedbackButton` — `app/components/MomentaryFeedbackButton.tsx`. This
  supplies Nova's pressed/feedback behavior and is used by custom checkbox rows,
  climate controls, library actions, system controls, and icon buttons.
- `ModalOverlay` — `app/components/ModalOverlay.tsx`. This is the accessible
  modal/popover surface used by colour editors, reminder icon selection, and
  system confirmation flows.
- `ConfirmDialog` — `app/components/ConfirmDialog.tsx`. This is the dashboard's
  one- or two-stage "are you sure" dialog, built on `ModalOverlay`. It is used by
  System Power, the desktop sleep/wake panel, and the module system's confirm
  interceptor. Pass `stages` with one entry for a plain confirm or two for a
  last-chance flow; the dialog owns the stage advance. Reuse it rather than
  hand-rolling a `system-confirm-*` card — that duplication is exactly what it
  was extracted to end.
- `ControlCard` — `app/components/dashboard/ControlCard.tsx`. This is the generic
  control-card wrapper (kicker, title, state pill, "Entity missing" body),
  formerly private to `ClimateControls`. Every card passes a stable `cardId`
  because module slots target cards by it.
- `CameraEventReport`, `CameraAnalysisConfig`, and `VehicleReferenceEditor` —
  the Outside-camera activity review, visual polygon editor, and photo-region
  vehicle reference editor. These use the shared `ModalOverlay`; scene and
  reference geometry stays normalized to the source frame and is edited
  visually rather than as raw coordinate fields.
- `QuickAccessCard` and its segments (`QuickLightsSegment`,
  `QuickAirconSegment`, `QuickHeaterSegment`, `QuickWeatherSegment`) —
  `app/components/dashboard/QuickAccessCard.tsx`. The one-line card above the
  zone menu; props only, so a surface can mount it or any one segment. See
  `specs/quick-access-card.md`.
- `useAirconCommands` / `useBedroomHeaterCommands` —
  `app/components/dashboard/climateCommands.ts`. The only home of the aircon's
  power-intent hold, Auto arming and debounced setpoint, and the heater's
  server-truth saves. Any new climate control calls these; never copy them.
- `useZoneLighting` — `app/components/dashboard/useZoneLighting.ts`. A zone's
  displayed brightness/colour bound to the server plus its preset and colour
  commands. Pair it with the exported `ZoneColorEncoder`
  (`ZoneControls.tsx`, `size` 50–200) for a zone colour dial anywhere.
- `IconButton` — `app/components/dashboard/IconButton.tsx`. This is the
  dashboard's themed icon action used by zone lighting controls.
- `LabeledSwitch` — `app/components/dashboard/ClimateControls.tsx`. This is the
  dashboard's styled switch used by climate and outside controls.
- `FontSelect` — `app/components/FontControl.tsx`. This is the custom font
  selector used by theme typography settings.
- `ReminderIconPicker` — `app/components/reminders/ReminderIconPicker.tsx`. This
  is the searchable/custom reminder glyph picker used by reminder configuration.
- `DriverRow`, `DriverStack`, `EffectEntry`, `AddEffectControl`,
  `SettingsGroupCard`, `ColorGroupEditor`, `ColorThemeLibrary`,
  `HousePartySection`, and `ControlSettingsPanel` —
  `app/components/phonoscope/`. These are the Visualiser controls panel: a
  driver row with its cadence select (subdivisions through multiples, one list)
  and its `from` select, the primary-plus-inset-modifier
  driver stack, a collapsible effect binding with its sparse `+ Add parameter`
  menu, and the settings-group / colour-theme / colour-group libraries that
  compose them. Reuse them for anything else that binds a value to a music
  driver rather than building a second driver editor. Shared labelling
  (`driverLabel`, `laneLabel`, `effectCatalogue`) lives in
  `app/components/phonoscope/effectCatalogue.ts`.
- `useEditLock` — `app/components/phonoscope/editing-lock.tsx`. This is the
  Visualiser panel's poll/echo lock for text fields: a focused name field holds
  it, and while it is held the panel refuses to replace its state from the
  server. Spread `onFocus`/`onBlur` onto any new text input in that panel —
  without it, a save's reply rewrites the field mid-rename.
- `DesignSelectControl` — `app/components/DesignSelectControl.tsx`. This is the
  presentation-layer (Design) picker on the config page. It is deliberately the
  same portalled cyber-listbox as `ThemeLibraryControl` — same trigger, menu and
  swatch classes — because a design and a colour theme are sibling choices and
  must not read as two different kinds of control. It has no save/rename/
  duplicate/delete row: designs come from the registry in `app/design/registry.ts`,
  not from a user-editable library. See `specs/design-modules.md`.
- `ThemeLibraryControl` and `VoicePersonalityLibraryControl` —
  `app/components/ThemeLibraryControl.tsx` and
  `app/components/VoicePersonalityLibraryControl.tsx`. These are the established
  save/load/rename/delete library interactions for themes and voice
  personalities.
