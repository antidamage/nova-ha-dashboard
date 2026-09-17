/**
 * Surgical text editing of Windows Terminal's `settings.json` — facade. The
 * body lives in lib/desktop-theme-actions/jsonc-profile-patch/; this file
 * keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3).
 *
 * The file is JSONC: it ships with `//` comments, and users add their own.
 * Parsing and re-serialising it would silently delete every comment, reorder
 * keys and re-indent the whole thing - so this never parses. It scans the text,
 * locates the PowerShell profile's span, and rewrites exactly one value or
 * inserts exactly one line. Everything else survives byte-for-byte.
 *
 * See `specs/desktop-theme-app-actions.md`.
 *
 * Where things are:
 *
 *   jsonc-profile-patch/types.ts      Span, Member, Candidate, TabColorEdit/Patch
 *   jsonc-profile-patch/constants.ts  the PowerShell 7 / Windows PowerShell GUIDs
 *   jsonc-profile-patch/scanner.ts    the string- and comment-aware JSONC scanner
 *   jsonc-profile-patch/patch.ts      profile selection and the tabColor splice
 */

export type { TabColorEdit, TabColorPatch } from "./jsonc-profile-patch/types";
export { normalizeHex, patchPowerShellTabColor, setPowerShellTabColor } from "./jsonc-profile-patch/patch";
