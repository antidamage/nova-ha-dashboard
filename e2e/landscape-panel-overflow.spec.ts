import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

// Landscape control panels must never cut content off. A panel with more than
// it can fit scrolls vertically inside its column (specs/landscape-layout.md);
// this failed on Network, where the router panel's clip-path cut the Sleep/Wake
// buttons once enough computers were configured.

const COMPUTERS = ["Ununhexium", "Indium", "Nocturnium", "Iridium", "Lithium"].map((name, index) => ({
  id: name.toLowerCase(),
  name,
  enabled: true,
  capabilities: { sleep: true, wake: true },
  macAddress: `02:00:00:00:00:0${index}`,
}));

// The demo provider answers /api/* inside the page, so page.route never sees
// the request; set the list through the provider's own PUT instead. The panel
// fetches on mount, which is when the Network zone is opened.
async function seedComputers(page: Page) {
  await page.evaluate(async (computers) => {
    await fetch("/api/desktop/computers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ computers }),
    });
  }, COMPUTERS);
}

/** Every button must be reachable: scrolled into view, the point at its centre is the button. */
async function expectAllReachable(page: Page, selector: string) {
  const buttons = page.locator(selector);
  const count = await buttons.count();
  expect(count, `${selector} rendered`).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    await button.scrollIntoViewIfNeeded();
    const hit = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const probe = (x: number, y: number) => {
        const top = document.elementFromPoint(x, y);
        return Boolean(top && (top === el || el.contains(top)));
      };
      // Near the bottom edge too: a clip through the label is the failure.
      return probe(r.left + r.width / 2, r.top + r.height / 2) && probe(r.left + r.width / 2, r.bottom - 4);
    });
    expect(hit, `${selector} #${i} is visible and not clipped`).toBe(true);
  }
}

/** No clipped panel inside the control stage hides content below its bottom edge. */
async function expectNoClippedPanels(page: Page) {
  const clipped = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".control-stage .router-panel, .control-stage .climate-card"))
      .filter((el) => el.scrollHeight > el.clientHeight + 1)
      .map((el) => `${el.className.split(" ")[0]} ${el.scrollHeight}>${el.clientHeight}`),
  );
  expect(clipped, "panels with content cut off").toEqual([]);
}

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]) {
  test.describe(`landscape ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("Network: every Sleep/Wake button is reachable", async ({ page }) => {
      await gotoDashboard(page);
      await waitForStableLayout(page);
      await seedComputers(page);
      // The provider persists the list; reload so an already-mounted panel refetches.
      await gotoDashboard(page);
      await waitForStableLayout(page);
      await selectZone(page, /Network/);
      await expect(page.locator(".desktop-power-panel .system-power-button")).toHaveCount(COMPUTERS.length * 2);
      await expectNoClippedPanels(page);
      await expectAllReachable(page, ".desktop-power-panel .system-power-button");    });

    for (const zone of [/Climate/, /Outside/]) {
      test(`${zone.source}: nothing clipped, no vertical scroll at 1080`, async ({ page }) => {
        await gotoDashboard(page);
        await waitForStableLayout(page);
        await selectZone(page, zone);
        await page.waitForTimeout(1500);
        await expectNoClippedPanels(page);
        if (viewport.height >= 1080) {
          // Single-purpose panels still try to fit the column (specs/landscape-layout.md).
          const scrolls = await page.evaluate(() => {
            const body = document.querySelector<HTMLElement>(".control-stage > .zone-panel > .mt-8");
            return body ? body.scrollHeight > body.clientHeight + 1 : null;
          });
          expect(scrolls, "panel body scrolls").toBe(false);
        }
      });
    }
  });
}
