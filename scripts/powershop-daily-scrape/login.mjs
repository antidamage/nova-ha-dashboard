/**
 * Resolving a login code, and the login sequence itself.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */

import readline from "node:readline/promises";
import { argValue, hasArg, normalizeLoginCode, positiveInteger } from "./cli.mjs";
import { AUTH_SETTLE_TIMEOUT_MS, DEFAULT_LOGIN_CODE_TIMEOUT_MS, LOGIN_TIMEOUT_MS, PAGE_TIMEOUT_MS } from "./constants.mjs";
import { clickNamedButton, findEmailInput, findLoginCodeInput, findPasswordInput, pageLooksAuthenticated, waitForAuthenticated } from "./page-auth.mjs";
import { consumeLoginCodeFile, saveStorageState, waitForLoginCodeFile } from "./store.mjs";

async function promptLoginCode(timeoutMs) {
  if (!process.stdin.isTTY) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return normalizeLoginCode(await rl.question("Enter Powershop login code for this active session: ", { signal: controller.signal }));
  } catch (error) {
    if (error?.name === "AbortError") {
      return null;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    rl.close();
  }
}

async function resolveLoginCode() {
  const directCode = normalizeLoginCode(argValue("--login-code") ?? process.env.POWERSHOP_LOGIN_CODE);
  if (directCode) {
    return directCode;
  }

  const loginCodeFile = argValue("--login-code-file") ?? process.env.POWERSHOP_LOGIN_CODE_FILE;
  if (loginCodeFile) {
    const fileCode = await consumeLoginCodeFile(loginCodeFile);
    if (fileCode) {
      return fileCode;
    }
  }

  const shouldWait = hasArg("--wait-for-login-code") || process.env.POWERSHOP_WAIT_FOR_LOGIN_CODE === "1";
  if (!shouldWait) {
    return null;
  }

  const timeoutMs = positiveInteger(
    argValue("--login-code-timeout-ms") ?? process.env.POWERSHOP_LOGIN_CODE_TIMEOUT_MS,
    DEFAULT_LOGIN_CODE_TIMEOUT_MS,
  );
  if (loginCodeFile) {
    console.error(`Waiting up to ${Math.round(timeoutMs / 1000)}s for Powershop login code in ${loginCodeFile}...`);
    return waitForLoginCodeFile(loginCodeFile, timeoutMs);
  }

  if (process.stdin.isTTY) {
    return promptLoginCode(timeoutMs);
  }

  console.error("Powershop login code wait requested, but stdin is not interactive and no --login-code-file was provided.");
  return null;
}

export async function ensureLoggedIn(page, context, template, storagePath, email, password) {
  await page.goto("https://app.powershop.nz/dashboard", { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  if (await waitForAuthenticated(page, template, AUTH_SETTLE_TIMEOUT_MS)) {
    await saveStorageState(context, storagePath);
    return "session";
  }

  await page.goto(template.login.url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(4000);
  const emailInput = await findEmailInput(page, template);
  if (!emailInput) {
    // No email field can mean the session was live all along: Powershop
    // redirects an authenticated /login back to /dashboard. Check before
    // calling it a failure, so a slow paint never costs a night of data.
    if (await waitForAuthenticated(page, template, AUTH_SETTLE_TIMEOUT_MS)) {
      await saveStorageState(context, storagePath);
      return "session";
    }
    throw new Error("Powershop login email field was not found.");
  }
  await emailInput.fill(email);
  await clickNamedButton(page, template.login.continueButtonNames);
  await page.waitForTimeout(2500);

  const passwordInput = await findPasswordInput(page, template);
  if (passwordInput) {
    await passwordInput.fill(password);
    await clickNamedButton(page, template.login.continueButtonNames);
  }

  await page.waitForTimeout(4000);
  const pageText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if ((template.login.mfaTextPatterns ?? []).some((pattern) => pageText.includes(String(pattern).toLowerCase()))) {
    const loginCode = await resolveLoginCode();
    if (!loginCode) {
      const error = new Error("Powershop login requires the temporary login code sent by email.");
      error.code = "requires_mfa";
      throw error;
    }
    if (/^https?:\/\//i.test(loginCode)) {
      // Powershop can send a verification link instead of a code. Navigating the
      // same context consumes the link against the login attempt still in flight.
      await page.goto(loginCode, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
      await page.waitForTimeout(5000);
    } else {
      const codeInput = await findLoginCodeInput(page);
      if (!codeInput) {
        const error = new Error("Powershop login requested a code, but the code field was not found.");
        error.code = "requires_mfa";
        throw error;
      }
      await codeInput.fill(loginCode);
      await clickNamedButton(page, template.login.continueButtonNames);
      await page.waitForTimeout(5000);
    }
  }
  if (!(await pageLooksAuthenticated(page, template))) {
    await page.waitForURL(/\/dashboard/, { timeout: LOGIN_TIMEOUT_MS }).catch(() => null);
    await page.waitForTimeout(3000);
  }
  if (!(await pageLooksAuthenticated(page, template))) {
    const error = new Error("Powershop login did not reach the dashboard.");
    error.code = "requires_interaction";
    throw error;
  }

  await saveStorageState(context, storagePath);
  return "login";
}
