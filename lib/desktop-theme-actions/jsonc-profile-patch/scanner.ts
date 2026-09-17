// A hand-rolled, string- and comment-aware JSONC scanner. Naive brace
// counting gets `{` inside a `commandline` string wrong, which is the classic
// way parsing Windows Terminal's settings.json goes badly. Never parses the
// whole document — only scans far enough to locate spans for patch.ts to
// splice.

import type { Member, Span } from "./types";

function isWhitespace(ch: string) {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

/** Advance past whitespace and JSONC comments. */
export function skipTrivia(src: string, i: number) {
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
export function skipString(src: string, i: number) {
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
export function skipValue(src: string, i: number): number {
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
export function objectMembers(src: string, start: number): Member[] {
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
export function arrayElements(src: string, start: number): Span[] {
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

export function memberString(src: string, members: Member[], key: string): string | null {
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

export function memberIsTrue(src: string, members: Member[], key: string) {
  const member = members.find((entry) => entry.key === key);
  return member ? src.slice(member.value.start, member.value.end).trim() === "true" : false;
}

/** Locate the array of profile objects, handling both settings schemas. */
export function profileList(src: string): Span[] | null {
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
