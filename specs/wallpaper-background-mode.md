# Dashboard background: wallpaper mode

Plan: `peppy-churning-cook`

## What this is

A toggle in the "Background" config section that replaces the live WebGL
fluid shader (`FluidBackground.tsx`) with a static image drawn from the
existing desktop-wallpaper asset library (`theme.desktopWallpaper`), which
today is used only to push wallpapers to managed Windows computers. The two
already share one config accordion; this makes the dashboard itself able to
use the same uploaded images as its own background.

## Data model

`DesktopWallpaperSettings` (`app/components/accentColor.ts`):

```ts
export type DesktopWallpaperSettings = {
  ipadAssetId: string | null;
  landscapeAssetId: string | null;
  portraitAssetId: string | null;
  useAsDashboardBackground: boolean;
};
```

`normalizeDesktopWallpaperSettings` normalizes it as a strict boolean,
defaulting `false`:

```ts
export function normalizeDesktopWallpaperSettings(value: Partial<DesktopWallpaperSettings> | null | undefined): DesktopWallpaperSettings {
  return {
    ipadAssetId: normalizeWallpaperAssetId(value?.ipadAssetId),
    landscapeAssetId: normalizeWallpaperAssetId(value?.landscapeAssetId),
    portraitAssetId: normalizeWallpaperAssetId(value?.portraitAssetId),
    useAsDashboardBackground: value?.useAsDashboardBackground === true,
  };
}
```

`FluidBackgroundSettings` / `backgroundEffect` are untouched — shader
settings are preserved even while wallpaper mode is on, so switching back
doesn't lose tuning.

### iPad asset slot (added 2026-09-10)

A third upload slot, `ipadAssetId`, alongside landscape/portrait. It exists
purely for the `/api/desktop/wallpapers/current` endpoint — the dashboard's
own `WallpaperBackground` component still only ever resolves landscape or
portrait from the *window's own aspect ratio*, since the dashboard never runs
on the iPad's browser chrome. The iPad instead runs an iOS Shortcut that
fetches `GET /api/desktop/wallpapers/current?orientation=ipad` (also aliased
at `.../current/wallpaper.png?orientation=ipad`) directly, the same way the
phone Shortcut already fetches the portrait asset.

Resolution, in `lib/managed-desktop-sync/theme-model.ts` (`assetIdForOrientation`):

```
ipad orientation → wallpaper.ipadAssetId ?? wallpaper.landscapeAssetId
```

Same fallback-to-first-slot behavior portrait already has: if no iPad-specific
image was ever uploaded, the endpoint serves the landscape asset instead of
404ing. `ManagedComputerOrientation` (Windows/macOS/kde-linux managed-desktop
sync) stays `"landscape" | "portrait"` — the iPad is not a managed computer,
so a wider `WallpaperClientOrientation = ManagedComputerOrientation | "ipad"`
type covers only `currentDesktopWallpaperAssetId` and the API handler.

Settings UI: `DesktopWallpaperControl` (`app/components/AccentConfig.tsx`)
gets a third `row("ipadAssetId", "iPad", ...)`, upload/remove/download working
identically to the other two slots, sharing the same landscape-fallback
"landscape fallback" badge label as portrait when displaying the resolved
image.

## Orientation + asset resolution

Given `wallpaper: DesktopWallpaperSettings` and the current viewport:

```
landscape = window.innerWidth >= window.innerHeight
preferred = landscape ? wallpaper.landscapeAssetId : wallpaper.portraitAssetId
fallback  = landscape ? wallpaper.portraitAssetId : wallpaper.landscapeAssetId
assetId   = preferred ?? fallback   // null if neither is set
```

Re-evaluated on `resize` and `orientationchange`, matching the listener
pattern `FluidBackground.tsx` already uses for its own canvas resize. If
`assetId` is `null`, render nothing (no shader fallback — same "just don't
draw a background" behavior the dashboard already has today when
`showBackground`/`backgroundEnabled` is off).

## Scaling / positioning

CSS only, on the element carrying the image:

```css
background-size: cover;      /* uniform-fill, not stretched */
background-position: center;
background-repeat: no-repeat;
```

## New component — `app/components/WallpaperBackground.tsx`

```tsx
"use client";
import { useEffect, useState } from "react";
import type { DesktopWallpaperSettings } from "./accentColor";

function useIsLandscape() {
  const [landscape, setLandscape] = useState(true);
  useEffect(() => {
    const update = () => setLandscape(window.innerWidth >= window.innerHeight);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return landscape;
}

export function WallpaperBackground({ wallpaper }: { wallpaper: DesktopWallpaperSettings }) {
  const landscape = useIsLandscape();
  const assetId = (landscape ? wallpaper.landscapeAssetId : wallpaper.portraitAssetId)
    ?? (landscape ? wallpaper.portraitAssetId : wallpaper.landscapeAssetId);

  if (!assetId) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="dashboard-wallpaper-background"
      style={{ backgroundImage: `url(/api/desktop/wallpapers/${assetId})` }}
    />
  );
}
```

Uses the existing `GET /api/desktop/wallpapers/[id]` route directly — no new
API. No cache-busting query param is needed: `uploadWallpaperAsset` mints a
fresh `wallpaper_<uuid>` id per upload (see `lib/wallpaper-assets.ts`), so an
id never refers to changed bytes.

