#!/usr/bin/env node
/**
 * GymMaster attendance scrape. The body lives in
 * `scripts/gymmaster-attendance-scrape/`; this file stays the entry point the
 * cron runner invokes (`node /app/scripts/gymmaster-attendance-scrape.mjs`)
 * and re-exports the same surface the tests import.
 */
import { pathToFileURL } from "node:url";

import { main } from "./gymmaster-attendance-scrape/main.mjs";

export { extractVisitCandidatesFromText } from "./gymmaster-attendance-scrape/visit-dates.mjs";
export { extractVisitCandidatesFromJson, pickLatestVisitCandidate } from "./gymmaster-attendance-scrape/visit-json.mjs";
export { assertWatchfaceEcho } from "./gymmaster-attendance-scrape/watchface.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
