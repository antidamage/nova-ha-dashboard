/**
 * Reading the login page: input locators and the authenticated-state poll.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */



export async function clickNamedButton(page, names) {
  for (const name of names) {
    const button = page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).first();
    if ((await button.count().catch(() => 0)) > 0) {
      await button.click();
      return true;
    }
  }
  return false;
}

export async function pageLooksAuthenticated(page, template) {
  if (!page.url().includes("/dashboard")) {
    return false;
  }
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (text.includes("more power to you") || text.includes("join powershop")) {
    return false;
  }
  if ((template.login.mfaTextPatterns ?? []).some((pattern) => text.includes(String(pattern).toLowerCase()))) {
    return false;
  }
  const loginButtons = await page.getByRole("button", { name: /^log in$/i }).count().catch(() => 0);
  return loginButtons === 0;
}

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
}

export async function findEmailInput(page, template) {
  const byRole = page.getByRole("textbox", { name: /email/i }).first();
  if ((await byRole.count().catch(() => 0)) > 0 && (await byRole.isVisible().catch(() => false))) {
    return byRole;
  }
  return firstVisibleLocator(page, template.login.emailSelectors);
}

export async function findPasswordInput(page, template) {
  const byRole = page.getByRole("textbox", { name: /password/i }).first();
  if ((await byRole.count().catch(() => 0)) > 0 && (await byRole.isVisible().catch(() => false))) {
    return byRole;
  }
  return firstVisibleLocator(page, template.login.passwordSelectors);
}

export async function findLoginCodeInput(page) {
  for (const pattern of [/login code/i, /verification code/i, /code/i]) {
    const byRole = page.getByRole("textbox", { name: pattern }).first();
    if ((await byRole.count().catch(() => 0)) > 0 && (await byRole.isVisible().catch(() => false))) {
      return byRole;
    }
  }
  const numericInput = page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"], input[placeholder="000000"]').first();
  if ((await numericInput.count().catch(() => 0)) > 0 && (await numericInput.isVisible().catch(() => false))) {
    return numericInput;
  }
  return null;
}

/**
 * Poll `pageLooksAuthenticated` until it agrees or the budget runs out.
 *
 * The dashboard is a slow SPA and the check reads rendered text, so a single
 * fixed sleep after `domcontentloaded` is a race: it decides "not logged in"
 * whenever the shell has not painted yet. That misfired on four consecutive
 * overnight runs (2026-08-16..19), and because a valid session makes
 * `/login` bounce straight back to `/dashboard`, the fallback then reported
 * "login email field was not found" — an authenticated page, not a broken one.
 */
export async function waitForAuthenticated(page, template, budgetMs) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (await pageLooksAuthenticated(page, template)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await page.waitForTimeout(1000);
  }
}
