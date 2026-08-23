import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Preview samples used to be coalesced to a 75ms cadence and POSTed for the
// whole duration of a drag, so one gesture was dozens of whole-config saves and
// the thumb visibly lagged the finger holding it. The rule is easy to undo by
// accident — a preview handler that "just saves too" looks harmless — and the
// symptom is a feel problem no assertion about values would catch, so it is
// pinned here instead.
const panel = readFileSync(join(__dirname, "..", "PhonoscopeConfig.tsx"), "utf8");

describe("Visualiser panel save boundary", () => {
  it("previews into local state only", () => {
    const preview = panel.match(/const preview = useCallback\(([\s\S]*?)\n {2}\}, \[/)?.[1] ?? "";
    expect(preview).toContain("setConfig(next)");
    expect(preview).not.toMatch(/\bsave\(|fetch\(|saveChain/);
  });

  it("has no timer that could save part-way through a gesture", () => {
    expect(panel).not.toContain("saveTimer");
  });
});
