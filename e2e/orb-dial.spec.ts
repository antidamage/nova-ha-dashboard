import { attach, backendFor, dragAround, orb, readout, ringPoint, seedTasks, shot } from "./orb-dial.fixtures";
import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";

// Status orb stack dial (specs/status-orb-stack.md, Round 2): opening and
// stepping it by mouse, keyboard and touch. Shared dismissal across screens is
// in orb-dial.dismiss.spec.ts; the backend shim is in orb-dial.fixtures.ts.

test.describe("status orb dial", () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test.describe.configure({ mode: "serial" });

  test("tap opens the dial, drag steps, 5 s defocus, 10 s return", async ({ page }) => {
    test.setTimeout(90_000);
    seedTasks([]);
    const backend = backendFor(Date.now(), false);
    await attach(page, backend);
    await gotoDashboard(page);
    const host = orb(page);
    await expect(host).toHaveAttribute("data-orb-dial", "closed");
    // Running countdown first, then on entries in user order.
    await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "timer");
    await shot(page, "01-rest");

    await host.click();
    await expect(host).toHaveAttribute("data-orb-dial", "open");
    await page.waitForTimeout(250);
    await shot(page, "02-open");

    // One detent is 45 degrees for this four-entry stack; 65 clears it with
    // margin for the tap slop at the start of the drag, and stays under two.
    await dragAround(page, 0, 65);
    const touched = Date.now();
    await expect(host).toHaveAttribute("data-orb-dial-index", "1");
    await expect(readout(page)).toHaveAttribute("data-nova-orb-info-module", "gym");
    await page.waitForTimeout(400);
    await shot(page, "04-gym");
    await expect(readout(page).locator(".orb-event-icon")).toHaveCount(1);

    await expect(host).toHaveAttribute("data-orb-dial", "closed", { timeout: 7_000 });
    const closedAfter = Date.now() - touched;
    expect(closedAfter, `closed after ${closedAfter} ms`).toBeGreaterThan(4_500);
    await expect(host).toHaveAttribute("data-orb-dial-index", "1");
    await expect(host).toHaveAttribute("data-orb-dial-index", "0", { timeout: 7_000 });
    expect(Date.now() - touched).toBeGreaterThan(9_000);

    // Keyboard: Enter opens, arrows step, Escape closes.
    await host.focus();
    await page.keyboard.press("Enter");
    await expect(host).toHaveAttribute("data-orb-dial", "open");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(host).toHaveAttribute("data-orb-dial-index", "2");
    await page.keyboard.press("Escape");
    await expect(host).toHaveAttribute("data-orb-dial", "closed");
  });

  test("touch: a tap opens the dial and a finger drag around the orb steps it", async ({ browser }) => {
    seedTasks([]);
    const backend = backendFor(Date.now(), false);
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1366, height: 768 } });
    try {
      const page = await context.newPage();
      await attach(page, backend);
      await gotoDashboard(page);
      const host = orb(page);
      const box = (await host.boundingBox())!;
      const cdp = await context.newCDPSession(page);
      const touch = (type: string, point?: [number, number]) => cdp.send("Input.dispatchTouchEvent", {
        type, touchPoints: point ? [{ x: point[0], y: point[1], id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [],
      });
      await touch("touchStart", ringPoint(box, 0));
      await touch("touchEnd");
      await expect(host).toHaveAttribute("data-orb-dial", "open");
      await touch("touchStart", ringPoint(box, -10));
      for (let deg = -5; deg <= 100; deg += 5) await touch("touchMove", ringPoint(box, deg));
      await touch("touchEnd");
      await expect(host).toHaveAttribute("data-orb-dial-index", "2");
      await expect(host).toHaveAttribute("data-orb-dial", "open");
      await shot(page, "07-touch-index-2");
    } finally {
      await context.close();
    }
  });
});
