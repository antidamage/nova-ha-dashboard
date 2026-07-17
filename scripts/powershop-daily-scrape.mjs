#!/usr/bin/env node
import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

const DEFAULT_TEMPLATE_PATH = path.resolve("config", "powershop-usage-template.json");
const DEFAULT_DATA_DIR = path.resolve("data", "power", "powershop");
const DEFAULT_TIME_ZONE = "Pacific/Auckland";
const DEFAULT_LOGIN_CODE_TIMEOUT_MS = 10 * 60 * 1000;
const LOGIN_CODE_POLL_MS = 1000;
const LOGIN_TIMEOUT_MS = 90_000;
const PAGE_TIMEOUT_MS = 60_000;
const MEASUREMENTS_LOOKBACK_HOURS = 72;
const MEASUREMENT_COST_TYPES = new Set(["CONSUMPTION_COST", "STANDING_CHARGE_COST"]);

const POWERSHOP_MEASUREMENTS_QUERY = `
  fragment MeasurementFields on MeasurementConnection {
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
    edges {
      node {
        source
        value
        unit
        readAt
        ... on IntervalMeasurementType {
          startAt
          endAt
        }
        metaData {
          utilityFilters {
            ... on ElectricityFiltersOutput {
              readingFrequencyType
              readingDirection
              registerId
              deviceId
              marketSupplyPointId
              readingQuality
            }
          }
          statistics {
            label
            type
            value
            costInclTax {
              estimatedAmount
            }
          }
        }
      }
    }
  }

  query measurements(
    $accountNumber: String!
    $propertyId: ID!
    $before: String
    $after: String
    $first: Int
    $last: Int
    $endOn: Date
    $readingFrequencyType: ReadingFrequencyType!
    $readingDirectionType: ReadingDirectionType
    $readingQualityType: ReadingQualityType
    $registerId: String
    $deviceId: String
    $marketSupplyPointId: String
  ) {
    account(accountNumber: $accountNumber) {
      id
      property(id: $propertyId) {
        id
        measurements(
          before: $before
          after: $after
          first: $first
          last: $last
          endOn: $endOn
          timezone: "Pacific/Auckland"
          utilityFilters: [
            {
              electricityFilters: {
                readingDirection: $readingDirectionType
                readingQuality: $readingQualityType
                readingFrequencyType: $readingFrequencyType
                registerId: $registerId
                deviceId: $deviceId
                marketSupplyPointId: $marketSupplyPointId
              }
            }
          ]
        ) {
          ... on MeasurementConnection {
            ...MeasurementFields
          }
        }
      }
    }
  }
`;

function argValue(name) {
  const arg = process.argv.find((value) => value === name || value.startsWith(`${name}=`));
  if (!arg) {
    return null;
  }
  if (arg === name) {
    const index = process.argv.indexOf(arg);
    return process.argv[index + 1] ?? "";
  }
  return arg.slice(name.length + 1);
}

