import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGN_ID_PATTERN } from "./contract";
import { DEFAULT_DESIGN_ID, isKnownDesignId, listDesigns, resolveDesign } from "./registry";
import {
  normalizeDesignPreferences,
  DEFAULT_DESIGN_ID as SERVER_DEFAULT,
  DESIGN_ID_PATTERN as SERVER_PATTERN,
} from "../../lib/design-preferences";

// Contract tripwires for design switching (specs/design-modules.md). These
// guard the properties that, if broken, leave the dashboard rendering nothing:
// an unresolvable default, a duplicate id, or a server/client default that have
// drifted apart.

describe("design registry contract", () => {
  const designs = listDesigns();

  it("ships at least two designs, so switching is exercisable", () => {
    expect(designs.length).toBeGreaterThanOrEqual(2);
  });

  it("gives every design a well-formed, unique id", () => {
    const ids = designs.map((design) => design.manifest.id);
    for (const id of ids) {
      expect(id, `"${id}" must match ${DESIGN_ID_PATTERN}`).toMatch(DESIGN_ID_PATTERN);
    }
    expect(new Set(ids).size, "design ids must be unique").toBe(ids.length);
  });

  it("resolves the default design, which must exist", () => {
    expect(resolveDesign(DEFAULT_DESIGN_ID).manifest.id).toBe(DEFAULT_DESIGN_ID);
  });

  // A preferences file naming a removed design must not blank the dashboard.
  it("falls back to the default for an unknown or missing id", () => {
    expect(resolveDesign("does-not-exist").manifest.id).toBe(DEFAULT_DESIGN_ID);
    expect(resolveDesign(null).manifest.id).toBe(DEFAULT_DESIGN_ID);
    expect(resolveDesign(undefined).manifest.id).toBe(DEFAULT_DESIGN_ID);
  });

  it("keeps the server-side default in step with the registry's", () => {
    // These live in two files on purpose (the API routes must not import a
    // React component tree), so a test has to hold them together.
    expect(SERVER_DEFAULT).toBe(DEFAULT_DESIGN_ID);
  });

  it("keeps the server-side id pattern in step with the contract's", () => {
    // Same split, same reason. If these drift, the server can persist an id the
    // client would never treat as known — a design that silently never loads.
    expect(SERVER_PATTERN.source).toBe(DESIGN_ID_PATTERN.source);
  });

  // The default id is also spelled literally in two places that cannot import
  // it: the demo bootstrap inlined into the prerendered layout, and the demo
  // fetch shim (a browser-sandboxed function serialised to a string). Renaming
  // the default without updating them would make the demo default to a design
  // that no longer exists, with nothing else failing.
  it("keeps the literal default id in the demo bootstrap and shim in step", () => {
    const root = join(__dirname, "..", "..");
    for (const file of ["app/layout.tsx", "lib/demo-config.ts"]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, `${file} must spell the default design id`).toContain(
        `"${DEFAULT_DESIGN_ID}"`,
      );
    }
  });

  // SPEC.md §2 Experience Mode Parity: a feature with no declared lite
  // behaviour does not ship.
  it("makes every design declare all four lite flags", () => {
    for (const design of designs) {
      for (const key of ["statusOrb", "background", "camera", "worldMap"] as const) {
        expect(
          typeof design.lite[key],
          `${design.manifest.id} must declare lite.${key}`,
        ).toBe("boolean");
      }
    }
  });

  it("recognises exactly the shipped ids", () => {
    for (const design of designs) {
      expect(isKnownDesignId(design.manifest.id)).toBe(true);
    }
    expect(isKnownDesignId("nope")).toBe(false);
    expect(isKnownDesignId(42)).toBe(false);
  });
});

// The design is a shared household setting: a change made on one screen must
// reach every other screen. That path is a server broadcast plus a client
// subscription, neither of which has a runtime handle in jsdom, so assert the
// wiring in source the way the lite-mode contract test does.
describe("design change reaches every client", () => {
  const root = join(__dirname, "..", "..");
  const read = (file: string) => readFileSync(join(root, file), "utf8");

  it("broadcasts the new design after the write lands", () => {
    const events = read("lib/dashboard-events.ts");
    expect(events, "publishDesign must exist").toContain("export function publishDesign");
    expect(events, "it must broadcast on an SSE event named 'design'").toContain('sseEvent("design"');

    const route = read("app/api/design/route.ts");
    expect(route).toContain("publishDesign(");
    // Announcing before the merge would tell the house about a design that may
    // have failed to persist.
    const mergeAt = route.indexOf("mergeDashboardPreferences");
    const publishAt = route.indexOf("publishDesign(");
    expect(mergeAt, "route must persist the design").toBeGreaterThan(-1);
    expect(publishAt, "publish must come after the write").toBeGreaterThan(mergeAt);
  });

  it("subscribes every client to that broadcast on the shared EventSource", () => {
    const active = read("app/design/activeDesign.ts");
    // Must ride the shared stream: a second EventSource would spend one of the
    // browser's ~6 connections per origin, which this dashboard has starved
    // before (see app/components/sharedDashboardEvents.ts).
    expect(active).toContain("subscribeToDashboardEvents");
    expect(active).not.toContain("new EventSource");
    expect(active).toContain("design:");
  });
});

describe("design preferences normalisation", () => {
  it("defaults anything malformed rather than throwing", () => {
    expect(normalizeDesignPreferences(null).activeId).toBe(SERVER_DEFAULT);
    expect(normalizeDesignPreferences({}).activeId).toBe(SERVER_DEFAULT);
    expect(normalizeDesignPreferences({ activeId: 7 }).activeId).toBe(SERVER_DEFAULT);
    expect(normalizeDesignPreferences({ activeId: "Bad Id!" }).activeId).toBe(SERVER_DEFAULT);
    expect(normalizeDesignPreferences([]).activeId).toBe(SERVER_DEFAULT);
  });

  it("keeps a well-formed id even if no design currently claims it", () => {
    // Structural validation only — the registry decides existence at render
    // time, so uninstalling a design must not rewrite the stored preference.
    expect(normalizeDesignPreferences({ activeId: "future-design" }).activeId).toBe("future-design");
  });
});
