# Wallpaper highlight colour, and per-application theme actions

Produced by plan `hashed-gliding-bentley`
(`~/.claude/plans/hashed-gliding-bentley.md`), 2026-08-25.

## Why

A theme change already fans out to several surfaces: the managed-desktop
wallpaper push, the Windows lock screen, the Pushcut notification a phone
listens for, and a best-effort Windows Terminal reload. None of them publishes
the theme's *colour*, and the Terminal touch only forces a repaint — it does
not change anything Terminal shows.

Two things follow from that:

1. An endpoint that publishes the dominant highlight colour of the current
   background image, so a client can ask "what colour is Nova right now?"
   without downloading and analysing the wallpaper itself.
2. When a Windows machine's theme changes, Windows Terminal's PowerShell
   profile gets its tab colour set to that colour.

The second is one instance of a general shape — *when the theme changes,
reconfigure application X on this machine*. Today the Terminal refresh is
hardcoded inline in `syncComputerWallpaper`; a second application added the
same way starts a pile. So the mechanism is a registry, and adding the next
application (VS Code, Plasma, Rider) is one new file plus one array entry.

## Extraction rule

The highlight is **the most vibrant accent**, not the largest colour cluster.
The largest cluster in a photograph is usually a sky, a wall, or a vignette —
dull, and useless as a tab colour.

`extractHighlightColor(data: Buffer)` in `lib/wallpaper-color.ts`:

1. `sharp(data).resize(WORK_EDGE, WORK_EDGE, { fit: "inside" }).removeAlpha().raw()`
   — `WORK_EDGE = 96`. Downscaling *is* the averaging step; no separate blur.
2. Convert each pixel to HSL.
3. **Exclusion gates.** A pixel is ignored unless all hold:
   - saturation `>= 0.20` — rejects greys and near-greys
   - lightness `>= 0.12` — rejects near-black
   - lightness `<= 0.88` — rejects near-white and blown highlights
4. **Bucket by hue** into `HUE_BUCKETS = 36` bins of 10°. Each bucket
   accumulates its pixel count and running sums of saturation and lightness.
5. **Score** each bucket as `count × meanSaturation`. Weighting by count alone
   picks the dull majority; by saturation alone picks a stray three-pixel
   speck. The product is the compromise, and it is the whole rule.
6. The winner's representative colour is
   `hsl(bucketMeanHue, bucketMeanSaturation, bucketMeanLightness)`. Mean hue is
   computed as a **circular mean** (mean of unit vectors), so a bucket
   straddling 0° does not average to cyan.

### Fallback

If no pixel survives the gates — a greyscale, pure-black or pure-white
wallpaper — extraction does not throw. It returns the mean lightness of the
image as an achromatic colour (`s = 0`) with `fallback: true` set on the
result. A grey tab on a grey wallpaper is the correct answer, and a caller that
wants to skip acting on a fallback can see that it did.

### Contrast clamp

`clampForContrast(color)` is separate and exported separately, because the
endpoint publishes both values and different consumers want different ones.

It preserves hue and saturation and pulls lightness into
`[MIN_LIGHTNESS, MAX_LIGHTNESS] = [0.30, 0.70]`. Outside that band a Windows
Terminal tab is either a black smear or washes out against the title bar. Hue
is never rotated and saturation is never boosted: an accurate muted colour is
better than an invented vivid one.

### Memoisation

Keyed on `${assetId}:${asset.updatedAt}`, in a module-level `Map` bounded to
`CACHE_LIMIT = 16` entries (oldest-inserted evicted first). Both the endpoint
and the sync path extract, and a wallpaper is a stable object — but the cache
must not pin 24 MB of decoded pixels, hence the bound and hence caching the
*result*, never the buffer.

## The endpoint

`GET /api/desktop/wallpapers/current/color`

Query: `?orientation=landscape|portrait`, default `portrait`, resolved exactly
the way `app/api/desktop/wallpapers/current/handler.ts` resolves it — portrait
falls back to the landscape asset when the theme has no portrait one. That
shared resolution is factored into one helper both routes call; it is not
duplicated.

On the tailnet: `http://nova.tuatara-dory.ts.net/api/desktop/wallpapers/current/color`

### Response

```json
{
  "assetId": "wallpaper_5f0c…",
  "contrast": { "hex": "#4E86B8", "hsl": { "h": 207, "l": 0.51, "s": 0.41 }, "rgb": { "b": 184, "g": 134, "r": 78 } },
  "fallback": false,
  "highlight": { "hex": "#2F5F87", "hsl": { "h": 207, "l": 0.36, "s": 0.48 }, "rgb": { "b": 135, "g": 95, "r": 47 } },
  "orientation": "portrait",
  "updatedAt": "2026-08-24T21:13:02.418Z",
  "variant": "dark"
}
```

