// Windows-only remote commands: the lock screen image and the Terminal refresh.
import { assertSafeRemoteFileName, windowsPowerShellCommand } from "./remote-commands";
import type { ManagedComputerPlatform } from "./types";

// Where the lock screen image is staged. The sign-in screen is drawn by
// LogonUI as SYSTEM before any profile is loaded, so the file cannot stay in
// the user's home directory the desktop copy lives in.
const WINDOWS_LOCK_SCREEN_DIR = "C:\\ProgramData\\NovaManagedDesktop";

/**
 * Point the Windows lock screen - and therefore the sign-in screen behind it -
 * at the same image the desktop just received.
 *
 * PersonalizationCSP is the MDM-facing path and is the one that works on both
 * Pro and Home; the `Policies\...\Personalization\LockScreenImage` key it
 * superseded is Enterprise-only in practice. `DisableLogonBackgroundImage = 0`
 * is Windows' default, and is written explicitly so a machine that was ever
 * set the other way still shows the picture at sign-in rather than the flat
 * accent colour.
 *
 * Writing HKLM needs an administrator session, so the script checks its own
 * token first and reports that plainly instead of failing on the first
 * Set-ItemProperty.
 */
export function remoteLockScreenCommand(platform: ManagedComputerPlatform, fileName: string) {
  if (platform !== "windows") {
    throw new Error("Lock screen replacement is only supported on Windows");
  }
  assertSafeRemoteFileName(fileName);
  return windowsPowerShellCommand([
    "$ErrorActionPreference = 'Stop'",
    "$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())",
    "if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Lock screen replacement needs an administrator SSH session' }",
    `$source = Join-Path $HOME 'NovaManagedDesktop\\${fileName}'`,
    `$shared = '${WINDOWS_LOCK_SCREEN_DIR}'`,
    "New-Item -ItemType Directory -Force -Path $shared | Out-Null",
    `$target = Join-Path $shared '${fileName}'`,
    "Copy-Item -LiteralPath $source -Destination $target -Force",
    "$csp = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PersonalizationCSP'",
    "if (-not (Test-Path -LiteralPath $csp)) { New-Item -Path $csp -Force | Out-Null }",
    "Set-ItemProperty -LiteralPath $csp -Name LockScreenImagePath -Value $target",
    "Set-ItemProperty -LiteralPath $csp -Name LockScreenImageUrl -Value $target",
    "Set-ItemProperty -LiteralPath $csp -Name LockScreenImageStatus -Value 1 -Type DWord",
    "$system = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System'",
    "if (-not (Test-Path -LiteralPath $system)) { New-Item -Path $system -Force | Out-Null }",
    "Set-ItemProperty -LiteralPath $system -Name DisableLogonBackgroundImage -Value 0 -Type DWord",
    // Every theme change stages a new file name, so sweep the ones no longer
    // referenced rather than growing a folder of dead wallpapers.
    `Get-ChildItem -LiteralPath $shared -Filter 'nova-wallpaper-*' -File | Where-Object { $_.Name -ne '${fileName}' } | Remove-Item -Force -ErrorAction SilentlyContinue`,
  ].join("; "));
}

/**
 * Nudge Windows Terminal into re-reading its settings, so windows that are
 * already open pick the new theme up rather than waiting to be restarted.
 *
 * Terminal reloads on a write to its settings file, so the trick is to write
 * one without changing what the file says. Adeline's suggested form appended a
 * space each time; this rewrites the trailing whitespace instead, so the file
 * cannot grow without bound however many theme changes it sees.
 *
 * It deliberately does not parse the file first: Terminal's settings.json is
 * JSONC and legitimately contains `//` comments, which `ConvertFrom-Json`
 * rejects on Windows PowerShell. The sanity check is that the last
 * non-whitespace byte is `}`. Bytes are rewritten rather than text so the
 * file's encoding and any BOM survive untouched.
 *
 * Every failure is swallowed. A terminal that did not repaint must never fail
 * a wallpaper sync that worked.
 */
export function remoteTerminalRefreshCommand(platform: ManagedComputerPlatform) {
  if (platform !== "windows") {
    throw new Error("Terminal refresh is only supported on Windows");
  }
  return windowsPowerShellCommand([
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$paths = @((Join-Path $env:LOCALAPPDATA 'Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json'), (Join-Path $env:LOCALAPPDATA 'Packages\\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\\LocalState\\settings.json'), (Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows Terminal\\settings.json'))",
    "foreach ($p in $paths) { if (-not (Test-Path -LiteralPath $p)) { continue }; try { $bytes = [IO.File]::ReadAllBytes($p); $end = $bytes.Length; while ($end -gt 0 -and ($bytes[$end - 1] -eq 32 -or $bytes[$end - 1] -eq 9 -or $bytes[$end - 1] -eq 13 -or $bytes[$end - 1] -eq 10)) { $end-- }; if ($end -lt 2 -or $bytes[$end - 1] -ne 125) { continue }; $out = New-Object byte[] ($end + 1); [Array]::Copy($bytes, $out, $end); $out[$end] = 10; [IO.File]::WriteAllBytes($p, $out) } catch { } }",
  ].join("; "));
}