function hasArg(name) {
  return process.argv.includes(name) || process.argv.some((value) => value.startsWith(`${name}=`));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeLoginCode(value) {
  if (typeof value !== "string") {
    return null;
  }
  const code = value.trim().replace(/\s+/g, "");
  return code ? code : null;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function localParts(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-NZ", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    second: Number(parts.second),
    year: Number(parts.year),
  };
}

function dateKey(year, month, day) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function addDaysToDateKey(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function yesterdayKey(timeZone = DEFAULT_TIME_ZONE) {
  const parts = localParts(new Date(), timeZone);
  const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  noonUtc.setUTCDate(noonUtc.getUTCDate() - 1);
  return dateKey(noonUtc.getUTCFullYear(), noonUtc.getUTCMonth() + 1, noonUtc.getUTCDate());
}

function minutesFromClock(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

function isOvernight(template, now = new Date()) {
  const zone = template.timezone ?? DEFAULT_TIME_ZONE;
  const parts = localParts(now, zone);
  const current = parts.hour * 60 + parts.minute;
  const start = minutesFromClock(template.overnightWindow?.start ?? "00:00");
  const end = minutesFromClock(template.overnightWindow?.end ?? "06:30");
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function renderTemplate(value, variables) {
  return String(value).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => variables[name] ?? "");
}

function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/[$,\s]/g, "");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function looksLikeDate(value, targetDate) {
  return typeof value === "string" && value.slice(0, 10) === targetDate;
}

function measurementDateKey(node) {
  for (const field of ["startAt", "readAt", "endAt"]) {
    if (typeof node?.[field] === "string" && /^\d{4}-\d{2}-\d{2}/.test(node[field])) {
      return node[field].slice(0, 10);
    }
  }
  return null;
}

function measurementCostCents(node) {
  return (node?.metaData?.statistics ?? [])
    .filter((statistic) => MEASUREMENT_COST_TYPES.has(statistic?.type))
    .reduce((sum, statistic) => sum + (numberOrNull(statistic?.costInclTax?.estimatedAmount) ?? 0), 0);
}

function fieldValue(object, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(object, name)) {
      const number = numberOrNull(object[name]);
      if (number !== null) {
        return { field: name, value: number };
      }
    }
  }
  return null;
}

function hasTargetDate(object, dateFieldNames, targetDate) {
  return dateFieldNames.some((name) => looksLikeDate(object[name], targetDate));
}

