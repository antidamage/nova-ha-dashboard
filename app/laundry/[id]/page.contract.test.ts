import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Contract tripwire for the wash sheet staying live. The route declares
// `generateStaticParams`, so without a dynamic API Next renders each wash once and
// serves that render for good: the owner shown never changed and a pick appeared
// not to save. Awaiting `params` is not enough; `connection()` is what opts in.
describe("laundry wash sheet", () => {
  it("opts into per-request rendering outside the static demo", () => {
    const source = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    expect(source).toMatch(/from "next\/server"/);
    expect(source).toMatch(/if \(!isDemoMode\) await connection\(\);/);
  });
});
