/**
 * Defaults, timeouts and the month-name table.
 *
 * Moved verbatim from `scripts/gymmaster-attendance-scrape.mjs`, which stays
 * the entry point (`node /app/scripts/gymmaster-attendance-scrape.mjs`).
 */

import path from "node:path";

export const DEFAULT_PORTAL_URL = "https://allfit.gymmasteronline.com/portal/account/visithistory";
export const DEFAULT_DATA_DIR = path.resolve("data", "gymmaster");
export const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:3001";
export const DEFAULT_TIME_ZONE = "Pacific/Auckland";
export const LOGIN_TIMEOUT_MS = 90_000;
export const PAGE_TIMEOUT_MS = 60_000;
export const RESPONSE_MAX_CHARS = 200_000;

export const MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);