`highlight` is the raw extraction; `contrast` is that colour after the clamp.
When the clamp changes nothing the two are equal.

Headers mirror the sibling image route so a client can branch without a second
request: `Cache-Control: no-store`, `X-Nova-Wallpaper-Id`,
`X-Nova-Wallpaper-Updated-At`, `X-Nova-Theme-Variant`.

Status codes: `200`; `404` when the current theme has no desktop wallpaper
(same message as the image route); `500` otherwise. No authentication — the
same LAN/tailnet assumption every sibling route under `app/api/desktop/` makes.

## The action registry

`lib/desktop-theme-actions.ts`.

```ts
export type ThemeActionContext = {
  assetId: string;
  computer: ManagedComputer;
  highlight: HighlightColor;   // already contrast-clamped
  remoteFileName: string;
  variant: ThemeVariant;
};

export type DesktopThemeAction = {
  id: string;                                  // stable; appears in the applied-state signature
  label: string;                               // human-readable, for logs
  platforms: ManagedComputerPlatform[];
  signature(context: ThemeActionContext): string;
  run(context: ThemeActionContext): Promise<void>;
};
```

- `desktopThemeActions` is the registry array. Each action is its own file
  under `lib/desktop-theme-actions/`.
- `runDesktopThemeActions(context)` filters by `computer.platform`, then runs
  each applicable action **inside its own try/catch that only `console.error`s.**
  This is the existing contract, stated at `lib/managed-computers.ts:515-532`
  and preserved verbatim: *an application that failed to repaint must never
  fail the wallpaper sync.* One action throwing must not prevent the next from
  running.
- `desktopThemeActionSignature(context)` concatenates `id:signature()` for
  every applicable action, sorted by id.

**Adding an application** is: write `lib/desktop-theme-actions/<id>.ts`
exporting a `DesktopThemeAction`, add it to the registry array, add its
identifying string to the sync test's mock. Nothing in
`managed-desktop-sync.ts` changes.

### Change detection

`AppliedWallpaperRecord` in `lib/managed-desktop-sync.ts` gains
`themeActionSignature: string | null`, parsed nullable-defaulting-to-`null` and
compared in `appliedWallpaperRecordMatches`. This mirrors `lockScreenFileName`
exactly, including its deliberate side effect: records written before this
change read back `null` and so force one re-push after deploy.

Without this field the actions would never re-fire on anything but an asset
change — and the colour is derived from the asset, so that would *mostly*
work, which is worse than not working. A changed clamp threshold, a new action,
or a changed action config all move the signature and correctly re-fire.

### No per-action toggle, yet

Actions self-gate on platform only. The Terminal refresh they replace had no
toggle either, and inventing a capability nobody asked for is scope. The
registry is shaped so `capabilities.themeApps: Record<actionId, boolean>` can
be layered into `runDesktopThemeActions` later without touching any action.

## Windows Terminal action (`id: "windows-terminal"`)

`lib/desktop-theme-actions/windows-terminal.ts`. Absorbs the whole of what
`remoteTerminalRefreshCommand` does today.

**Sets `tabColor` on the PowerShell profile only.** Not every profile, and no
generated colour scheme.

### Candidate settings paths

The three `remoteTerminalRefreshCommand` already probes, in order — stable,
preview, unpackaged:

```
%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json
%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json
%LOCALAPPDATA%\Microsoft\Windows Terminal\settings.json
```

The first that exists wins. If none exists the action is a no-op — Terminal is
not installed, which is not a failure.

### Mechanism — three SSH round trips

All three go through the existing `runManagedComputerSsh` +
`windowsPowerShellCommand` primitives. No new SSH plumbing.

1. **Read.** `Get-Content -Raw` on the winning path, emitted to stdout. The
   remote script handles "no file" itself and exits 0 with empty output,
   because `runManagedComputerSsh` rejects on *any* non-zero exit.
2. **Patch, in Node.** See below.
3. **Write back.** The new content is base64-encoded into the
   `-EncodedCommand` script, and PowerShell does
   `[IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($b64))` after
   taking a one-time backup.

Steps 2 and 3 are skipped when the patch is a no-op — the file already carries
the right `tabColor`. **A sync that changes nothing must not write the file**,
because writing it is what makes Terminal reload, and a spurious reload is a
visible flicker in every open window.

