# Nova web dashboard — custom UX component inventory

The reuse rule itself lives in the repo-root `AGENTS.md` under "UI
implementation conventions": when a surface already has a custom component for
a control, find and reuse it rather than dropping to a raw `<input>`, an
unstyled `<button>`, or a platform default. This file is the inventory for that
rule on this surface.

Keep it current when adding, renaming, or retiring reusable controls. Search
the named component before introducing a one-off equivalent.

- `DotLineControl` and `DotSpectrumControl` —
  `app/components/DotControls.tsx`. These are Nova's custom magnitude/step
  slider and colour-spectrum controls. They are used by `SliderControlPanel`,
  camera/climate settings, and zone brightness/colour controls.
- `DotRangeControl` — `app/components/DotControls.tsx`. This is Nova's
  two-thumb, touch-sized minimum/maximum range control. Use it through
  `RangeSliderControlPanel` for driven visualiser parameters and future bounded
  configuration ranges.
- `DotEnvelopeControl` — `app/components/DotControls.tsx`. This is Nova's
  three-thumb attack/hold/release timeline. Its thumb widths are excluded from
  measurement, allowing adjacent thumbs to represent zero-duration hold or
  release phases.
- `ConfigSelect` — `app/components/ConfigSelect.tsx`. This is the generic
  portalled cyber-listbox for configuration choices; use it instead of a native
  `<select>` when a specialised library or font picker is not required.
- `SliderControlPanel`, `ColorSpectrum`, and `ColorIntensitySlider` —
  `app/components/ConfigControls.tsx`. These are the standard configuration-page
  slider and colour wrappers, with separate preview and commit boundaries. They
  are used throughout `AccentConfig`, `AgentConfig`, `PhonoscopeConfig`,
  `VoiceConfig`, `FontControl`, climate configuration, and hardware
  configuration.
- `RangeSliderControlPanel` — `app/components/ConfigControls.tsx`. This is the
  standard configuration wrapper for `DotRangeControl`, preserving separate
  preview and commit boundaries plus explicit minimum/maximum readouts.
- `EnvelopeSliderControlPanel` — `app/components/ConfigControls.tsx`. This wraps
  `DotEnvelopeControl` with standard preview/commit behavior and per-phase
  duration readouts.
- `ConfigColorPicker` — `app/components/ConfigColorPicker.tsx`. This is the
  configuration colour picker used by `ColorSpectrum`.
- `CheckboxRow` — `app/components/ConfigControls.tsx`. This is the standard
  styled configuration checkbox/toggle row used by appearance, reminders, and
  voice input-device settings.
- `ConfigAccordion` — `app/components/ConfigControls.tsx`. This is the
  persistent, exclusive, auto-scrolling configuration section used across the
  config workspace.
- `ColorWidget` — `app/components/ConfigControls.tsx`. This is the standard
  colour swatch/editor popover used by theme and Nova-avatar configuration.
- `MomentaryFeedbackButton` — `app/components/MomentaryFeedbackButton.tsx`. This
  supplies Nova's pressed/feedback behavior and is used by custom checkbox rows,
  climate controls, library actions, system controls, and icon buttons.
- `ModalOverlay` — `app/components/ModalOverlay.tsx`. This is the accessible
  modal/popover surface used by colour editors, reminder icon selection, and
  system confirmation flows.
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
- `ThemeLibraryControl` and `VoicePersonalityLibraryControl` —
  `app/components/ThemeLibraryControl.tsx` and
  `app/components/VoicePersonalityLibraryControl.tsx`. These are the established
  save/load/rename/delete library interactions for themes and voice
  personalities.
