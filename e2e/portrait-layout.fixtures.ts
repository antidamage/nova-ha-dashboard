// Selectors, measurements and gestures shared by the portrait dashboard e2e
// specs (portrait-layout.spec.ts and portrait-layout.fold.spec.ts). It is
// deliberately not a `*.spec.ts` file: Playwright collects those by glob, and a
// helper must not be collected as a spec of its own.
import { expect, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

export type Rect = { left: number; top: number; width: number; height: number };

export const HOME = '.horizontal-accordion[data-group="home"]';
export const SYSTEMS = '.horizontal-accordion[data-group="systems"]';
export const LIGHTING = `${HOME} .zone-panel[data-lighting-zone] .advanced-fold`;
export const OUTSIDE_LIGHT = `${SYSTEMS} .outside-light-card.advanced-fold`;
export const WEATHER = `${SYSTEMS} .weather-panel.advanced-fold`;
export const CAMERA = `${SYSTEMS} .outside-camera-panel .advanced-fold`;
export const POWER = `${SYSTEMS} .power-panel.advanced-fold`;

export async function load(page: Page) {
  await gotoDashboard(page);
  await waitForStableLayout(page);
}

export async function openSystemsZone(page: Page, zone: RegExp) {
  await selectZone(page, zone);
  await page.waitForTimeout(1200);
  // Power has no Advanced section until its first sample arrives.
  if (zone.source === "Grid") {
    await expect(page.locator(`${POWER}:not([data-foldless])`)).toHaveCount(1, { timeout: 30_000 });
    await page.waitForTimeout(300);
  }
}

export async function geometry(fold: Locator) {
  return fold.evaluate((el) => {
    const pick = (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
    const def = el.querySelector(":scope > .advanced-fold-track > .advanced-fold-default") as HTMLElement;
    const divider = el.querySelector(":scope > .advanced-fold-track > .advanced-fold-divider") as HTMLElement;
    return {
      open: el.dataset.open,
      rect: pick(el.getBoundingClientRect()),
      // Layout box, independent of the scroll offset and the band's transform.
      defaultSize: { width: def.offsetWidth, height: def.offsetHeight },
      divider: pick(divider.getBoundingClientRect()),
      offset: el.scrollLeft,
    };
  });
}

/** Elements inside Advanced ending below the fold's bottom content edge (clipping counted). */
export async function belowTheFold(fold: Locator) {
  return fold.evaluate((el) => {
    const style = getComputedStyle(el);
    const bottom = el.getBoundingClientRect().bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
    const advanced = el.querySelector(":scope > .advanced-fold-track > .advanced-fold-advanced");
    if (!advanced) return ["advanced region not mounted"];
    const offenders: string[] = [];
    for (const node of advanced.querySelectorAll<HTMLElement>("*")) {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      let clip = Infinity;
      for (let up = node.parentElement; up && up !== advanced.parentElement; up = up.parentElement) {
        if (getComputedStyle(up).overflowY !== "visible") clip = Math.min(clip, up.getBoundingClientRect().bottom);
      }
      if (Math.min(r.bottom, clip) > bottom + 1) {
        offenders.push(`${node.tagName.toLowerCase()}.${String(node.className).split(" ").slice(0, 2).join(".")} ${Math.round(r.bottom)}>${Math.round(bottom)}`);
      }
    }
    return offenders.slice(0, 5);
  });
}

/** A leftward mouse drag toward Advanced, starting on the divider (which owns no drag). */
export async function pull(page: Page, fold: Locator, pixels: number) {
  await fold.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(150);
  const divider = await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox();
  if (!divider) throw new Error("divider not rendered");
  const x = divider.x + divider.width / 2;
  const y = divider.y + divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - pixels, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

export function expectSame(actual: Rect, expected: Rect, label: string) {
  for (const key of ["left", "top", "width", "height"] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${label} ${key}`).toBeLessThanOrEqual(1);
  }
}

export async function noSidewaysOverflow(page: Page) {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(innerWidth);
}