### Why not SFTP, and why not PowerShell JSON

`copyFileToManagedComputer` enforces
`/^nova-wallpaper-[a-z0-9_-]+\.(png|jpg|webp)$/` at
`lib/managed-computers.ts:398-402`. It cannot carry `settings.json`, and
loosening that guard to move one config file is the wrong trade.

Terminal's `settings.json` is **JSONC** — it ships with comments — and
PowerShell 5.1's `ConvertFrom-Json` cannot round-trip it: comments are a parse
error, and `ConvertTo-Json` would reorder keys and re-indent the whole file.
This is why the existing refresh deliberately never parses it. That rule
stands. The patch happens in Node, as text.

### Backup

Before the first write, if `settings.json.nova-backup` does not exist beside
the settings file, copy it there. Once only — the backup is the pre-Nova state,
not the previous state, and re-taking it every sync would destroy exactly the
thing it is for.

### Size guard

Refuse the whole action, with a logged reason, if the settings file exceeds
`MAX_SETTINGS_BYTES = 64 * 1024`. The base64 round trip rides inside a
`-EncodedCommand` argument (UTF-16LE, then base64: roughly 2.7× the byte
count), and the Windows command line caps at 32767 characters. 64 KB is far
inside a real settings file's size and far outside the danger zone; a file
bigger than that is not a Terminal config we recognise.

## JSONC profile patching

`lib/desktop-theme-actions/jsonc-profile-patch.ts`, pure and separately
testable.

`setPowerShellTabColor(source: string, hex: string): string | null` — returns
the patched text, or `null` when there is nothing to patch or nothing to
change.

It is a **surgical text edit**, not a parse-and-reserialise. Comments, key
order, indentation and every unrelated setting survive byte-for-byte; only the
`tabColor` value or a single inserted line differs.

1. A string- and comment-aware scanner walks the text, tracking depth and
   skipping over string literals (including `\"` escapes), `//` line comments
   and `/* */` block comments. Brace counting that does not skip these gets
   `{` inside a `commandline` string wrong, which is the classic way this goes
   badly.
2. Locate the `"profiles"` value, then its `"list"` array. `profiles` may
   itself *be* the array (the older schema) — handle both.
3. Enumerate the top-level objects of that array with their source spans.
4. **Select the PowerShell profile**, first match wins:
   1. `guid` = `{574e775e-4f2a-5b96-ac1e-a2962a402336}` (PowerShell 7)
   2. `source` = `Windows.Terminal.PowershellCore`
   3. `guid` = `{61c54bbd-c2c6-5271-96e7-009a87ff44bf}` (Windows PowerShell)
   4. `commandline` containing `pwsh.exe`, then `powershell.exe`
   5. `name` equal to `PowerShell`, then `Windows PowerShell`
   PowerShell 7 outranks Windows PowerShell throughout: a machine with both
   installed is a machine that uses 7.
   A profile with `"hidden": true` is never selected.
5. If the selected object already has a `tabColor`, replace only its string
   value. Otherwise insert `"tabColor": "#RRGGBB",` as a new first member,
   matching the indentation of the object's existing first member.
6. Return `null` when no profile matched, or when the existing value already
   equals `hex` (case-insensitively).

Hex is normalised to uppercase `#RRGGBB`. Terminal accepts `#RGB` and
`#RRGGBBAA`; we always emit the six-digit form.

### When no PowerShell profile is found

The action falls back to the **old behaviour** — rewriting the file's trailing
whitespace to force a reload — so a machine whose Terminal config we cannot
patch still behaves exactly as it did before this change. Nothing regresses.

## Done means

- `GET /api/desktop/wallpapers/current/color` returns a colour that visibly
  belongs to the current wallpaper, over both `nova.local` and
  `nova.tuatara-dory.ts.net`, for both orientations.
- A forced sync sets `tabColor` on Ununhexium's PowerShell profile to the
  clamped highlight, leaves `settings.json.nova-backup` beside it, and changes
  nothing else in the file (`diff` against the backup shows one line).
- Flipping the theme dark↔light moves the tab colour.
- A second sync with no theme change does **not** rewrite `settings.json`.
- A thrown action does not fail the wallpaper sync — covered by a unit test,
  not by breaking a real machine.
- Unit tests pass for extraction, the clamp, the JSONC patcher (including
  comments, an existing `tabColor`, braces inside strings, and no-PowerShell-
  profile), and the sync's action dispatch.
