/**
 * Response capture and the attendance record built from it.
 *
 * Moved verbatim from `scripts/gymmaster-attendance-scrape.mjs`, which stays
 * the entry point (`node /app/scripts/gymmaster-attendance-scrape.mjs`).
 */

import crypto from "node:crypto";
import { RESPONSE_MAX_CHARS } from "./constants.mjs";
import { extractVisitCandidatesFromText } from "./visit-dates.mjs";
import { extractVisitCandidatesFromJson, localDateKey, pickLatestVisitCandidate } from "./visit-json.mjs";

function responseShouldBeCaptured(url) {
  const lower = url.toLowerCase();
  return (
    lower.includes("/portal/account/visithistory")
    || lower.includes("/portal/api/")
    || lower.includes("/portal/member/visits")
    || lower.includes("/portal/account")
  );
}

export function installResponseCapture(page, capturedResponses) {
  page.on("response", async (response) => {
    const url = response.url();
    if (!responseShouldBeCaptured(url)) {
      return;
    }

    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("json") && !contentType.includes("text") && !contentType.includes("html")) {
      return;
    }

    try {
      const text = (await response.text()).slice(0, RESPONSE_MAX_CHARS);
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Keep text and HTML responses as text; DOM extraction handles them too.
      }
      capturedResponses.push({
        body,
        contentType,
        status: response.status(),
        url,
      });
    } catch {
      // Ignore unreadable responses.
    }
  });
}

export function buildAttendanceRecord({ authMode, capturedAt, capturedResponses, domText, now, portalUrl, timeZone }) {
  const domCandidates = extractVisitCandidatesFromText(domText, { now, source: "dom:visit-history", timeZone });
  const responseCandidates = capturedResponses.flatMap((response, index) => {
    const source = `response:${index}`;
    if (typeof response.body === "string") {
      return extractVisitCandidatesFromText(response.body, { now, source, timeZone });
    }
    return extractVisitCandidatesFromJson(response.body, { now, source, timeZone });
  });
  const candidates = [...domCandidates, ...responseCandidates];
  const selected = pickLatestVisitCandidate(candidates);
  const warnings = [];
  if (!selected) {
    warnings.push("No visit timestamp was found on the GymMaster visit history page.");
  }

  return {
    authMode,
    capturedAt,
    evidence: {
      candidateCount: candidates.length,
      domTextHash: crypto.createHash("sha256").update(domText).digest("hex"),
      responseCount: capturedResponses.length,
      selected,
    },
    lastVisitAt: selected?.iso ?? null,
    lastVisitLocalDate: selected ? localDateKey(new Date(selected.iso), timeZone) : null,
    portalUrl,
    schemaVersion: 1,
    source: "gymmaster",
    status: selected ? "ok" : "no_visit_found",
    timeZone,
    warnings,
  };
}
