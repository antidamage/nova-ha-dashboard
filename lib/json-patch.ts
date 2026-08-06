/**
 * A minimal RFC 6902 JSON Patch differ and applier.
 *
 * Written here rather than pulled in as a dependency because the dashboard
 * needs exactly three operations and total control over how arrays are
 * compared. The history log stores these patches forever, so the format has to
 * stay stable and readable by hand when something has gone wrong — which is
 * precisely when someone reaches for the history.
 *
 * Arrays are diffed by position, not by a longest-common-subsequence. Nova's
 * preference arrays are short, ordered, identity-carrying lists (colour themes,
 * settings groups, zones) where a reorder genuinely is "these positions now
 * hold different things", and a smarter diff would hide that.
 */

export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown };

export type JsonPatch = JsonPatchOp[];

/** RFC 6901: `~` and `/` are the only characters that need escaping. */
export function escapePointerToken(token: string) {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function unescapePointerToken(token: string) {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function pointerTokens(pointer: string): string[] {
  if (!pointer || pointer === "/") return [];
  if (!pointer.startsWith("/")) throw new Error(`Not a JSON pointer: ${pointer}`);
  return pointer.slice(1).split("/").map(unescapePointerToken);
}

export function joinPointer(base: string, token: string | number) {
  return `${base}/${escapePointerToken(String(token))}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality. Key order is not significant; array order is. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) =>
      Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

export function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The ops that turn `before` into `after`.
 *
 * Removals inside an array are emitted highest-index-first so that applying
 * them in order never shifts an index the later ops still refer to.
 */
export function diffJson(before: unknown, after: unknown, base = ""): JsonPatch {
  if (deepEqual(before, after)) return [];

  if (Array.isArray(before) && Array.isArray(after)) {
    const ops: JsonPatch = [];
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < shared; index += 1) {
      ops.push(...diffJson(before[index], after[index], joinPointer(base, index)));
    }
    // Highest index first, so each removal targets a position that is still
    // valid at the moment it is applied. Ascending removals delete the wrong
    // elements as the list shifts underneath them.
    for (let index = before.length - 1; index >= after.length; index -= 1) {
      ops.push({ op: "remove", path: joinPointer(base, index) });
    }
    for (let index = before.length; index < after.length; index += 1) {
      ops.push({ op: "add", path: joinPointer(base, index), value: clone(after[index]) });
    }
    return ops;
  }

  if (isObject(before) && isObject(after)) {
    const ops: JsonPatch = [];
    for (const key of Object.keys(before)) {
      const pointer = joinPointer(base, key);
      if (!Object.prototype.hasOwnProperty.call(after, key)) {
        ops.push({ op: "remove", path: pointer });
      } else {
        ops.push(...diffJson(before[key], after[key], pointer));
      }
    }
    for (const key of Object.keys(after)) {
      if (!Object.prototype.hasOwnProperty.call(before, key)) {
        ops.push({ op: "add", path: joinPointer(base, key), value: clone(after[key]) });
      }
    }
    return ops;
  }

  // Differing types, or two differing scalars: the whole node is replaced.
  // `add` at the root is meaningless, so a root change is always a replace.
  return [{ op: "replace", path: base, value: clone(after) }];
}

/** Reads the value at a pointer. Returns `undefined` when the path is absent. */
export function getAtPointer(document: unknown, pointer: string): unknown {
  let cursor: unknown = document;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(cursor)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return undefined;
      cursor = cursor[index];
    } else if (isObject(cursor)) {
      if (!Object.prototype.hasOwnProperty.call(cursor, token)) return undefined;
      cursor = cursor[token];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/** Whether a pointer resolves at all, distinguishing "absent" from "null". */
export function hasPointer(document: unknown, pointer: string): boolean {
  if (!pointer) return true;
  const tokens = pointerTokens(pointer);
  let cursor: unknown = document;
  for (const token of tokens) {
    if (Array.isArray(cursor)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return false;
      cursor = cursor[index];
    } else if (isObject(cursor)) {
      if (!Object.prototype.hasOwnProperty.call(cursor, token)) return false;
      cursor = cursor[token];
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Writes `value` at `pointer`, creating intermediate containers as needed.
 *
 * A missing intermediate becomes an object, or an array when the next token is
 * a number — which is what makes restoring a subtree into a document that no
 * longer has that branch work at all.
 */
export function setAtPointer<T>(document: T, pointer: string, value: unknown): T {
  const tokens = pointerTokens(pointer);
  if (!tokens.length) return clone(value) as T;
  const root = (isObject(document) || Array.isArray(document) ? document : {}) as Record<string, unknown>;
  let cursor: Record<string, unknown> | unknown[] = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const nextIsIndex = /^\d+$/.test(tokens[index + 1]);
    const key = Array.isArray(cursor) ? Number(token) : token;
    const existing = (cursor as Record<string, unknown>)[key as string];
    if (!isObject(existing) && !Array.isArray(existing)) {
      (cursor as Record<string, unknown>)[key as string] = nextIsIndex ? [] : {};
    }
    cursor = (cursor as Record<string, unknown>)[key as string] as Record<string, unknown> | unknown[];
  }
  const last = tokens[tokens.length - 1];
  if (Array.isArray(cursor)) {
    const index = last === "-" ? cursor.length : Number(last);
    cursor[index] = clone(value);
  } else {
    cursor[last] = clone(value);
  }
  return root as T;
}

export function removeAtPointer<T>(document: T, pointer: string): T {
  const tokens = pointerTokens(pointer);
  if (!tokens.length) return undefined as unknown as T;
  const parentPointer = `/${tokens.slice(0, -1).map(escapePointerToken).join("/")}`;
  const parent = tokens.length === 1 ? document : getAtPointer(document, parentPointer);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    const index = Number(last);
    if (Number.isInteger(index) && index >= 0 && index < parent.length) parent.splice(index, 1);
  } else if (isObject(parent)) {
    delete parent[last];
  }
  return document;
}

/** Applies a patch to a copy of `document`, leaving the original untouched. */
export function applyPatch<T>(document: T, patch: JsonPatch): T {
  let next = clone(document);
  for (const op of patch) {
    if (op.op === "remove") {
      next = removeAtPointer(next, op.path);
    } else if (Array.isArray(getAtPointer(next, parentOf(op.path))) && op.op === "add") {
      // `add` on an array is an insert, not an overwrite: that is what makes a
      // patch that grew a list replayable onto the same list.
      const parent = getAtPointer(next, parentOf(op.path)) as unknown[];
      const token = pointerTokens(op.path).slice(-1)[0];
      const index = token === "-" ? parent.length : Number(token);
      parent.splice(Math.max(0, Math.min(index, parent.length)), 0, clone(op.value));
    } else {
      next = setAtPointer(next, op.path, op.value);
    }
  }
  return next;
}

function parentOf(pointer: string) {
  const tokens = pointerTokens(pointer);
  return tokens.length <= 1 ? "" : `/${tokens.slice(0, -1).map(escapePointerToken).join("/")}`;
}

/** The inverse of a patch, given the document it was computed against. */
export function invertPatch(before: unknown, patch: JsonPatch): JsonPatch {
  const after = applyPatch(before, patch);
  return diffJson(after, before);
}
