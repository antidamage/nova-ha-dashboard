/**
 * Surgical text editing of Windows Terminal's `settings.json`.
 *
 * The file is JSONC: it ships with `//` comments, and users add their own.
 * Parsing and re-serialising it would silently delete every comment, reorder
 * keys and re-indent the whole thing - so this never parses. It scans the text,
 * locates the PowerShell profile's span, and rewrites exactly one value or
 * inserts exactly one line. Everything else survives byte-for-byte.
 *
 * The scanner is string- and comment-aware throughout. Naive brace counting
 * gets `{` inside a `commandline` string wrong, which is the classic way this
 * goes badly.
 *
 * See `specs/desktop-theme-app-actions.md`.
 */

// PowerShell 7 outranks Windows PowerShell everywhere below: a machine with
// both installed is a machine that uses 7.
const POWERSHELL_CORE_GUID = "{574e775e-4f2a-5b96-ac1e-a2962a402336}";
const WINDOWS_POWERSHELL_GUID = "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}";
const POWERSHELL_CORE_SOURCE = "Windows.Terminal.PowershellCore";

type Span = { end: number; start: number };

type Member = {
  key: string;
  // The whole `"key": value` span, for replacement.
  keyStart: number;
  value: Span;
};

function isWhitespace(ch: string) {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

/** Advance past whitespace and JSONC comments. */
function skipTrivia(src: string, i: number) {
  for (;;) {
    while (i < src.length && isWhitespace(src[i])) {
      i += 1;
    }
    if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (src.startsWith("/*", i)) {
      const close = src.indexOf("*/", i + 2);
      i = close === -1 ? src.length : close + 2;
      continue;
    }
    return i;
  }
}

/** `i` sits on the opening quote; returns the index just past the closing one. */
function skipString(src: string, i: number) {
  i += 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === '"') {
      return i + 1;
    }
    i += 1;
  }
  return src.length;
}

/** `i` sits on the first character of a value; returns the index just past it. */
function skipValue(src: string, i: number): number {
  const ch = src[i];
  if (ch === '"') {
    return skipString(src, i);
  }
  if (ch === "{" || ch === "[") {
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    while (i < src.length) {
      i = skipTrivia(src, i);
      const c = src[i];
      if (c === '"') {
        i = skipString(src, i);
        continue;
      }
      if (c === "{" || c === "[") {
        depth += 1;
      } else if (c === "}" || c === "]") {
        depth -= 1;
        if (depth === 0) {
          return i + 1;
        }
      }
      i += 1;
    }
    return src.length;
  }
  // A primitive: number, true, false, null. Runs to the next separator.
  while (i < src.length && !",}]".includes(src[i]) && !isWhitespace(src[i])) {
    i += 1;
  }
  return i;
}

/** `start` sits on `{`; enumerate its direct members. */
function objectMembers(src: string, start: number): Member[] {
  const members: Member[] = [];
  let i = skipTrivia(src, start + 1);
  while (i < src.length && src[i] !== "}") {
    if (src[i] !== '"') {
      // Trailing comma, or something we do not understand. Either way there is
      // no member to read here.
      i += 1;
      i = skipTrivia(src, i);
      continue;
    }
    const keyStart = i;
    const keyEnd = skipString(src, i);
    const key = JSON.parse(src.slice(keyStart, keyEnd)) as string;
    i = skipTrivia(src, keyEnd);
    if (src[i] !== ":") {
      break;
    }
    i = skipTrivia(src, i + 1);
    const valueStart = i;
    const valueEnd = skipValue(src, i);
    members.push({ key, keyStart, value: { end: valueEnd, start: valueStart } });
    i = skipTrivia(src, valueEnd);
    if (src[i] === ",") {
      i = skipTrivia(src, i + 1);
    }
  }
  return members;
}

/** `start` sits on `[`; enumerate its direct element spans. */
function arrayElements(src: string, start: number): Span[] {
  const spans: Span[] = [];
  let i = skipTrivia(src, start + 1);
  while (i < src.length && src[i] !== "]") {
    const elementStart = i;
    const elementEnd = skipValue(src, i);
    if (elementEnd <= elementStart) {
      break;
    }
    spans.push({ end: elementEnd, start: elementStart });
    i = skipTrivia(src, elementEnd);
    if (src[i] === ",") {
      i = skipTrivia(src, i + 1);
    }
  }
  return spans;
}

function memberString(src: string, members: Member[], key: string): string | null {
  const member = members.find((entry) => entry.key === key);
  if (!member || src[member.value.start] !== '"') {
    return null;
  }
  try {
    return JSON.parse(src.slice(member.value.start, member.value.end)) as string;
  } catch {
    return null;
  }
}

function memberIsTrue(src: string, members: Member[], key: string) {
  const member = members.find((entry) => entry.key === key);
  return member ? src.slice(member.value.start, member.value.end).trim() === "true" : false;
}

/** Locate the array of profile objects, handling both settings schemas. */
function profileList(src: string): Span[] | null {
  const rootStart = skipTrivia(src, 0);
  if (src[rootStart] !== "{") {
    return null;
  }
  const root = objectMembers(src, rootStart);
  const profiles = root.find((entry) => entry.key === "profiles");
  if (!profiles) {
    return null;
  }
  // Newer schemas nest the array under `profiles.list`; the older one has
  // `profiles` be the array itself.
  if (src[profiles.value.start] === "[") {
    return arrayElements(src, profiles.value.start);
  }
  if (src[profiles.value.start] !== "{") {
    return null;
  }
  const list = objectMembers(src, profiles.value.start).find((entry) => entry.key === "list");
  if (!list || src[list.value.start] !== "[") {
    return null;
  }
  return arrayElements(src, list.value.start);
}

type Candidate = { members: Member[]; span: Span };

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
 * The single splice that turns the original text into the patched text:
 * replace `length` characters at `offset` with `text`.
 *
 * The edit is published as well as the result because the caller cannot ship
 * the whole file back to the machine - a Windows command line caps at 8191
 * characters and a real settings.json does not fit. It ships this instead,
 * which is a few dozen characters whatever the file's size.
 *
 * Offsets are into the decoded string, not the file's bytes, so both ends must
 * work on the text rather than on bytes - a BOM would otherwise shift them.
 */
export type TabColorEdit = { length: number; offset: number; text: string };

export type TabColorPatch =
  | { kind: "no-profile" }
  | { edit: TabColorEdit; kind: "patched"; text: string }
  | { kind: "unchanged" };

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
