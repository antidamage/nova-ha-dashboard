/**
 * Template-driven candidate extraction from JSON and page text, and the
 * daily record those candidates are normalised into.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */

import { extractIntervalsForDate, looksLikeDate, numberOrNull } from "./measurements.mjs";

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

export function findJsonCandidates(value, template, targetDate, source, pathParts = [], candidates = []) {
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

export function findTextCandidates(text, template, source) {
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

export function responseShouldBeCaptured(url, template) {
  const lower = url.toLowerCase();
  if ((template.network?.excludeUrlPatterns ?? []).some((pattern) => lower.includes(String(pattern).toLowerCase()))) {
    return false;
  }
  return (template.network?.includeUrlPatterns ?? []).some((pattern) => lower.includes(String(pattern).toLowerCase()));
}

export function normalizeRecord(targetDate, pages, capturedResponses, template) {
  const candidates = pages.flatMap((page) => page.candidates);
  const cost = bestCandidate(candidates, "costNzd");
  const kwh = bestCandidate(candidates, "kwh");
  const meterReading = bestCandidate(candidates, "meterReading");
  const intervals = extractIntervalsForDate(capturedResponses, targetDate);
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
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    intervals,
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
