// Remote command builders: the PowerShell wrapper, wallpaper staging and
// application, and sleep.
import type { ManagedComputerPlatform } from "./types";

export function assertSafeRemoteFileName(fileName: string) {
  if (!/^nova-wallpaper-[a-z0-9_-]+\.(png|jpg|webp)$/.test(fileName)) {
    throw new Error("Unsafe remote wallpaper file name");
  }
}

/**
 * Wrap a PowerShell script as a single SSH command line.
 *
 * Exported because the per-application theme actions in
 * `lib/desktop-theme-actions/` build their own Windows-side scripts and must
 * use the same encoding as everything else here rather than inventing quoting.
 */
export function windowsPowerShellCommand(script: string) {
  const wrapped = `$ProgressPreference = 'SilentlyContinue'; ${script}`;
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(wrapped, "utf16le").toString("base64")}`;
}

export function remoteWallpaperFileName(assetId: string, contentType: string) {
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return `nova-wallpaper-${assetId.replace(/^wallpaper_/, "")}.${extension}`;
}

export function remotePrepareCommand(platform: ManagedComputerPlatform) {
  if (platform === "windows") {
    return windowsPowerShellCommand("New-Item -ItemType Directory -Force -Path (Join-Path $HOME 'NovaManagedDesktop') | Out-Null");
  }
  return "mkdir -p \"$HOME/NovaManagedDesktop\"";
}

export function remoteWallpaperCommand(platform: ManagedComputerPlatform, fileName: string) {
  assertSafeRemoteFileName(fileName);
  if (platform === "windows") {
    const childPath = `NovaManagedDesktop\\${fileName}`;
    return windowsPowerShellCommand([
      "$ErrorActionPreference = 'Stop'",
      `$path = Join-Path $HOME '${childPath}'`,
      "$workDir = Join-Path $HOME 'NovaManagedDesktop'",
      "$statusPath = Join-Path $workDir 'wp-status.txt'",
      "$scriptPath = Join-Path $workDir 'wp.ps1'",
      "$cmdPath = Join-Path $workDir 'wp.cmd'",
      "$taskName = 'NovaManagedDesktopWallpaper'",
      "$applyScript = @'\nparam([string]$Path, [string]$StatusPath)\n$ErrorActionPreference = 'Stop'\ntry {\n  Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '10'\n  Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '0'\n  Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper -Value $Path\n  $code = 'using System.Runtime.InteropServices; public class NovaWallpaper { [DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool SystemParametersInfo(int a, int b, string c, int d); }'\n  Add-Type $code\n  if (-not [NovaWallpaper]::SystemParametersInfo(20, 0, $Path, 3)) { throw 'SystemParametersInfo failed' }\n  Set-Content -LiteralPath $StatusPath -Encoding UTF8 -Value 'ok'\n} catch {\n  Set-Content -LiteralPath $StatusPath -Encoding UTF8 -Value ('error: ' + $_.Exception.Message)\n  exit 1\n}\n'@",
      "Set-Content -LiteralPath $scriptPath -Encoding UTF8 -Value $applyScript",
      "$cmdScript = '@echo off' + [Environment]::NewLine + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"' + $scriptPath + '\" -Path \"' + $path + '\" -StatusPath \"' + $statusPath + '\"'",
      "Set-Content -LiteralPath $cmdPath -Encoding ASCII -Value $cmdScript",
      "Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue",
      "try { & $cmdPath; if ((Get-Content -LiteralPath $statusPath -ErrorAction SilentlyContinue) -eq 'ok') { return } } catch {}",
      "Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue",
      "$taskTime = (Get-Date).AddMinutes(1).ToString('HH:mm')",
      "$taskCommand = 'cmd.exe /c \"' + $cmdPath + '\"'",
      "& schtasks.exe /Create /TN $taskName /TR $taskCommand /SC ONCE /ST $taskTime /F /IT | Out-Null",
      "& schtasks.exe /Run /TN $taskName | Out-Null",
      "Start-Sleep -Seconds 5",
      "$status = Get-Content -LiteralPath $statusPath -ErrorAction SilentlyContinue",
      "if ($status -ne 'ok') { if (-not $status) { $status = 'Interactive wallpaper task did not report success' }; throw $status }",
    ].join("; "));
  }
  if (platform === "macos") {
    return [
      "set -eu",
      `file="$HOME/NovaManagedDesktop/${fileName}"`,
      "uri=\"file://$file\"",
      "plist=\"$HOME/Library/Application Support/com.apple.wallpaper/Store/Index.plist\"",
      "if [ -f \"$plist\" ]; then",
      "for key in ':AllSpacesAndDisplays:Desktop:Content:Choices:0:Files:0:relative' ':SystemDefault:Desktop:Content:Choices:0:Files:0:relative'; do /usr/libexec/PlistBuddy -c \"Set $key $uri\" \"$plist\" 2>/dev/null || true; done",
      "/usr/bin/killall WallpaperAgent 2>/dev/null || true",
      "/usr/bin/killall Dock 2>/dev/null || true",
      "else",
      `osascript -e 'tell application "Finder" to set desktop picture to POSIX file "'"$file"'"'`,
      "fi",
    ].join("; ");
  }
  return `plasma-apply-wallpaperimage --fill-mode preserveAspectCrop "$HOME/NovaManagedDesktop/${fileName}"`;
}

export function remoteSleepCommand(platform: ManagedComputerPlatform) {
  if (platform === "windows") {
    return windowsPowerShellCommand([
      "$code = 'using System.Runtime.InteropServices; public class NovaPower { [DllImport(\"powrprof.dll\", SetLastError=true)] public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent); }'",
      "Add-Type $code",
      "if (-not [NovaPower]::SetSuspendState($false, $false, $false)) { throw 'SetSuspendState failed' }",
    ].join("; "));
  }
  if (platform === "macos") {
    return "pmset sleepnow";
  }
  throw new Error("Sleep is not supported for this platform");
}
