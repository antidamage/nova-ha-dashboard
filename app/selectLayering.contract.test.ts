import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(join(__dirname, "globals.css"), "utf8");

function zIndexFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = globalsCss.match(new RegExp(`${escaped}[^\\{]*\\{([^}]+)\\}`))?.[1] ?? "";
  return Number(block.match(/z-index:\s*(\d+)/)?.[1] ?? 0);
}

describe("custom selector layering", () => {
  it("keeps portalled dropdown options interactive above modal overlays", () => {
    expect(zIndexFor(".cyber-select-menu-portal")).toBeGreaterThan(zIndexFor(".modal-overlay,"));
  });
});
