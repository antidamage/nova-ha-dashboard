// Shared selectors and gesture helpers for the Advanced fold e2e specs. It is
// deliberately not a `*.spec.ts` file: Playwright collects those by glob, and a
// helper must not be collected as a spec of its own.
import { expect, type CDPSession, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

export type Rect = { left: number; top: number; width: number; height: number };

export const LIGHTING = ".control-stage .zone-panel[data-lighting-zone] .advanced-fold";
export const OUTSIDE_LIGHT = ".control-stage .outside-light-card.advanced-fold";
export const WEATHER = ".control-stage .weather-panel.advanced-fold";
export const CAMERA = ".control-stage .outside-camera-panel .advanced-fold";
export const POWER = ".control-stage .power-panel.advanced-fold";
export const REMINDERS = ".tasks-stage .tasks-panel .advanced-fold";

export async function openZone(page: Page, zone: RegExp) {
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
export async function settled(fold: Locator) {
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
export async function atRest(fold: Locator) {
  await expect.poll(async () => Math.abs((await geometry(fold)).shift), { timeout: 5_000 }).toBeLessThan(0.5);
}

/** Waits for Advanced to open and the break's rubber band to finish. */
export async function opened(fold: Locator) {
  await expect.poll(async () => (await geometry(fold)).open, { timeout: 5_000 }).toBe("true");
  await atRest(fold);
}

export async function geometry(fold: Locator) {
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
export async function toBoundary(page: Page, fold: Locator) {
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
export async function pull(page: Page, fold: Locator, pixels: number, release = true) {
  const divider = await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox();
  if (!divider) throw new Error("divider not rendered");
  const x = divider.x + divider.width / 2;
  const y = divider.y + divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - pixels, { steps: 12 });
  if (release) await page.mouse.up();
}

export async function wheelOver(page: Page, fold: Locator, notches: number, delta = 100) {
  const box = await fold.boundingBox();
  if (!box) throw new Error("fold not rendered");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30);
  for (let i = 0; i < notches; i += 1) await page.mouse.wheel(0, delta);
}

export function expectSameRect(actual: Rect, expected: Rect, label: string) {
  for (const key of ["width", "height"] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${label} ${key}`).toBeLessThanOrEqual(1);
  }
}

/** Every element inside Advanced ends inside the fold's content box. */
export async function widestAdvancedOverflow(fold: Locator) {
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

/** A point inside the fold's visible box that is not on a control. */
export async function nonControlPoint(fold: Locator) {
  return fold.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);
    for (let j = 1; j < 12; j += 1) for (let i = 1; i < 12; i += 1) {
      const x = r.left + (r.width * i) / 12;
      const y = top + ((bottom - top) * j) / 12;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit) && !hit.closest("button,a,input,select,[role=slider],[role=switch],[role=button],[role=checkbox],[data-nova-no-drag-scroll],.maplibregl-map")) {
        return { x, y };
      }
    }
    return null;
  });
}

export async function touchPull(client: CDPSession, x: number, y: number, dx: number, dy: number, release = true) {
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }],
    });
  }
  if (release) await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
