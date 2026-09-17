import { POWERSHELL_CORE_GUID, POWERSHELL_CORE_SOURCE, WINDOWS_POWERSHELL_GUID } from "./constants";
import { memberIsTrue, memberString, objectMembers, profileList } from "./scanner";
import type { Candidate, TabColorPatch } from "./types";

/**
 * Pick the PowerShell profile. Ranked, first match wins, PowerShell 7 ahead of
 * Windows PowerShell at every level. A hidden profile is never selected -
 * setting a tab colour on a profile nobody can open is pointless.
 */
function selectPowerShellProfile(src: string, candidates: Candidate[]): Candidate | null {
  const visible = candidates.filter(({ members }) => !memberIsTrue(src, members, "hidden"));
  const tests: Array<(candidate: Candidate) => boolean> = [
    ({ members }) => memberString(src, members, "guid")?.toLowerCase() === POWERSHELL_CORE_GUID,
    ({ members }) => memberString(src, members, "source") === POWERSHELL_CORE_SOURCE,
    ({ members }) => memberString(src, members, "guid")?.toLowerCase() === WINDOWS_POWERSHELL_GUID,
    ({ members }) => (memberString(src, members, "commandline") ?? "").toLowerCase().includes("pwsh.exe"),
    ({ members }) => (memberString(src, members, "commandline") ?? "").toLowerCase().includes("powershell.exe"),
    ({ members }) => memberString(src, members, "name") === "PowerShell",
    ({ members }) => memberString(src, members, "name") === "Windows PowerShell",
  ];
  for (const test of tests) {
    const match = visible.find(test);
    if (match) {
      return match;
    }
  }
  return null;
}

export function normalizeHex(hex: string) {
  const value = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`Not a six-digit hex colour: ${hex}`);
  }
  return `#${value.toUpperCase()}`;
}

/** The whitespace prefix of the line `index` falls on. */
function lineIndent(src: string, index: number) {
  const lineStart = src.lastIndexOf("\n", index - 1) + 1;
  const prefix = src.slice(lineStart, index);
  return /^[ \t]*$/.test(prefix) ? prefix : "  ";
}

/**
 * Set `tabColor` on the PowerShell profile.
 *
 * The three outcomes are deliberately distinct, because the caller acts
 * differently on each: `patched` writes the file, `unchanged` must **not**
 * write it (writing is what makes Terminal reload, and a reload nobody asked
 * for is a visible flicker in every open window), and `no-profile` means there
 * is nothing here to patch and the caller should fall back.
 */
export function patchPowerShellTabColor(source: string, hex: string): TabColorPatch {
  const color = normalizeHex(hex);
  const spans = profileList(source);
  if (!spans) {
    return { kind: "no-profile" };
  }

  const candidates: Candidate[] = spans
    .filter((span) => source[span.start] === "{")
    .map((span) => ({ members: objectMembers(source, span.start), span }));

  const profile = selectPowerShellProfile(source, candidates);
  if (!profile) {
    return { kind: "no-profile" };
  }

  const existing = profile.members.find((entry) => entry.key === "tabColor");
  if (existing) {
    if (memberString(source, profile.members, "tabColor")?.toUpperCase() === color) {
      return { kind: "unchanged" };
    }
    const replacement = JSON.stringify(color);
    return {
      edit: { length: existing.value.end - existing.value.start, offset: existing.value.start, text: replacement },
      kind: "patched",
      text: source.slice(0, existing.value.start) + replacement + source.slice(existing.value.end),
    };
  }

  const first = profile.members[0];
  if (!first) {
    // An empty profile object. Nothing to match indentation against, so keep
    // it on one line.
    const inserted = ` ${JSON.stringify("tabColor")}: ${JSON.stringify(color)} `;
    const offset = profile.span.start + 1;
    return {
      edit: { length: profile.span.end - 1 - offset, offset, text: inserted },
      kind: "patched",
      text: source.slice(0, offset) + inserted + source.slice(profile.span.end - 1),
    };
  }
  // Match the file's own line ending, since this is a splice into a file we
  // are otherwise leaving alone.
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const indent = lineIndent(source, first.keyStart);
  const inserted = `${JSON.stringify("tabColor")}: ${JSON.stringify(color)},${eol}${indent}`;
  return {
    edit: { length: 0, offset: first.keyStart, text: inserted },
    kind: "patched",
    text: source.slice(0, first.keyStart) + inserted + source.slice(first.keyStart),
  };
}

/** The patched text, or `null` for either non-patch outcome. */
export function setPowerShellTabColor(source: string, hex: string): string | null {
  const result = patchPowerShellTabColor(source, hex);
  return result.kind === "patched" ? result.text : null;
}
