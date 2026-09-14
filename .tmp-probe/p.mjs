import { chromium } from "@playwright/test";
const url = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(process.argv[4]||430), height: Number(process.argv[5]||932) }, isMobile: true, hasTouch: true });
await page.addInitScript(() => { if (!localStorage.getItem("nova.dashboard.experienceMode.v1")) localStorage.setItem("nova.dashboard.experienceMode.v1", "rich"); });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const acc = [...document.querySelectorAll(".horizontal-accordion")].map((a) => ({ group: a.dataset.group, open: a.dataset.open, rect: a.getBoundingClientRect().height, display: getComputedStyle(a).display, contentHidden: a.querySelector(".horizontal-accordion-content")?.hidden, buttons: [...a.querySelectorAll(".zone-button")].map((b) => b.textContent.trim().slice(0, 20) + ":" + Math.round(b.getBoundingClientRect().height)) }));
  return { title: document.title, acc, url: location.href, hasZones: !!document.querySelector(".zones-panel") };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: process.argv[3], fullPage: true });
await browser.close();
