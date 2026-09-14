import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

// The Advanced fold in landscape (specs/advanced-fold.md, "Done means"): the
// size lock, the 80px rubber band by mouse and wheel, re-locking, independent
// sub-panel scrolling, and the page's own pan still working over the folds.

// The dashboard renders at a handful of frames a second in headless Chromium
// under three workers, and every mouse step waits for a frame: the default 45s
// is not enough for a test that loads, settles and drags.
test.describe.configure({ timeout: 120_000 });

type Rect = { left: number; top: number; width: number; height: number };

const LIGHTING = ".control-stage .zone-panel[data-lighting-zone] .advanced-fold";
const OUTSIDE_LIGHT = ".control-stage .outside-light-card.advanced-fold";
const WEATHER = ".control-stage .weather-panel.advanced-fold";
const CAMERA = ".control-stage .outside-camera-panel .advanced-fold";
const POWER = ".control-stage .power-panel.advanced-fold";
const REMINDERS = ".tasks-stage .tasks-panel .advanced-fold";

async function openZone(page: Page, zone: RegExp) {
  await gotoDashboard(page);
  await waitForStableLayout(page);
  await selectZone(page, zone);
  const stage = zone.source === "Reminders" ? ".tasks-stage" : ".control-stage:not(.tasks-stage)";
  const folds = page.locator(`${stage} .advanced-fold:not([data-foldless])`);
  await expect(folds.first()).toBeVisible({ timeout: 30_000 });
  // Power has no Advanced section until its first sample arrives, which takes
  // a poll or two in the demo.
  if (zone.source === "Grid") {
    await expect(page.locator(`${POWER}:not([data-foldless])`)).toHaveCount(1, { timeout: 30_000 });
  }
  for (let index = 0; index < (await folds.count()); index += 1) await settled(folds.nth(index));
}

/** Waits until a fold's scroll size, client size and floor read the same twice running. */
async function settled(fold: Locator) {
  let last = "";
  await expect.poll(async () => {
    const now = await fold.evaluate((el) => [
      el.scrollHeight,
      el.clientHeight,
      el.getBoundingClientRect().left,
      el.style.getPropertyValue("--advanced-fold-default-min"),
    ].join("|"));
    const same = now === last;
    last = now;
    return same;
  }, { timeout: 20_000, intervals: [250] }).toBe(true);
}

/** Waits for the band to come to rest: no transform left on the track. */
async function atRest(fold: Locator) {
  await expect.poll(async () => Math.abs((await geometry(fold)).shift), { timeout: 5_000 }).toBeLessThan(0.5);
}

/** Waits for Advanced to open and the break's rubber band to finish. */
async function opened(fold: Locator) {
  await expect.poll(async () => (await geometry(fold)).open, { timeout: 5_000 }).toBe("true");
  await atRest(fold);
}

async function geometry(fold: Locator) {
  return fold.evaluate((el) => {
    const pick = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });
    const track = el.querySelector(":scope > .advanced-fold-track") as HTMLElement | null;
    const def = el.querySelector(":scope > .advanced-fold-track > .advanced-fold-default") as HTMLElement;
    const divider = el.querySelector(":scope > .advanced-fold-track > .advanced-fold-divider") as HTMLElement;
    const transform = track ? getComputedStyle(track).transform : "none";
    const shift = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
    return {
      open: el.dataset.open,
      rect: pick(el.getBoundingClientRect()),
      // Layout position, independent of the band's transform and the offset.
      defaultSize: { width: def.offsetWidth, height: def.offsetHeight },
      divider: pick(divider.getBoundingClientRect()),
      offset: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
      shift,
    };
  });
}

/** Put the fold on its boundary and in view. */
async function toBoundary(page: Page, fold: Locator) {
  await fold.evaluate((el) => {
    el.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" });
    el.scrollTop = el.scrollHeight;
  });
  // touch-action is set once the scroll event has told the fold it is locked.
  await expect.poll(() => fold.evaluate((el) =>
    el.dataset.open === "false" &&
    el.scrollTop >= el.scrollHeight - el.clientHeight - 1 &&
    el.style.touchAction === "pan-x")).toBe(true);
  await atRest(fold);
}

