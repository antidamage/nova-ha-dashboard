import { describe, expect, it } from "vitest";
import { parseModuleManifest } from "./manifest";
import { MANIFEST } from "./store/store.fixtures";

describe("module manifest", () => {
  it("names the offending hook rather than just refusing", () => {
    const parsed = parseModuleManifest({ ...MANIFEST, hooks: ["entity.action", "not.a.hook"] });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("not.a.hook");
  });

  it("rejects a message template for a hook the module never declared", () => {
    const parsed = parseModuleManifest({
      ...MANIFEST,
      messages: { "reminder.due": "nope" },
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("reminder.due");
  });

  it("rejects an entry path that escapes the package", () => {
    const parsed = parseModuleManifest({ ...MANIFEST, entry: { server: "../../evil.mjs" } });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("relative path");
  });
});
