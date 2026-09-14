import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

// Landscape control panels must never cut content off. Each sub-panel is its
// own vertical scroller (specs/advanced-fold.md, specs/landscape-layout.md);
// this first failed on Network, where the router panel's clip-path cut the
// Sleep/Wake buttons once enough computers were configured.

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

/**
 * Every sub-panel's overflow is reachable by scrolling it
 * (specs/advanced-fold.md, "Every sub-panel scrolls on its own"). A sub-panel
 * whose content is taller than it must be a vertical scroller, and scrolled to
 * its end its last content must sit inside it. The zone panel body no longer
 * scrolls: each sub-panel does.
 */
async function expectOverflowReachable(page: Page) {
  const problems = await page.evaluate(async () => {
    const found: string[] = [];
    const body = document.querySelector<HTMLElement>(".control-stage > .zone-panel > .mt-8");
    if (body && body.scrollHeight > body.clientHeight + 1 && getComputedStyle(body).overflowY !== "visible") {
      found.push(`zone panel body scrolls ${body.scrollHeight}>${body.clientHeight}`);
    }
    const subPanels = Array.from(document.querySelectorAll<HTMLElement>(".control-stage .advanced-fold"));
    if (!subPanels.length) found.push("no sub-panels rendered");
    for (const panel of subPanels) {
      const name = String(panel.className).split(" ").filter((c) => c !== "advanced-fold")[0] ?? "advanced-fold";
      if (panel.scrollHeight <= panel.clientHeight + 1) continue;
      if (getComputedStyle(panel).overflowY !== "auto") {
        found.push(`${name} overflows without scrolling`);
        continue;
      }
      panel.scrollTop = panel.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const bottom = panel.getBoundingClientRect().bottom;
      const track = panel.querySelector(":scope > .advanced-fold-track") ?? panel;
      const last = track.lastElementChild as HTMLElement | null;
      if (last && last.getBoundingClientRect().bottom > bottom + 1) {
        found.push(`${name} end unreachable ${Math.round(last.getBoundingClientRect().bottom)}>${Math.round(bottom)}`);
      }
      panel.scrollTop = 0;
    }
    return found;
  });
  expect(problems, "sub-panels whose overflow cannot be reached").toEqual([]);
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
      await expectOverflowReachable(page);
      await expectAllReachable(page, ".desktop-power-panel .system-power-button");
      // Router and Computers are two sub-panels side by side.
      const [router, computers] = await Promise.all([
        page.locator(".control-stage .router-panel").boundingBox(),
        page.locator(".control-stage .router-computers").boundingBox(),
      ]);
      expect(router && computers && computers.x >= router.x + router.width - 1).toBe(true);
    });

    for (const zone of [/Climate/, /Outside/, /Grid/, /Lounge/]) {
      test(`${zone.source}: each sub-panel's overflow is reachable by scrolling it`, async ({ page }) => {
        await gotoDashboard(page);
        await waitForStableLayout(page);
        await selectZone(page, zone);
        await page.waitForTimeout(1500);
        await expectOverflowReachable(page);
      });
    }
  });
}
