export type Span = { end: number; start: number };

export type Member = {
  key: string;
  // The whole `"key": value` span, for replacement.
  keyStart: number;
  value: Span;
};

export type Candidate = { members: Member[]; span: Span };

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