/** A mouse drag toward Advanced that starts on the divider, which owns no drag. */
async function pull(page: Page, fold: Locator, pixels: number, release = true) {
  const divider = await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox();
  if (!divider) throw new Error("divider not rendered");
  const x = divider.x + divider.width / 2;
  const y = divider.y + divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - pixels, { steps: 12 });
  if (release) await page.mouse.up();
}

async function wheelOver(page: Page, fold: Locator, notches: number, delta = 100) {
  const box = await fold.boundingBox();
  if (!box) throw new Error("fold not rendered");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30);
  for (let i = 0; i < notches; i += 1) await page.mouse.wheel(0, delta);
}

function expectSameRect(actual: Rect, expected: Rect, label: string) {
  for (const key of ["width", "height"] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${label} ${key}`).toBeLessThanOrEqual(1);
  }
}

/** Every element inside Advanced ends inside the fold's content box. */
async function widestAdvancedOverflow(fold: Locator) {
  return fold.evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const right = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    const advanced = el.querySelector(":scope > .advanced-fold-track > .advanced-fold-advanced");
    if (!advanced) return ["advanced region not mounted"];
    const offenders: string[] = [];
    for (const node of advanced.querySelectorAll<HTMLElement>("*")) {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // Content clipped by an overflow-hiding ancestor inside Advanced is not wider.
      let clipRight = Infinity;
      for (let up = node.parentElement; up && up !== advanced; up = up.parentElement) {
        if (getComputedStyle(up).overflowX !== "visible") clipRight = Math.min(clipRight, up.getBoundingClientRect().right);
      }
      if (Math.min(r.right, clipRight) > right + 1) {
        offenders.push(`${node.tagName.toLowerCase()}.${String(node.className).split(" ").slice(0, 2).join(".")} ${Math.round(r.right)}>${Math.round(right)}`);
      }
    }
    return offenders.slice(0, 5);
  });
}

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]) {
  test.describe(`advanced fold, landscape ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const { zone, folds } of [
      { zone: /Lounge/, folds: [LIGHTING] },
      { zone: /Outside/, folds: [OUTSIDE_LIGHT, WEATHER, CAMERA] },
      { zone: /Grid/, folds: [POWER] },
    ]) {
      test(`${zone.source}: opening Advanced changes no size, and Advanced fits the sub-panel`, async ({ page }) => {
        // Three sub-panels, each measured closed and open, after a cold compile.
        test.setTimeout(120_000);
        await openZone(page, zone);
        for (const selector of folds) {
          const fold = page.locator(selector);
          await expect(fold, selector).toHaveCount(1);
          await toBoundary(page, fold);
          const closed = await geometry(fold);
          expect(closed.open, selector).toBe("false");

          // Closed, the divider is inside the sub-panel on both axes.
          expect(closed.divider.left, `${selector} divider left`).toBeGreaterThanOrEqual(closed.rect.left - 0.5);
          expect(closed.divider.left + closed.divider.width).toBeLessThanOrEqual(closed.rect.left + closed.rect.width + 0.5);
          expect(closed.divider.top, `${selector} divider top`).toBeGreaterThanOrEqual(closed.rect.top - 0.5);
          expect(closed.divider.top + closed.divider.height, `${selector} divider bottom`)
            .toBeLessThanOrEqual(closed.rect.top + closed.rect.height + 0.5);

          await pull(page, fold, 120);
          await opened(fold);
          const open = await geometry(fold);
          expectSameRect(open.rect, closed.rect, `${selector} sub-panel`);
          expectSameRect(
            { left: 0, top: 0, ...open.defaultSize },
            { left: 0, top: 0, ...closed.defaultSize },
            `${selector} default area`,
          );
          expect(await widestAdvancedOverflow(fold), `${selector} Advanced wider than the sub-panel`).toEqual([]);
        }
      });
    }

    test("a 60px pull resists and springs back; a 100px pull opens on the 1:1 offset", async ({ page }) => {
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await toBoundary(page, fold);
      const boundary = (await geometry(fold)).offset;

      await pull(page, fold, 60, false);
      const held = await geometry(fold);
      expect(held.open).toBe("false");
      expect(Math.abs(held.shift)).toBeGreaterThan(5);
      expect(Math.abs(held.shift)).toBeLessThan(28);
      await page.mouse.up();
      await atRest(fold);
      const rested = await geometry(fold);
      expect(rested.open).toBe("false");
      expect(Math.abs(rested.shift)).toBeLessThan(0.5);
      expect(Math.abs(rested.offset - boundary)).toBeLessThanOrEqual(1);

      await pull(page, fold, 100);
      await opened(fold);
      const open = await geometry(fold);
      expect(Math.abs(open.offset - Math.min(boundary + 100, open.max))).toBeLessThanOrEqual(4);
    });

    test("wheel: three 100px notches stay closed, four open", async ({ page }) => {
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await toBoundary(page, fold);
      const boundary = (await geometry(fold)).offset;

      await wheelOver(page, fold, 3);
      expect((await geometry(fold)).open).toBe("false");
      // The pull decays after 400ms of stillness and the band springs back.
      await atRest(fold);
      expect((await geometry(fold)).open).toBe("false");

      await wheelOver(page, fold, 4);
      await opened(fold);
      const open = await geometry(fold);
      expect(Math.abs(open.offset - Math.min(boundary + 100, open.max))).toBeLessThanOrEqual(4);
    });

    test("scrolling back to the boundary closes Advanced, and the next pull resists", async ({ page }) => {
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await toBoundary(page, fold);
      const closed = await geometry(fold);

      await pull(page, fold, 100);
      await opened(fold);

      // Back by mouse drag, which the fold drives: well past the boundary.
      const box = (await fold.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 60);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 60 + 150, { steps: 12 });
      await page.mouse.up();
      await expect.poll(async () => (await geometry(fold)).open).toBe("false");
      const back = await geometry(fold);
      expectSameRect({ left: 0, top: 0, ...back.defaultSize }, { left: 0, top: 0, ...closed.defaultSize }, "default area");

      await toBoundary(page, fold);
      await pull(page, fold, 40, false);
      const again = await geometry(fold);
      expect(again.open).toBe("false");
      expect(Math.abs(again.shift)).toBeGreaterThan(5);
      await page.mouse.up();
    });

    test("Power's default view scrolls freely and the band engages only at its end", async ({ page }) => {
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await fold.evaluate((el) => el.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" }));
      const start = await geometry(fold);
      if (viewport.height <= 768) expect(start.max, "Power taller than its column").toBeGreaterThan(0);
      test.skip(start.max <= 0, "Power's default view fits this column");

      // Wheel down from the top: native scrolling through the default view.
      await wheelOver(page, fold, Math.ceil(start.max / 100) + 1);
      await expect.poll(async () => Math.abs((await geometry(fold)).offset - start.max)).toBeLessThanOrEqual(1);
      await atRest(fold);
      expect((await geometry(fold)).open).toBe("false");

      await pull(page, fold, 100);
      await opened(fold);

      await fold.evaluate((el, boundary) => {
        el.scrollTop = boundary;
      }, start.max);
      await expect.poll(async () => (await geometry(fold)).open).toBe("false");
    });

    test("scrolling one of Outside's sub-panels by wheel and drag leaves the others where they were", async ({ page }) => {
      await openZone(page, /Outside/);
      const weather = page.locator(WEATHER);
      const others = [page.locator(OUTSIDE_LIGHT), page.locator(CAMERA)];
      await toBoundary(page, weather);
      await pull(page, weather, 100);
      await opened(weather);
      const before = await Promise.all(others.map((fold) => geometry(fold)));
      const start = (await geometry(weather)).offset;
      expect(start, "weather opened past its boundary").toBeGreaterThan(20);

      // A real wheel over the open weather panel scrolls it natively, back up.
      const box = (await weather.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -20);
      await expect.poll(async () => (await geometry(weather)).offset).toBeLessThan(start - 10);
      let after = await Promise.all(others.map((fold) => geometry(fold)));
      after.forEach((g, index) => expect(g.offset, `sub-panel ${index} after wheel`).toBe(before[index].offset));

      // A real mouse drag over it, which the fold drives, forward again.
      const wheeled = (await geometry(weather)).offset;
      const x = box.x + box.width / 2;
      await page.mouse.move(x, box.y + box.height - 40);
      await page.mouse.down();
      await page.mouse.move(x, box.y + box.height - 40 - 30, { steps: 6 });
      await page.mouse.up();
      await expect.poll(async () => (await geometry(weather)).offset).toBeGreaterThan(wheeled + 10);
      after = await Promise.all(others.map((fold) => geometry(fold)));
      after.forEach((g, index) => expect(g.offset, `sub-panel ${index} after drag`).toBe(before[index].offset));
    });

    test("a drag starting on a knob does not pull", async ({ page }) => {
      await openZone(page, /Outside/);
      const fold = page.locator(OUTSIDE_LIGHT);
      await toBoundary(page, fold);
      const knob = fold.locator('[role="slider"]').first();
      const box = (await knob.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 120, { steps: 12 });
      const during = await geometry(fold);
      await page.mouse.up();
      expect(during.open).toBe("false");
      expect(Math.abs(during.shift)).toBeLessThan(0.5);
      expect((await geometry(fold)).open).toBe("false");

      // A knob's toggle ring (role="switch") owns its drag too. The demo's
      // Outside light has none, so one is placed in the default view.
      await fold.evaluate((el) => {
        const ring = document.createElement("div");
        ring.setAttribute("role", "switch");
        ring.setAttribute("aria-checked", "false");
        ring.setAttribute("aria-label", "Test ring");
        ring.style.cssText = "width:80px;height:80px;flex:none";
        el.querySelector(".advanced-fold-default")!.appendChild(ring);
      });
      await toBoundary(page, fold);
      const ring = (await fold.getByRole("switch", { name: "Test ring" }).boundingBox())!;
      await page.mouse.move(ring.x + ring.width / 2, ring.y + ring.height / 2);
      await page.mouse.down();
      await page.mouse.move(ring.x + ring.width / 2, ring.y + ring.height / 2 - 120, { steps: 12 });
      const ringDuring = await geometry(fold);
      await page.mouse.up();
      expect(ringDuring.open).toBe("false");
      expect(Math.abs(ringDuring.shift)).toBeLessThan(0.5);
    });

    test("the page's drag-pan and wheel-pan still move the page over a fold", async ({ page }) => {
      await openZone(page, /Outside/);
      const fold = page.locator(WEATHER);
      await toBoundary(page, fold);
      const box = (await fold.boundingBox())!;

      const startX = await page.evaluate(() => window.scrollX);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 });
      await page.mouse.up();
      const dragged = await page.evaluate(() => window.scrollX);
      expect(Math.abs(dragged - startX), "drag pans the page").toBeGreaterThan(50);

      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(200, 0);
      await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollX)) - dragged), {
        message: "sideways wheel pans the page",
      }).toBeGreaterThan(50);
      expect((await geometry(fold)).open).toBe("false");
    });

    test("with reduced motion the break lands on the 1:1 position without animating", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await toBoundary(page, fold);
      const boundary = (await geometry(fold)).offset;
      await pull(page, fold, 100);
      const opened = await geometry(fold);
      expect(opened.open).toBe("true");
      expect(Math.abs(opened.shift)).toBeLessThan(0.5);
      expect(Math.abs(opened.offset - Math.min(boundary + 100, opened.max))).toBeLessThanOrEqual(4);
    });

    test("choosing another zone and coming back shows the fold closed; so does a reload", async ({ page }) => {
      await openZone(page, /Lounge/);
      const fold = page.locator(LIGHTING);
      await toBoundary(page, fold);
      await pull(page, fold, 120);
      await opened(fold);

      // Mark this zone's fold, so each switch can wait for a new one to mount.
      const mark = (value: string) => page.locator(LIGHTING).evaluate((el, v) => {
        el.dataset.testMark = v;
      }, value);
      await mark("lounge");
      await selectZone(page, /Kitchen/);
      await expect(page.locator(`${LIGHTING}[data-test-mark]`)).toHaveCount(0);
      await expect(page.locator(LIGHTING)).toHaveCount(1);
      await mark("kitchen");
      await selectZone(page, /Lounge/);
      await expect(page.locator(`${LIGHTING}[data-test-mark]`)).toHaveCount(0);
      await expect(page.locator(LIGHTING)).toHaveCount(1);
      expect((await geometry(page.locator(LIGHTING))).open).toBe("false");

      await settled(page.locator(LIGHTING));
      await toBoundary(page, page.locator(LIGHTING));
      await pull(page, page.locator(LIGHTING), 120);
      await opened(page.locator(LIGHTING));
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(LIGHTING)).toHaveCount(1, { timeout: 30_000 });
      expect((await geometry(page.locator(LIGHTING))).open).toBe("false");
    });
  });
}

