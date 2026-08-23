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
  `DotLineControl` eases its thumb toward incoming values by default; pass
  `snapRemote` for a control whose displayed number must always be a real value
  rather than a frame of that animation (zone intensity does).
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
- `SliderControlPanel`, `ColorSpectrum`, and `ColorIntensitySlider` —
  `app/components/ConfigControls.tsx`. These are the standard configuration-page
  slider and colour wrappers, with separate preview and commit boundaries. They
  are used throughout `AccentConfig`, `AgentConfig`, `PhonoscopeConfig`,
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
- `CameraEventReport`, `CameraAnalysisConfig`, and `VehicleReferenceEditor` —
  the Outside-camera activity review, visual polygon editor, and photo-region
  vehicle reference editor. These use the shared `ModalOverlay`; scene and
  reference geometry stays normalized to the source frame and is edited
  visually rather than as raw coordinate fields.
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
- `ThemeLibraryControl` and `VoicePersonalityLibraryControl` —
  `app/components/ThemeLibraryControl.tsx` and
  `app/components/VoicePersonalityLibraryControl.tsx`. These are the established
  save/load/rename/delete library interactions for themes and voice
  personalities.
