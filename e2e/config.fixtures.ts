// Shared probes for the configuration workspace e2e specs (config.spec.ts and
// config.trail.spec.ts). It is deliberately not a `*.spec.ts` file: Playwright
// collects those by glob, and a helper must not be collected as a spec of its own.
import { expect, type Locator, type Page } from "@playwright/test";

/** The viewport y of every matched element, so a scroll can be shown not to move them. */
export const viewportY = (locator: Locator) =>
  locator.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().y)));

/**
 * Which elements really receive a press at their own centre, with the orb-shadow
 * strip made hit-testable. Hit-testing follows paint order, so this fails when
 * anything is painted over them — where comparing computed `z-index` values
 * cannot: a z-index only orders an element against its siblings inside its own
 * stacking context, and the band sat under the strip while 110 > 90 read true.
 *
 * The injected style is taken back out afterwards, because a hit-testable strip
 * would intercept clicks meant for the page behind it.
 */
export async function paintOrderAt(page: Page, selectors: string[]) {
  await page.evaluate(() => {
    if (document.querySelector("style[data-nova-probe]")) {
      return;
    }
    const style = document.createElement("style");
    style.dataset.novaProbe = "strip-hit-testable";
    style.textContent = ".header-fade-strip { pointer-events: auto !important; }";
    document.head.append(style);
  });
  const hits = await page.evaluate((list) => {
    const hitIs = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`no ${selector} on the config page`);
      }
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && (hit === element || element.contains(hit)));
    };
    return Object.fromEntries(list.map((selector) => [selector, hitIs(selector)]));
  }, selectors);
  await page.evaluate(() => document.querySelector("style[data-nova-probe]")?.remove());
  return hits;
}

export async function openAccordion(page: Page, id: string) {
  const trigger = page.locator(`#${id} > .config-accordion-header > .config-accordion-trigger`);
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  }).toPass({ timeout: 20_000 });
}
