import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// specs/outside-weather-and-map.md, "The map's worker": loading next.config.ts
// copies MapLibre's worker to public/vendor/, where worker-url.ts points
// MapLibre. A missing or stale copy means no vector layer draws, silently.
describe("MapLibre worker copy", () => {
  it("is made when the Next config loads, and matches the installed MapLibre", async () => {
    await import("../../../next.config");
    const root = path.resolve(__dirname, "../../..");
    const installed = readFileSync(path.join(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"));
    const served = readFileSync(path.join(root, "public/vendor/maplibre-gl-worker.mjs"));
    expect(served.equals(installed)).toBe(true);
  });
});