test.describe("advanced fold, landscape 1366x768: Reminders", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test("the Reminders fold has a definite height and opens with the 80px band", async ({ page }) => {
    await openZone(page, /Reminders/);
    const fold = page.locator(REMINDERS);
    await expect(fold).toHaveCount(1);
    const header = await page.locator(".tasks-stage .tasks-panel > header").boundingBox();
    const panel = await page.locator(".tasks-stage .tasks-panel").boundingBox();
    await toBoundary(page, fold);
    const closed = await geometry(fold);
    // It fills the column below the panel's header, not merely its content.
    expect(closed.rect.height, "fold height").toBeGreaterThan(200);
    expect(closed.rect.top).toBeGreaterThan(header!.y + header!.height - 1);
    expect(closed.divider.top + closed.divider.height).toBeLessThanOrEqual(closed.rect.top + closed.rect.height + 0.5);
    expect(closed.rect.top + closed.rect.height).toBeLessThanOrEqual(panel!.y + panel!.height + 0.5);

    await pull(page, fold, 60, false);
    const held = await geometry(fold);
    expect(held.open).toBe("false");
    expect(Math.abs(held.shift)).toBeGreaterThan(5);
    await page.mouse.up();
    await atRest(fold);
    expect((await geometry(fold)).open).toBe("false");

    await pull(page, fold, 100);
    await opened(fold);
    const open = await geometry(fold);
    expectSameRect(open.rect, closed.rect, "Reminders sub-panel");
    expectSameRect({ left: 0, top: 0, ...open.defaultSize }, { left: 0, top: 0, ...closed.defaultSize }, "Reminders default area");
  });

  test("a fold sized by its content does not ratchet its default area taller", async ({ page }) => {
    await openZone(page, /Reminders/);
    const fold = page.locator(REMINDERS);
    // Take the definite height away, so the fold's size comes from its content.
    await fold.evaluate((el) => {
      (el.parentElement as HTMLElement).style.display = "block";
      el.style.height = "auto";
      el.style.flex = "none";
    });
    await settled(fold);
    const defaultHeight = () => fold.evaluate((el) =>
      (el.querySelector(":scope > .advanced-fold-track > .advanced-fold-default") as HTMLElement).offsetHeight);
    const original = await defaultHeight();

    await fold.evaluate((el) => {
      const filler = document.createElement("div");
      filler.dataset.testFiller = "true";
      filler.style.cssText = "height:900px;flex:none";
      el.querySelector(".advanced-fold-default")!.appendChild(filler);
    });
    await expect.poll(defaultHeight).toBeGreaterThanOrEqual(900);
    await fold.evaluate((el) => el.querySelector("[data-test-filler]")!.remove());
    await expect.poll(async () => Math.abs((await defaultHeight()) - original)).toBeLessThanOrEqual(1);
    await settled(fold);
    expect(Math.abs((await defaultHeight()) - original)).toBeLessThanOrEqual(1);
  });
});

