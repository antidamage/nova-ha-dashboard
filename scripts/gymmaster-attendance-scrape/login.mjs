/**
 * The GymMaster portal login sequence.
 *
 * Moved verbatim from `scripts/gymmaster-attendance-scrape.mjs`, which stays
 * the entry point (`node /app/scripts/gymmaster-attendance-scrape.mjs`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { LOGIN_TIMEOUT_MS, PAGE_TIMEOUT_MS } from "./constants.mjs";

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
}

async function pageLooksAuthenticated(page) {
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const loginInputs = await page.locator('input[name="email"], input[name="password"]').count().catch(() => 0);
  if (
    page.url().includes("/portal/login")
    || loginInputs > 0
    || text.includes("member log in")
    || text.includes("must be logged in")
    || text.includes("invalid email or password")
  ) {
    return false;
  }
  return true;
}

export async function ensureLoggedIn(page, context, portalUrl, storagePath, email, password) {
  await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(1000);
  if (await pageLooksAuthenticated(page)) {
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await context.storageState({ path: storagePath });
    return "session";
  }

  const loginUrl = new URL("/portal/login", portalUrl).toString();
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);

  const emailInput = await firstVisibleLocator(page, ['input[name="email"]', 'input[type="email"]']);
  const passwordInput = await firstVisibleLocator(page, ['input[name="password"]', 'input[type="password"]']);
  if (!emailInput || !passwordInput) {
    const error = new Error("GymMaster login fields were not found.");
    error.code = "requires_interaction";
    throw error;
  }

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await Promise.all([
    page.waitForNavigation({ timeout: LOGIN_TIMEOUT_MS }).catch(() => null),
    page.locator('button[type="submit"], input[type="submit"]').first().click(),
  ]);
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(1500);

  const loginText = await page.locator("body").innerText().catch(() => "");
  if (/invalid email or password/i.test(loginText)) {
    const error = new Error("GymMaster login failed: invalid email or password.");
    error.code = "requires_login";
    throw error;
  }

  await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(1500);
  if (!(await pageLooksAuthenticated(page))) {
    const error = new Error("GymMaster login did not reach the visit history page.");
    error.code = "requires_interaction";
    throw error;
  }

  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await context.storageState({ path: storagePath });
  return "login";
}