## Switch: shader vs wallpaper

Both call sites that currently render `FluidBackground` unconditionally
switch on the new flag. No extra component needed — this is a two-line
conditional at each of the two sites, since one takes `theme` (`Dashboard.tsx`)
and the other takes `context.previewTheme` (`ConfigPreviewBackground.tsx`)
already:

`app/components/Dashboard.tsx` (~line 99), replacing
`{showBackground ? <FluidBackground theme={theme} /> : null}`:

```tsx
{showBackground ? (
  theme.desktopWallpaper.useAsDashboardBackground
    ? <WallpaperBackground wallpaper={theme.desktopWallpaper} />
    : <FluidBackground theme={theme} />
) : null}
```

`app/components/ConfigPreviewBackground.tsx` (`ConfigPreviewBackground()`),
replacing `return <FluidBackground theme={context.previewTheme} />;`:

```tsx
return context.previewTheme.desktopWallpaper.useAsDashboardBackground
  ? <WallpaperBackground wallpaper={context.previewTheme.desktopWallpaper} />
  : <FluidBackground theme={context.previewTheme} />;
```

Both keep their existing gating (`showBackground` / `backgroundEnabled`)
untouched — wallpaper mode is a sub-choice of "background is on", not a
bypass of that toggle.

## CSS — `app/globals.css`

New rule near `.fluid-background` (~line 1296):

```css
.dashboard-wallpaper-background {
  position: fixed !important;
  inset: 0;
  z-index: 0 !important;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  background-color: var(--cyber-bg);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
```

Extend the existing z-index-lift selector (~line 1352) so page content still
renders above the wallpaper layer:

```css
.dashboard-shell > *:not(.fluid-background):not(.dashboard-wallpaper-background):not(.dashboard-config-link):not(.header-fade-strip):not(.header-mini-clock):not(.header-mini-date) {
  position: relative;
  z-index: 1;
}
```

## Settings UI — `app/components/AccentConfig.tsx`

Inside the "Background" `ConfigAccordion` (~line 2088-2105), add a
`CheckboxRow` above `DesktopWallpaperControl`, bound to
`theme.desktopWallpaper.useAsDashboardBackground`:

```tsx
<ConfigAccordion
  title="Background"
  icon={<ImageIcon className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
  className="config-sub-accordion"
  actions={sectionActions("background", "background")}
>
  <CheckboxRow
    checked={theme.desktopWallpaper.useAsDashboardBackground}
    label="Use Wallpaper as Background"
    detail={
      theme.desktopWallpaper.useAsDashboardBackground
        ? "The dashboard shows the wallpaper below instead of the fluid background"
        : "The dashboard shows the fluid background; wallpapers below are only pushed to managed computers"
    }
    onChange={(useAsDashboardBackground) =>
      setTheme({
        ...theme,
        desktopWallpaper: { ...theme.desktopWallpaper, useAsDashboardBackground },
      })
    }
  />
  <DesktopWallpaperControl
    value={theme.desktopWallpaper}
    onChange={(desktopWallpaper) => setTheme({ ...theme, desktopWallpaper })}
  />
  {theme.desktopWallpaper.useAsDashboardBackground ? null : (
    <BackgroundEffectControls
      accentColor={accentRgb}
      highlightColor={highlightRgb}
      value={theme.backgroundEffect}
      onChange={(backgroundEffect) => setTheme({ ...theme, backgroundEffect })}
      onPreview={(backgroundEffect) => setTheme({ ...theme, backgroundEffect }, { persist: false })}
    />
  )}
</ConfigAccordion>
```

`DesktopWallpaperControl` stays rendered either way so the upload/remove UI
for landscape/portrait assets remains reachable while wallpaper mode is on.

## What "done" looks like

- Toggling the checkbox in `/config` swaps the live preview between shader
  and wallpaper instantly (no reload), and the choice persists with the rest
  of the theme.
- With wallpaper mode on and only one orientation asset uploaded, both
  window orientations show that asset, cover-scaled and centered — never a
  blank background as long as at least one asset exists.
- With wallpaper mode on and neither asset uploaded, background renders
  nothing (matches the existing "background off" visual, not a broken
  image).
- With wallpaper mode off, rendering is unchanged from before this feature —
  same shader, same `showBackground` gating, `BackgroundEffectControls`
  visible.
- `BackgroundEffectControls` (the shader sliders) are hidden, not merely
  disabled, while wallpaper mode is on.

## Test coverage

- `ConfigPreviewBackground.test.tsx`: add a case asserting the preview
  renders `WallpaperBackground` (not `FluidBackground`) when
  `previewTheme.desktopWallpaper.useAsDashboardBackground` is true, and the
  reverse when false — matching the existing test's style of asserting on
  rendered output for the current `FluidBackground`-only behavior.
- Unit test for `WallpaperBackground`'s orientation/fallback resolution
  (landscape asset only + portrait viewport → still renders that asset;
  neither asset → renders null) rather than an e2e addition, since
  `e2e/experience-mode.spec.ts`'s `.fluid-background` count assertions have
  no existing fixture that uploads wallpaper assets and adding one is out of
  scope for this feature — the unit test covers the same logic more cheaply.
