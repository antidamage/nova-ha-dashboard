import type { DesktopThemeAction, ThemeActionContext } from "../desktop-theme-actions";
import { runManagedComputerSsh, windowsPowerShellCommand } from "../managed-computers";
import { patchPowerShellTabColor, type TabColorEdit } from "./jsonc-profile-patch";

/**
 * Windows Terminal follows the theme: the PowerShell profile's tab takes the
 * wallpaper's dominant highlight colour.
 *
 * This absorbs what `remoteTerminalRefreshCommand` used to do. Writing the
 * settings file *is* what makes Terminal reload, so setting the colour and
 * triggering the repaint are the same act - and a sync that would change
 * nothing must not write at all, because a spurious reload is a visible
 * flicker in every open window.
 *
 * See `specs/desktop-theme-app-actions.md`.
 */

// Stable, Preview, unpackaged - whichever exists, in that order.
const SETTINGS_PATHS = [
  "(Join-Path $env:LOCALAPPDATA 'Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json')",
  "(Join-Path $env:LOCALAPPDATA 'Packages\\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\\LocalState\\settings.json')",
  "(Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows Terminal\\settings.json')",
];

const PATHS_EXPRESSION = `@(${SETTINGS_PATHS.join(", ")})`;

// A plausibility cap on the file we are willing to touch. Nothing to do with
// the command line - the write ships only the splice, so its size does not
// depend on the file's - but a "settings.json" past this is not a Terminal
// config we recognise and is not worth editing blind.
const MAX_SETTINGS_BYTES = 64 * 1024;

const NOT_FOUND = "NOVA-NO-SETTINGS";

/**
 * Read the first settings file that exists.
 *
 * The remote script has to handle "no file" itself and still exit 0:
 * `runManagedComputerSsh` rejects on any non-zero exit, and Terminal simply
 * not being installed is not a failure.
 */
async function readSettings(context: ThemeActionContext) {
  const { stdout } = await runManagedComputerSsh(
    context.computer,
    windowsPowerShellCommand([
      "$ErrorActionPreference = 'SilentlyContinue'",
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
      `foreach ($p in ${PATHS_EXPRESSION}) { if (Test-Path -LiteralPath $p) { Write-Output $p; Write-Output '---'; Write-Output ([IO.File]::ReadAllText($p)); exit 0 } }`,
      `Write-Output '${NOT_FOUND}'`,
    ].join("; ")),
  );

  // Windows emits CRLF, so the separator has to tolerate both endings - and
  // the file's own content may use either, which is why only the first
  // separator is honoured.
  const separator = /\r?\n---\r?\n/.exec(stdout);
  if (!separator || stdout.startsWith(NOT_FOUND)) {
    return null;
  }
  return {
    // PowerShell's Write-Output appends a newline the file did not have.
    content: stdout.slice(separator.index + separator[0].length).replace(/\r?\n$/, ""),
    path: stdout.slice(0, separator.index).trim(),
  };
}

/**
 * Apply the splice on the remote machine.
 *
 * **Only the edit is sent, never the file.** The command runs through cmd.exe,
 * whose command line caps at 8191 characters; a 5KB settings.json base64'd
 * into a `-EncodedCommand` argument is around 20,000 and fails with "The
 * command line is too long". The splice is a few dozen characters however
 * large the file is.
 *
 * SFTP is not the alternative: `copyFileToManagedComputer` enforces a
 * `nova-wallpaper-*.{png,jpg,webp}` name guard, and loosening that guard to
 * move one config file is the wrong trade.
 *
 * The offsets are into the decoded text, so the remote side splices text and
 * not bytes - a BOM would otherwise shift every offset by three. The original
 * length is checked first, so an edit computed against a file that has since
 * changed is refused rather than applied at the wrong place.
 *
 * The backup is taken once and once only. It is the pre-Nova state, not the
 * previous state - re-taking it every sync would destroy the thing it is for.
 */
async function applyEdit(context: ThemeActionContext, path: string, original: string, edit: TabColorEdit) {
  const inserted = Buffer.from(edit.text, "utf8").toString("base64");
  await runManagedComputerSsh(
    context.computer,
    windowsPowerShellCommand([
      "$ErrorActionPreference = 'Stop'",
      `$path = ${JSON.stringify(path)}`,
      "$bytes = [IO.File]::ReadAllBytes($path)",
      // Preserve whether the file had a BOM; Terminal has shipped it both ways.
      "$bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)",
      "$text = [IO.File]::ReadAllText($path)",
      `if ($text.Length -ne ${original.length}) { throw 'settings.json changed since it was read' }`,
      "$backup = $path + '.nova-backup'",
      "if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $path -Destination $backup }",
      `$insert = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${inserted}'))`,
      `$next = $text.Substring(0, ${edit.offset}) + $insert + $text.Substring(${edit.offset + edit.length})`,
      "[IO.File]::WriteAllText($path, $next, (New-Object Text.UTF8Encoding($bom)))",
    ].join("; ")),
  );
}

/**
 * The pre-existing behaviour, kept as the path for a machine whose Terminal
 * config we cannot patch: rewrite the trailing whitespace so the file watcher
 * fires. Bytes rather than text, so encoding and any BOM survive, and a
 * rewrite rather than an append, so the file cannot grow without bound across
 * theme changes. The sanity check is that the last non-whitespace byte is `}`.
 */
async function nudgeReload(context: ThemeActionContext) {
  await runManagedComputerSsh(
    context.computer,
    windowsPowerShellCommand([
      "$ErrorActionPreference = 'SilentlyContinue'",
      `foreach ($p in ${PATHS_EXPRESSION}) { if (-not (Test-Path -LiteralPath $p)) { continue }; try { $bytes = [IO.File]::ReadAllBytes($p); $end = $bytes.Length; while ($end -gt 0 -and ($bytes[$end - 1] -eq 32 -or $bytes[$end - 1] -eq 9 -or $bytes[$end - 1] -eq 13 -or $bytes[$end - 1] -eq 10)) { $end-- }; if ($end -lt 2 -or $bytes[$end - 1] -ne 125) { continue }; $out = New-Object byte[] ($end + 1); [Array]::Copy($bytes, $out, $end); $out[$end] = 10; [IO.File]::WriteAllBytes($p, $out) } catch { } }`,
    ].join("; ")),
  );
}

export const windowsTerminalAction: DesktopThemeAction = {
  id: "windows-terminal",
  label: "Windows Terminal",
  platforms: ["windows"],

  signature(context) {
    return context.highlight.hex;
  },

  async run(context) {
    const settings = await readSettings(context);
    if (!settings) {
      // Terminal is not installed. Not a failure.
      return;
    }
    if (Buffer.byteLength(settings.content, "utf8") > MAX_SETTINGS_BYTES) {
      console.error(
        "[managed-desktop] windows-terminal: settings.json is larger than expected, refusing to rewrite",
        context.computer.id,
        settings.path,
      );
      return;
    }

    const patch = patchPowerShellTabColor(settings.content, context.highlight.hex);
    if (patch.kind === "unchanged") {
      // The colour is already right. Writing would reload every open window
      // for nothing.
      return;
    }
    if (patch.kind === "no-profile") {
      // Nothing here we can patch, so fall back to the older behaviour and at
      // least make Terminal re-read the theme.
      await nudgeReload(context);
      return;
    }

    await applyEdit(context, settings.path, settings.content, patch.edit);
  },
};
