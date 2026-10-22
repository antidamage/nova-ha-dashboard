import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";
import { waitForSlots } from "./quick-access-slots.fixtures";

// specs/quick-access-card.md, "The dials are spread evenly" (Adeline, 2026-10-23):
// the gap between two dials is the gap between the outer dials and the card's
// edges. Centred in equal slots, the kiosk's middle gap was 205px against 91px at
// the edges.

const VIEWPORTS = [
  { height: 1920, name: "kiosk portrait 1080x1920", width: 1080 },
  { height: 1080, name: "kiosk landscape 1920x1080", width: 1920 },
  { height: 1366, name: "ipad pro 1024x1366", width: 1024 },
  // Short landscape windows, where the dials are drawn below their full size
  // (--slot-scale under 1) and the step must be scaled only once.
  { height: 640, name: "landscape 1366x640 (scale ~0.89)", width: 1366 },
  { height: 600, name: "landscape 1280x600 (scale ~0.79)", width: 1280 },
];

for (const viewport of VIEWPORTS) {
  test(`the dials are spread evenly at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoDashboard(page);
    await waitForSlots(page);
    const rows = await page.evaluate(() => {
      const row = document.querySelector(".quick-access-row");
      if (!row) return null;
      const box = row.getBoundingClientRect();
      const dials = [...row.children].filter((child) => !child.classList.contains("panel-slot-wide"));
      const drawn = dials.map((dial) => {
        const extents = [...dial.querySelectorAll("*")]
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0);
        return {
          left: Math.min(...extents.map((rect) => rect.left)),
          right: Math.max(...extents.map((rect) => rect.right)),
          top: Math.round(dial.getBoundingClientRect().top),
        };
      });
      const byTop = new Map<number, typeof drawn>();
      for (const dial of drawn) byTop.set(dial.top, [...(byTop.get(dial.top) ?? []), dial]);
      return [...byTop.values()].map((line) => ({ left: box.left, right: box.right, dials: line.sort((a, b) => a.left - b.left) }));
    });
    if (!rows) throw new Error("no .quick-access-row");
    // 4px: each dial is centred in its own slot to within a pixel either side
    // (quick-access-slots.spec.ts), and a scaled-down card rounds a little more.
    for (const row of rows.filter((line) => line.dials.length > 1)) {
      const gaps = [row.dials[0].left - row.left];
      for (let index = 1; index < row.dials.length; index += 1) gaps.push(row.dials[index].left - row.dials[index - 1].right);
      gaps.push(row.right - row.dials[row.dials.length - 1].right);
      for (const gap of gaps) expect(Math.abs(gap - gaps[0]), `gaps ${gaps.map((g) => g.toFixed(1)).join(", ")}`).toBeLessThan(4);
    }
  });
}
