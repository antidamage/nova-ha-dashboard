import { describe, expect, it } from "vitest";
import { scan, type Finding } from "./no-household-data.fixtures";

/**
 * specs/maintenance-rule.md, "Golden Rule: No Machine-Specific Code": nova-ha-dashboard is a
 * distributable product. A new user must be able to deploy it against their own
 * Home Assistant with no code changes and without inheriting this household's
 * devices, rooms, router, timezone or electricity account.
 *
 * The rule kept regressing because nothing enforced it — moving a value into
 * config does not remove it from source, and a hard-coded fallback next to a
 * config read puts it straight back. This test is the enforcement.
 *
 * It scans string literals in product source. Literals are what actually change
 * behaviour, and scanning them (rather than raw text) avoids false positives
 * like `number.toFixed`.
 *
 * WAIVERS BELOW ARE A RATCHET, NOT A PARKING SPACE. Every entry is a real
 * violation with the phase that removes it. A waiver that no longer matches
 * anything also fails, so the list cannot rot once the code is fixed.
 *
 * The detector itself (the scanned file set, the literal lexer, the shapes)
 * lives in ./no-household-data.fixtures.ts, and its self-check in
 * ./no-household-data.detector.test.ts.
 */

type Waiver = {
  /** Repo-relative POSIX path. */
  file: string;
  /**
   * The exact literal content that matched, or `"*"` to waive the whole file.
   * Use `"*"` only where one root cause produces many matches, and say so.
   */
  literal: string;
  /** Why it is still here, and what removes it. */
  reason: string;
};

const WAIVERS: Waiver[] = [

];

/*
 * There was a second list here: the voice, phonoscope and camera integrations
 * named their host machines directly across ~300 occurrences in ~40 files —
 * symbol names, import paths, and operator-facing copy like "Iridium
 * unreachable". It was waived as a burn-down while the rest of the rule landed.
 *
 * That refactor is done. Machines are now referred to by the role they fill
 * (`voiceHost`, "the voice host"), the module is `lib/voice-host-settings.ts`,
 * and the URL comes from NOVA_VOICE_HOST_URL. Both lists are empty, so the
 * plain detector covers everything with nothing excused.
 */

function isWaived(finding: Finding) {
  return WAIVERS.some(
    (waiver) => waiver.file === finding.file && (waiver.literal === "*" || waiver.literal === finding.literal),
  );
}

/** Long template literals make the failure report unreadable. */
function short(literal: string) {
  const flat = literal.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}...` : flat;
}

describe("no household data in product source", () => {
  it("finds no unwaived household literal in lib/ or app/", () => {
    const unwaived = scan().filter((finding) => !isWaived(finding));

    const report = unwaived
      .map((finding) => `  ${finding.file}: ${finding.kind} -> ${JSON.stringify(short(finding.literal))}`)
      .join("\n");

    expect(
      unwaived,
      unwaived.length
        ? `Household-specific values must live in config (or the nova-household package), ` +
            `not in dashboard source. See specs/maintenance-rule.md.\n${report}\n\n` +
            `If one of these is genuinely generic, refine the detector rather than waiving it.`
        : undefined,
    ).toEqual([]);
  });

  it("has no stale waiver, so the ratchet cannot rot", () => {
    const findings = scan();
    const stale = WAIVERS.filter((waiver) =>
      waiver.literal === "*"
        ? !findings.some((f) => f.file === waiver.file)
        : !findings.some((f) => f.file === waiver.file && f.literal === waiver.literal),
    );

    const report = stale.map((waiver) => `  ${waiver.file}: ${JSON.stringify(waiver.literal)}`).join("\n");

    expect(
      stale,
      stale.length ? `These waivers no longer match anything — delete them:\n${report}` : undefined,
    ).toEqual([]);
  });
});
