# Lite Mode — checklist for adding features

The dashboard supports two per-device experience modes: **rich** (full
visuals) and **lite** (fast pathway for old tablets). Both are always
supported. SPEC.md §31 is the canonical description; §2 "Experience Mode
Parity" is the rule that makes this checklist mandatory: **a new visual,
animated, or computationally costly feature is not complete until its lite
behavior is decided, implemented, and tested.**

## Decide where your feature falls

1. **Pure CSS effect** (animation, transition, backdrop-filter)?
   → Free. The `html[data-nova-lite]` kill-switch in `app/globals.css`
   neutralises it automatically. Just eyeball the instant end state in lite:
   the animation completes immediately (0.01ms), so whatever your keyframes'
   final/fill state is, that's what lite users see. If the frozen end state
   looks wrong, add a targeted `html[data-nova-lite] …` override next to the
   existing ones.
   - Exception: if the animation is *functional feedback* (like a busy
     spinner), exempt it the way `.animate-spin` is exempted.

2. **JS-driven work** — requestAnimationFrame loops, canvas/WebGL, polling
   intervals, media playback/decode, or a heavy dynamic module load?
   → NOT auto-covered. Gate it explicitly:
   - If your feature is (or belongs to) one of the four toggleable heavy
     features, gate on that toggle: `const show =
     useExperienceFeature("statusOrb" | "background" | "camera" | "worldMap");`
     and don't mount the heavy subtree / don't start the loop when it's off.
     Prefer not mounting at all (see `Dashboard.tsx` background,
     `panel-registry.tsx` map, `OutsideControls.tsx` camera) so effects,
     pollers, and bundles never start. For a generic effect that should only
     run when the device wants the full works, use `const lite = useLiteMode();`
     (true only when all four features are off).
   - Outside React or in a first-tick race: read the resolved feature set with
     `readExperienceFeatures().statusOrb` (see the sync read in
     `NovaAvatar.tsx`), or `readExperienceModeSetting() === "lite"` for the
     all-off pathway.
   - If the feature is informational, give lite a cheap static stand-in
     (see `WorldMapPanel`'s "Map Offline" placeholder) rather than a hole in
     the UI.

3. **Large blur / glow via box-shadow?** The blanket rule does not kill
   box-shadow. If your glow is expensive, add a targeted
   `html[data-nova-lite]` flattening rule like the task-glow ones.

   Worked example, the reminder icon bar's overdue pulse: the animation is a
   plain `@keyframes` on `box-shadow`, so the kill-switch stops it dead and the
   tile simply sits at its first keyframe (no glow, still full opacity, still
   the alert colour). The glow is small enough not to need a flattening rule.
   Nothing else in that component needs a gate — the 1s tick and the task feed
   are shared with `TasksPanel`, so lite adds no timers and opens no streams.

Source of truth for the flag: `app/components/dashboard/experienceModeSetting.ts`
(localStorage `nova.dashboard.experienceMode.v1`; `data-nova-lite` on `<html>`
is seeded pre-paint by the `app/layout.tsx` head bootstrap).

## Then, before the change is done

- [ ] Add/extend a test asserting the lite branch (unit next to the component,
      and/or a case in `e2e/experience-mode.spec.ts`).
- [ ] Remember every e2e navigation via `gotoDashboard`/`gotoConfig` is seeded
      rich; use `seedExperienceMode(page, "lite")` to test the lite pathway.
- [ ] Update the "Lite behavior by feature" table in SPEC.md §31.
- [ ] Verify in the demo build too (§2 Demo Dashboard Parity — both modes must
      work there as well).
- [ ] `npm run test:unit` (includes `app/liteMode.contract.test.ts`, the
      tripwire for the kill-switch and bootstrap seed).
