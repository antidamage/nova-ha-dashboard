#!/usr/bin/env node
/**
 * Powershop daily scrape. The body lives in `scripts/powershop-daily-scrape/`;
 * this file stays the entry point the cron runner invokes
 * (`node /app/scripts/powershop-daily-scrape.mjs`) and re-exports the same
 * surface the tests import.
 */
import { pathToFileURL } from "node:url";

import { main } from "./powershop-daily-scrape/main.mjs";

export { dateKeysBetween, summarizeRangeResults } from "./powershop-daily-scrape/cli.mjs";
export { extractAccountMetadata, extractIntervalsForDate } from "./powershop-daily-scrape/measurements.mjs";
export { findAccountContext } from "./powershop-daily-scrape/client.mjs";
export { enrichExistingRecords } from "./powershop-daily-scrape/store.mjs";
export { main };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