function findJsonCandidates(value, template, targetDate, source, pathParts = [], candidates = []) {
  if (Array.isArray(value)) {
    const datedItems = value.filter((item) => item && typeof item === "object" && hasTargetDate(item, template.jsonFields.date, targetDate));
    for (const fieldName of ["kwh", "costNzd", "meterReading"]) {
      const hits = datedItems.flatMap((item) => {
        const hit = fieldValue(item, template.jsonFields[fieldName] ?? []);
        return hit ? [hit] : [];
      });
      if (hits.length) {
        candidates.push({
          confidence: hits.length > 1 ? 0.88 : 0.74,
          field: fieldName,
          path: pathParts.join("."),
          source,
          strategy: "json-dated-array",
          value: hits.reduce((sum, hit) => sum + hit.value, 0),
        });
      }
    }
    value.forEach((item, index) => findJsonCandidates(item, template, targetDate, source, [...pathParts, String(index)], candidates));
    return candidates;
  }

  if (!value || typeof value !== "object") {
    return candidates;
  }

  const dated = hasTargetDate(value, template.jsonFields.date, targetDate);
  if (dated) {
    for (const fieldName of ["kwh", "costNzd", "meterReading"]) {
      const hit = fieldValue(value, template.jsonFields[fieldName] ?? []);
      if (hit) {
        candidates.push({
          confidence: 0.78,
          field: fieldName,
          path: [...pathParts, hit.field].join("."),
          source,
          strategy: "json-dated-object",
          value: hit.value,
        });
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    findJsonCandidates(child, template, targetDate, source, [...pathParts, key], candidates);
  }
  return candidates;
}

function findTextCandidates(text, template, source) {
  const candidates = [];
  for (const item of template.textPatterns ?? []) {
    const regex = new RegExp(item.pattern, "gi");
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = numberOrNull(match[1]);
      if (value !== null) {
        candidates.push({
          confidence: 0.46,
          field: item.field,
          source,
          strategy: "text-pattern",
          value,
        });
      }
    }
  }
  return candidates;
}

function bestCandidate(candidates, field) {
  const matches = candidates
    .filter((candidate) => candidate.field === field && Number.isFinite(candidate.value))
    .sort((a, b) => b.confidence - a.confidence || Math.abs(b.value) - Math.abs(a.value));
  return matches[0] ?? null;
}

function responseShouldBeCaptured(url, template) {
  const lower = url.toLowerCase();
  if ((template.network?.excludeUrlPatterns ?? []).some((pattern) => lower.includes(String(pattern).toLowerCase()))) {
    return false;
  }
  return (template.network?.includeUrlPatterns ?? []).some((pattern) => lower.includes(String(pattern).toLowerCase()));
}

async function selectedAccountNumber(page) {
  return page.evaluate(() => localStorage.getItem("selectedAccountNumber")).catch(() => null);
}

function findAccountContext(capturedResponses, selectedNumber) {
  const accounts = capturedResponses.flatMap((response) => {
    if (!response?.url?.includes("opName=accountViewer")) {
      return [];
    }
    const values = response.body?.data?.viewer?.accounts;
    return Array.isArray(values) ? values : [];
  });
  const account = accounts.find((value) => value?.number === selectedNumber) ?? accounts[0];
  const property = account?.properties?.[0] ?? account?.property;
  if (!account?.number || !property?.id) {
    return null;
  }
  return {
    accountNumber: account.number,
    propertyId: property.id,
  };
}

async function waitForAccountContext(page, capturedResponses, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let selectedNumber = await selectedAccountNumber(page);
  while (Date.now() < deadline) {
    const context = findAccountContext(capturedResponses, selectedNumber);
    if (context) {
      return context;
    }
    await page.waitForTimeout(500);
    selectedNumber = selectedNumber ?? (await selectedAccountNumber(page));
  }
  return null;
}

async function fetchAuthenticatedGraphql(page, operationName, query, variables) {
  return page.evaluate(
    async ({ operationName, query, variables }) => {
      const authKey = Object.keys(localStorage).find((key) => key.startsWith("firebase:authUser:"));
      const token = authKey ? JSON.parse(localStorage.getItem(authKey))?.stsTokenManager?.accessToken : null;
      const headers = { "content-type": "application/json" };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(`https://api.powershop.nz/v1/graphql/?opName=${operationName}`, {
        body: JSON.stringify({ operationName, query, variables }),
        headers,
        method: "POST",
      });
      const contentType = response.headers.get("content-type") ?? "";
      let body = await response.text();
      try {
        body = JSON.parse(body);
      } catch {
        // Keep text responses as evidence for auth/API failures.
      }
      return {
        body,
        contentType,
        status: response.status,
        url: response.url,
      };
    },
    { operationName, query, variables },
  );
}

async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch {
    // Fall through to the full package if this is run outside the Nova Docker wrapper.
  }
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(`Playwright or playwright-core is required for live scraping: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readLoginCodeFile(filePath) {
  try {
    return normalizeLoginCode(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function waitForLoginCodeFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = await readLoginCodeFile(filePath);
    if (code) {
      return code;
    }
    await sleep(LOGIN_CODE_POLL_MS);
  }
  return null;
}

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
    const fileCode = await readLoginCodeFile(loginCodeFile);
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

async function findChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const roots = ["/ms-playwright", "/root/.cache/ms-playwright", "/home/pwuser/.cache/ms-playwright"];
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const chromiumDirs = entries
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("chromium"))
        .map((entry) => path.join(root, entry.name))
        .sort()
        .reverse();
      for (const directory of chromiumDirs) {
        for (const candidate of [
          path.join(directory, "chrome-linux", "chrome"),
          path.join(directory, "chrome-linux", "chrome-wrapper"),
        ]) {
          if (await exists(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // Try the next known root.
    }
  }
  return undefined;
}

async function clickNamedButton(page, names) {
  for (const name of names) {
    const button = page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).first();
    if ((await button.count().catch(() => 0)) > 0) {
      await button.click();
      return true;
    }
  }
  return false;
}

async function pageLooksAuthenticated(page, template) {
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

async function findEmailInput(page, template) {
  const byRole = page.getByRole("textbox", { name: /email/i }).first();
  if ((await byRole.count().catch(() => 0)) > 0 && (await byRole.isVisible().catch(() => false))) {
    return byRole;
  }
  return firstVisibleLocator(page, template.login.emailSelectors);
}

async function findPasswordInput(page, template) {
  const byRole = page.getByRole("textbox", { name: /password/i }).first();
  if ((await byRole.count().catch(() => 0)) > 0 && (await byRole.isVisible().catch(() => false))) {
    return byRole;
  }
  return firstVisibleLocator(page, template.login.passwordSelectors);
}

async function findLoginCodeInput(page) {
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

async function ensureLoggedIn(page, context, template, storagePath, email, password) {
  await page.goto("https://app.powershop.nz/dashboard", { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForTimeout(5000);
  if (await pageLooksAuthenticated(page, template)) {
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await context.storageState({ path: storagePath });
    return "session";
  }

  await page.goto(template.login.url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(4000);
  const emailInput = await findEmailInput(page, template);
  if (!emailInput) {
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
  if (!(await pageLooksAuthenticated(page, template))) {
    await page.waitForURL(/\/dashboard/, { timeout: LOGIN_TIMEOUT_MS }).catch(() => null);
    await page.waitForTimeout(3000);
  }
  if (!(await pageLooksAuthenticated(page, template))) {
    const error = new Error("Powershop login did not reach the dashboard.");
    error.code = "requires_interaction";
    throw error;
  }

  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await context.storageState({ path: storagePath });
  return "login";
}

async function scrapePage(page, pageConfig, template, targetDate, capturedResponses) {
  const url = renderTemplate(pageConfig.urlTemplate, { date: targetDate });
  const startIndex = capturedResponses.length;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(1500);

  const text = await page.locator("body").innerText().catch(() => "");
  const textHash = crypto.createHash("sha256").update(text).digest("hex");
  const candidates = [
    ...findTextCandidates(text, template, `dom:${pageConfig.name}`),
    ...capturedResponses
      .slice(startIndex)
      .flatMap((response, index) => findJsonCandidates(response.body, template, targetDate, `response:${pageConfig.name}:${index}`)),
  ];

  return {
    candidates,
    expectedField: pageConfig.expectedField,
    name: pageConfig.name,
    optional: Boolean(pageConfig.optional),
    textHash,
    url,
  };
}

async function scrapeDirectMeasurements(page, targetDate, capturedResponses) {
  let accountContext = await waitForAccountContext(page, capturedResponses);
  const url = "https://api.powershop.nz/v1/graphql/?opName=measurements";
  if (!accountContext) {
    await page.goto("https://app.powershop.nz/dashboard", { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
    accountContext = await waitForAccountContext(page, capturedResponses);
  }
  if (!accountContext) {
    return {
      candidates: [],
      error: "Powershop account context was not found in the authenticated dashboard bootstrap.",
      expectedField: "costNzd,kwh",
      name: "directMeasurements",
      optional: true,
      textHash: null,
      url,
    };
  }

  const response = await fetchAuthenticatedGraphql(page, "measurements", POWERSHOP_MEASUREMENTS_QUERY, {
    ...accountContext,
    endOn: addDaysToDateKey(targetDate, 1),
    last: MEASUREMENTS_LOOKBACK_HOURS,
    readingDirectionType: "CONSUMPTION",
    readingFrequencyType: "HOUR_INTERVAL",
    readingQualityType: "COMBINED",
  });
  capturedResponses.push(response);

  if (response.status < 200 || response.status >= 300 || response.body?.errors) {
    return {
      candidates: [],
      error: `Powershop measurements query failed with status ${response.status}.`,
      expectedField: "costNzd,kwh",
      name: "directMeasurements",
      optional: true,
      textHash: null,
      url,
    };
  }

  const edges = response.body?.data?.account?.property?.measurements?.edges ?? [];
  const dayEdges = edges.filter(({ node }) => measurementDateKey(node) === targetDate);
  const kwh = dayEdges.reduce((sum, { node }) => sum + (numberOrNull(node?.value) ?? 0), 0);
  const costNzd = dayEdges.reduce((sum, { node }) => sum + measurementCostCents(node), 0) / 100;
  const candidates = [];
  if (dayEdges.length > 0) {
    candidates.push(
      {
        confidence: 0.97,
        field: "kwh",
        path: "data.account.property.measurements.edges",
        source: "direct:measurements",
        strategy: "graphql-hourly-measurements",
        value: kwh,
      },
      {
        confidence: 0.97,
        field: "costNzd",
        path: "data.account.property.measurements.edges.node.metaData.statistics.costInclTax.estimatedAmount",
        source: "direct:measurements",
        strategy: "graphql-hourly-measurements",
        value: costNzd,
      },
    );
  }

  return {
    candidates,
    expectedField: "costNzd,kwh",
    name: "directMeasurements",
    optional: true,
    textHash: crypto.createHash("sha256").update(JSON.stringify({ edgeCount: edges.length, targetDate })).digest("hex"),
    url,
  };
}

function normalizeRecord(targetDate, pages, capturedResponses, template) {
  const candidates = pages.flatMap((page) => page.candidates);
  const cost = bestCandidate(candidates, "costNzd");
  const kwh = bestCandidate(candidates, "kwh");
  const meterReading = bestCandidate(candidates, "meterReading");
  const warnings = [];
  if (!cost) {
    warnings.push("No reliable cost total found.");
  }
  if (!kwh) {
    warnings.push("No reliable kWh total found.");
  }

  const values = {
    costNzd: cost ? Math.round(cost.value * 100) / 100 : null,
    kwh: kwh ? Math.round(kwh.value * 1000) / 1000 : null,
    meterReading: meterReading ? Math.round(meterReading.value * 1000) / 1000 : null,
    unitPriceCents:
      cost && kwh && kwh.value > 0 ? Math.round((cost.value / kwh.value) * 10000) / 100 : null,
  };

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    source: "powershop",
    status: warnings.length ? "partial" : "ok",
    targetDate,
    templateVersion: template.schemaVersion,
    values,
    evidence: {
      responseCount: capturedResponses.length,
      selected: {
        costNzd: cost,
        kwh,
        meterReading,
      },
    },
    pages: pages.map((page) => ({
      error: page.error,
      expectedField: page.expectedField,
      name: page.name,
      optional: page.optional,
      textHash: page.textHash,
      url: page.url,
    })),
    warnings,
  };
}

async function main() {
  const templatePath = argValue("--template") ?? process.env.POWERSHOP_TEMPLATE_PATH ?? DEFAULT_TEMPLATE_PATH;
  const dataDir = argValue("--data-dir") ?? process.env.POWERSHOP_DATA_DIR ?? DEFAULT_DATA_DIR;
  const template = await readJson(templatePath);
  const targetDate = argValue("--date") ?? yesterdayKey(template.timezone ?? DEFAULT_TIME_ZONE);
  const dryRun = hasArg("--dry-run");
  const loginOnly = hasArg("--login-only");
  const force = hasArg("--force") || process.env.POWERSHOP_ALLOW_DAYTIME === "1";
  const storagePath = path.join(dataDir, "storage-state.json");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error(`Invalid --date value: ${targetDate}`);
  }

  if (!force && !loginOnly && !isOvernight(template)) {
    const record = {
      capturedAt: new Date().toISOString(),
      source: "powershop",
      status: "skipped_not_overnight",
      targetDate,
      warning: "Live meter reads are only allowed during the overnight window.",
    };
    await writeJson(path.join(dataDir, "latest.json"), record);
    console.log(JSON.stringify({ status: record.status, targetDate }));
    return;
  }

  if (dryRun) {
    console.log(JSON.stringify({ dataDir, status: "dry_run_ok", targetDate, templatePath }));
    return;
  }

  const email = process.env.POWERSHOP_EMAIL;
  const password = process.env.POWERSHOP_PASSWORD;
  if (!email || !password) {
    throw new Error("POWERSHOP_EMAIL and POWERSHOP_PASSWORD must be set in the runtime environment.");
  }

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: await findChromiumExecutable(),
    headless: !hasArg("--headed"),
  });
  const capturedResponses = [];
  let context;

  try {
    context = await browser.newContext((await exists(storagePath)) ? { storageState: storagePath } : {});
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    page.on("response", async (response) => {
      const url = response.url();
      if (!responseShouldBeCaptured(url, template)) {
        return;
      }
      const contentType = response.headers()["content-type"] ?? "";
      if (!contentType.includes("json") && !contentType.includes("text") && !url.toLowerCase().includes("graphql")) {
        return;
      }
      try {
        const text = await response.text();
        const limited = text.slice(0, template.network?.maxBodyChars ?? 200000);
        let body = limited;
        try {
          body = JSON.parse(limited);
        } catch {
          // Keep text bodies as text; DOM extraction handles the fallback.
        }
        capturedResponses.push({
          body,
          contentType,
          status: response.status(),
          url,
        });
      } catch {
        // Ignore unreadable/binary responses.
      }
    });

    const authMode = await ensureLoggedIn(page, context, template, storagePath, email, password);
    if (loginOnly) {
      const record = {
        authMode,
        capturedAt: new Date().toISOString(),
        source: "powershop",
        status: "login_ok",
        targetDate,
      };
      await writeJson(path.join(dataDir, "login-check.json"), record);
      console.log(JSON.stringify({ authMode, status: "login_ok", targetDate }));
      return;
    }
    const pages = [];
    try {
      pages.push(await scrapeDirectMeasurements(page, targetDate, capturedResponses));
    } catch (error) {
      pages.push({
        candidates: [],
        error: error instanceof Error ? error.message : String(error),
        expectedField: "costNzd,kwh",
        name: "directMeasurements",
        optional: true,
        textHash: null,
        url: "https://api.powershop.nz/v1/graphql/?opName=measurements",
      });
    }
    for (const pageConfig of template.pages) {
      try {
        pages.push(await scrapePage(page, pageConfig, template, targetDate, capturedResponses));
      } catch (error) {
        if (!pageConfig.optional) {
          throw error;
        }
        pages.push({
          candidates: [],
          error: error instanceof Error ? error.message : String(error),
          expectedField: pageConfig.expectedField,
          name: pageConfig.name,
          optional: true,
          textHash: null,
          url: renderTemplate(pageConfig.urlTemplate, { date: targetDate }),
        });
      }
    }

    const record = normalizeRecord(targetDate, pages, capturedResponses, template);
    const rawPath = path.join(dataDir, template.output.rawDirectory, `${targetDate}-${Date.now()}.json`);
    await writeJson(rawPath, {
      capturedAt: record.capturedAt,
      responses: capturedResponses,
      targetDate,
    });
    record.rawEvidencePath = rawPath;

    await writeJson(path.join(dataDir, template.output.dailyDirectory, `${targetDate}.json`), record);
    await writeJson(path.join(dataDir, template.output.latestFile), record);
    console.log(JSON.stringify({ costNzd: record.values.costNzd, kwh: record.values.kwh, status: record.status, targetDate }));
  } catch (error) {
    const status = error?.code === "requires_mfa" || error?.code === "requires_interaction" ? error.code : "error";
    const record = {
      capturedAt: new Date().toISOString(),
      source: "powershop",
      status,
      targetDate,
      warning: error instanceof Error ? error.message : String(error),
    };
    await writeJson(path.join(dataDir, "latest.json"), record);
    console.log(JSON.stringify({ status, targetDate }));
    if (status === "error") {
      process.exitCode = 1;
    }
  } finally {
    await context?.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
