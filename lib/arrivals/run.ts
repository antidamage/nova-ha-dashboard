import { attributeControl } from "../control-attribution";
import { readDashboardConfig } from "../dashboard-config";
import { applyArrivalStates, type ArrivalStateResult } from "./apply-model";
import { arrivalStatesFor, findHouseholdMember, householdMemberNames } from "./member-model";
import { ARRIVAL_TARGETS } from "./targets";
import type { ArrivalEventKind } from "./types";

/**
 * What GET /api/arrival/<name> and GET /api/departure/<name> do: resolve the
 * household member, apply every state configured for that event in order, and
 * report each entry's outcome (specs/arrival-and-departure.md).
 *
 * No cooldown and no de-duplication: an arrival is an event, and firing one twice
 * re-applies the same presets rather than being swallowed. A partial failure is a
 * 500 with every entry listed, because the caller is an automation and a state it
 * asked for that did not land is a fact it needs. Every entry is attempted either
 * way — one missing preset must not stop the lights coming on.
 */
function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

function eventSummary(label: string, event: ArrivalEventKind) {
  return event === "arrival" ? `${label} arrived` : `${label} left`;
}

export async function runArrivalEvent(event: ArrivalEventKind, name: string, request?: Request) {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // A malformed escape is just a name that will not match anyone.
  }

  let config;
  try {
    config = await readDashboardConfig();
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "The dashboard config could not be read" },
      500,
    );
  }

  const member = findHouseholdMember(config.dashboard.people, decoded);
  if (!member) {
    return jsonResponse(
      {
        error: `No household member called "${decoded}"`,
        members: householdMemberNames(config.dashboard.people),
      },
      404,
    );
  }

  const states = arrivalStatesFor(member, event);
  const results: ArrivalStateResult[] = await applyArrivalStates(states, ARRIVAL_TARGETS);
  const ok = results.every((result) => result.ok);

  if (request) {
    void attributeControl(request, {
      service: "arrivals",
      event,
      summary: eventSummary(member.label, event),
      phase: "end",
      detail: {
        member: member.id,
        event,
        states: results.length,
        failed: results.filter((result) => !result.ok).length,
      },
    });
  }

  return jsonResponse(
    {
      member: member.id,
      event,
      ok,
      states: results,
      ...(states.length === 0
        ? { note: `No ${event} states are configured for ${member.label}` }
        : {}),
    },
    ok ? 200 : 500,
  );
}
