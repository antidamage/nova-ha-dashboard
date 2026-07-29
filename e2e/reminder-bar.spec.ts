import { expect, test, type Page } from "@playwright/test";

import { gotoDashboard } from "./helpers";

// Driven off the demo provider's reminder fixtures
// (nova-dummy-data-provider/public/api/{tasks,reminder-icons}.json), which is
// how the rest of the suite works — the e2e server runs the static demo build,
// so there are no real API routes to seed through.
//
// "Take estrogen" is the archetype: an end-less daily reminder carrying a text
// glyph, which is the only shape that can actually go overdue (a repeating
// local task WITH an end rolls itself forward instead).
const DUE_REMINDER = "Take estrogen";

function tile(page: Page, name: string) {
  return page.locator(`.reminder-tile[aria-label^="${name}"]`);
}

test.describe("reminder icon bar", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
  });

  test("sits between the clock and the zones panel", async ({ page }) => {
    await expect(page.locator(".reminder-icon-bar")).toBeVisible();

    const order = await page.evaluate(() => {
      const wanted = ["clock-panel", "reminder-icon-bar", "zones-panel"];
      return Array.from(document.querySelectorAll(".clock-panel, .reminder-icon-bar, .zones-panel"))
        .map((node) => wanted.find((name) => node.classList.contains(name)))
        .filter(Boolean);
    });

    expect(order).toEqual(["clock-panel", "reminder-icon-bar", "zones-panel"]);
  });

  // In wide landscape the bar moves out of the full-width row and into the
  // sidebar column: centred under the status orb, sitting on the zones menu.
  test("in wide landscape it centres over the sidebar, under the orb and above the menu", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".reminder-icon-bar")).toBeVisible();

    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => {
        const node = document.querySelector(selector);
        return node ? node.getBoundingClientRect().toJSON() : null;
      };
      return {
        bar: rect(".reminder-icon-bar"),
        zones: rect(".zones-panel"),
        orb: rect(".nova-avatar-host"),
      };
    });

    expect(boxes.bar).not.toBeNull();
    expect(boxes.zones).not.toBeNull();

    // Confined to the sidebar column, and centred on it.
    expect(boxes.bar!.right).toBeLessThanOrEqual(boxes.zones!.right + 1);
    expect(Math.abs(
      (boxes.bar!.left + boxes.bar!.right) / 2 - (boxes.zones!.left + boxes.zones!.right) / 2,
    )).toBeLessThan(2);

    // Above the menu.
    expect(boxes.bar!.bottom).toBeLessThanOrEqual(boxes.zones!.top + 1);

    // Below the orb, not behind it. Deliberately measured against the orb's
    // vertical midpoint rather than its box bottom: `.nova-avatar-host` is the
    // full canvas render box and the visible disc floats inside it with
    // transparent margin, so requiring clearance of the box would reserve dead
    // space the art does not occupy.
    if (boxes.orb) {
      expect(boxes.bar!.top).toBeGreaterThan(boxes.orb.top + boxes.orb.height / 2);
    }
  });

  test("renders one tile per roster entry that is in the bar", async ({ page }) => {
    // Five of the six fixture entries are in the bar; "Project stand-up" is
    // deliberately out, to prove showInBar is honoured.
    await expect(page.locator(".reminder-tile")).toHaveCount(5);
    await expect(tile(page, "Project stand-up")).toHaveCount(0);
  });

  test("keeps a tile when nothing is due, dimmed rather than removed", async ({ page }) => {
    const idle = page.locator('.reminder-tile[data-state="idle"]').first();
    await expect(idle).toBeVisible();
    await expect(idle).toHaveAccessibleName(/nothing due$/);

    // Dimmed, not hidden: this is the "fixed furniture" property of the row.
    const opacity = await idle.evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(opacity)).toBeLessThan(1);
  });

  test("renders a text glyph for a reminder that is a letter", async ({ page }) => {
    await expect(tile(page, DUE_REMINDER).locator(".reminder-glyph-text")).toHaveText("E");
  });

  test("lights a tile whose reminder is due, and tapping completes it", async ({ page }) => {
    const target = tile(page, DUE_REMINDER);
    await expect(target).toHaveAttribute("data-state", "due");
    await expect(target).toHaveCSS("opacity", "1");

    await target.click();
    await expect(target).toHaveAttribute("data-undoable", "true");
    await expect(target).toHaveAccessibleName(/completed, hold to undo$/);
  });

  test("holding a completed tile restores the reminder", async ({ page }) => {
    const target = tile(page, DUE_REMINDER);
    await target.click();
    await expect(target).toHaveAttribute("data-undoable", "true");

    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    // Past undoHoldMs (2s), with headroom for the round trip.
    await page.waitForTimeout(2_600);
    await page.mouse.up();

    await expect(target).not.toHaveAttribute("data-undoable", "true");
    await expect(target).toHaveAttribute("data-state", "due");
  });

  test("a brief tap does not trigger the undo", async ({ page }) => {
    const target = tile(page, DUE_REMINDER);
    await target.click();
    await expect(target).toHaveAttribute("data-undoable", "true");

    // Well under the hold threshold: the completion must stand.
    const box = await target.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.up();

    await expect(target).toHaveAttribute("data-undoable", "true");
  });

  test("banners stay off by default while the bar still works", async ({ page }) => {
    await expect(page.locator(".current-task-bar")).toHaveCount(0);
    await expect(page.locator(".task-alert-overlay")).toHaveCount(0);
    await expect(page.locator(".reminder-tile").first()).toBeVisible();
  });
});

test.describe("reminder banners opt-in", () => {
  test("the bottom bar appears once the per-device switch is on", async ({ page }) => {
    await gotoDashboard(page, { neutralizeAlerts: false, reminderBanners: true });
    await expect(page.locator(".current-task-bar")).toBeVisible();
  });
});