test.describe("advanced fold, landscape 1366x768: touch", () => {
  test.use({ viewport: { width: 1366, height: 768 }, hasTouch: true });

  async function touchPull(client: CDPSession, x: number, y: number, pixels: number, release = true) {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - (pixels * i) / steps }],
      });
    }
    if (release) await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  test("a 60px touch pull stays closed and springs back; a 100px pull opens", async ({ page }) => {
    await openZone(page, /Lounge/);
    const fold = page.locator(LIGHTING);
    await toBoundary(page, fold);
    const boundary = (await geometry(fold)).offset;
    const client = await page.context().newCDPSession(page);
    const divider = (await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox())!;
    const x = divider.x + divider.width / 2;
    const y = divider.y + divider.height / 2;

    await touchPull(client, x, y, 60, false);
    const held = await geometry(fold);
    expect(held.open).toBe("false");
    expect(Math.abs(held.shift)).toBeGreaterThan(5);
    expect(Math.abs(held.shift)).toBeLessThan(28);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await atRest(fold);
    const rested = await geometry(fold);
    expect(rested.open).toBe("false");
    expect(Math.abs(rested.offset - boundary)).toBeLessThanOrEqual(1);

    await touchPull(client, x, y, 100);
    await opened(fold);
    const open = await geometry(fold);
    expect(Math.abs(open.offset - Math.min(boundary + 100, open.max))).toBeLessThanOrEqual(4);
  });
});
