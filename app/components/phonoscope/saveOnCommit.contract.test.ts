import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Preview samples used to be coalesced to a 75ms cadence and POSTed for the
// whole duration of a drag, so one gesture was dozens of whole-config saves and
// the thumb visibly lagged the finger holding it. The rule is easy to undo by
// accident — a preview handler that "just saves too" looks harmless — and the
// symptom is a feel problem no assertion about values would catch, so it is
// pinned here instead.
// The panel's body lives in config/phonoscope/ behind the PhonoscopeConfig.tsx
// facade: the save boundary is in the hook, the rendering in the component.
const panelDir = join(__dirname, "..", "config", "phonoscope");
const panel = ["usePhonoscopeConfig.ts", "PhonoscopeConfig.tsx"]
  .map((file) => readFileSync(join(panelDir, file), "utf8"))
  .join("\n");

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
