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

// Stable, Preview, unpackaged.
//
// **Every one of these that exists is patched, not the first.** Both stable
// and Preview are routinely installed side by side, and the one a person
// actually runs is not the one that sorts first - taking the first match wrote
// to a file nothing was reading, and the feature appeared to do nothing at all.
// Each file is that Terminal's own config; there is no reason to prefer one.
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

const FILE_MARKER = "NOVA-FILE";

type SettingsFile = { bom: boolean; content: string; path: string };

/**
 * Read every settings file that exists.
 *
 * Both the path and the bytes come back base64-encoded, one file per line.
 * That is deliberate: a Windows path contains spaces, PowerShell emits CRLF
 * while the file's own line endings may be anything, and a delimiter in the
 * file's text would otherwise be able to derail parsing. Base64 has none of
 * those failure modes.
 *
 * The remote script handles "no file" itself and still exits 0, because
 * `runManagedComputerSsh` rejects on any non-zero exit and Terminal simply not
 * being installed is not a failure.
 */
async function readSettingsFiles(context: ThemeActionContext): Promise<SettingsFile[]> {
  const { stdout } = await runManagedComputerSsh(
    context.computer,
    windowsPowerShellCommand([
      "$ErrorActionPreference = 'SilentlyContinue'",
      `foreach ($p in ${PATHS_EXPRESSION}) { if (Test-Path -LiteralPath $p) { $b = [IO.File]::ReadAllBytes($p); Write-Output ('${FILE_MARKER} ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p)) + ' ' + [Convert]::ToBase64String($b)) } }`,
    ].join("; ")),
  );

  const files: SettingsFile[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(" ");
    if (parts.length !== 3 || parts[0] !== FILE_MARKER) {
      continue;
    }
    const bytes = Buffer.from(parts[2], "base64");
    // Terminal has shipped this file both with and without a BOM. Strip it
    // here so offsets match what `ReadAllText` will see on the far side, and
    // remember it so the write can put it back.
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    files.push({
      bom,
      content: bytes.subarray(bom ? 3 : 0).toString("utf8"),
      path: Buffer.from(parts[1], "base64").toString("utf8"),
    });
  }
  return files;
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
async function applyEdit(context: ThemeActionContext, file: SettingsFile, edit: TabColorEdit) {
  const inserted = Buffer.from(edit.text, "utf8").toString("base64");
  await runManagedComputerSsh(
    context.computer,
    windowsPowerShellCommand([
      "$ErrorActionPreference = 'Stop'",
      `$path = ${JSON.stringify(file.path)}`,
      "$text = [IO.File]::ReadAllText($path)",
      `if ($text.Length -ne ${file.content.length}) { throw 'settings.json changed since it was read' }`,
      "$backup = $path + '.nova-backup'",
      "if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $path -Destination $backup }",
      `$insert = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${inserted}'))`,
      `$next = $text.Substring(0, ${edit.offset}) + $insert + $text.Substring(${edit.offset + edit.length})`,
      `[IO.File]::WriteAllText($path, $next, (New-Object Text.UTF8Encoding($${file.bom ? "true" : "false"})))`,
    ].join("; ")),
  );
}

/**
 * The pre-existing behaviour, kept as the path for a file whose PowerShell
 * profile we cannot find: rewrite the trailing whitespace so the watcher
 * fires. Bytes rather than text, so encoding and any BOM survive, and a
 * rewrite rather than an append, so the file cannot grow without bound across
 * theme changes. The sanity check is that the last non-whitespace byte is `}`.
 */
async function nudgeReload(context: ThemeActionContext, path: string) {
  await runManagedComputerSsh(
    context.computer,
    windowsPowerShellCommand([
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$p = ${JSON.stringify(path)}`,
      "try { $bytes = [IO.File]::ReadAllBytes($p); $end = $bytes.Length; while ($end -gt 0 -and ($bytes[$end - 1] -eq 32 -or $bytes[$end - 1] -eq 9 -or $bytes[$end - 1] -eq 13 -or $bytes[$end - 1] -eq 10)) { $end-- }; if ($end -lt 2 -or $bytes[$end - 1] -ne 125) { return }; $out = New-Object byte[] ($end + 1); [Array]::Copy($bytes, $out, $end); $out[$end] = 10; [IO.File]::WriteAllBytes($p, $out) } catch { }",
    ].join("; ")),
  );
}

async function applyToFile(context: ThemeActionContext, file: SettingsFile) {
  if (Buffer.byteLength(file.content, "utf8") > MAX_SETTINGS_BYTES) {
    console.error(
      "[managed-desktop] windows-terminal: settings.json is larger than expected, refusing to rewrite",
      context.computer.id,
      file.path,
    );
    return;
  }

  const patch = patchPowerShellTabColor(file.content, context.highlight.hex);
  if (patch.kind === "unchanged") {
    // The colour is already right. Writing would reload every open window for
    // nothing.
    return;
  }
  if (patch.kind === "no-profile") {
    // Nothing here we can patch, so fall back to the older behaviour and at
    // least make Terminal re-read the theme.
    await nudgeReload(context, file.path);
    return;
  }

  await applyEdit(context, file, patch.edit);
}

export const windowsTerminalAction: DesktopThemeAction = {
  id: "windows-terminal",
  label: "Windows Terminal",
  platforms: ["windows"],

  signature(context) {
    return context.highlight.hex;
  },

  async run(context) {
    const files = await readSettingsFiles(context);
    // No Terminal installed. Not a failure.
    for (const file of files) {
      // One unreadable or unpatchable install must not stop the others - the
      // one that matters may well be the next in the list.
      try {
        await applyToFile(context, file);
      } catch (error) {
        console.error("[managed-desktop] windows-terminal: could not update", context.computer.id, file.path, error);
      }
    }
  },
};
