import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readDashboardConfig } from "../../../../lib/dashboard-config";
import { ingestDoorbellSequence } from "../../../../lib/doorbell-coordinator";
import { isDoorbellSequence } from "../../../../lib/doorbell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOKEN_ENV = "NOVA_DOORBELL_INGEST_TOKEN";
// A knock sequence is a few hundred bytes. Anything larger is not one.
const MAX_BODY_BYTES = 4096;

function authorized(request: Request): boolean {
  const expected = process.env[TOKEN_ENV];
  if (!expected) {
    // No token configured means the endpoint is closed, not open. An ingest
    // path that accepts anything by default is how a doorbell becomes a way in.
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // Compare in constant time, and only after the lengths match, so the
  // comparison itself cannot be used to learn the token a byte at a time.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Ingest one knock sequence from a door sensor.
 *
 * The device reports; it does not decide. This endpoint authenticates the
 * report, bounds it, and hands it to the coordinator, which is the only thing
 * in the system that can ask the lock to open.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    // Same response either way — an unauthenticated caller learns nothing
    // about whether the endpoint is configured.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!isDoorbellSequence(parsed)) {
    return NextResponse.json({ error: "invalid sequence" }, { status: 400 });
  }

  const config = await readDashboardConfig();
  const doorbell = config.dashboard.doorbell;

  if (!doorbell.enabled) {
    return NextResponse.json({ verdict: "ignored_disabled" }, { status: 202 });
  }
  if (doorbell.deviceId && parsed.deviceId !== doorbell.deviceId) {
    return NextResponse.json({ error: "unknown device" }, { status: 403 });
  }

  try {
    const result = await ingestDoorbellSequence(parsed, {
      enabled: doorbell.enabled,
      deviceId: doorbell.deviceId,
      fusion: doorbell.fusion,
      access: doorbell.access,
      schedules: doorbell.schedules,
      secrets: doorbell.secrets,
    }, { visualTimeoutMs: doorbell.alerts.visualTimeoutMs });

    // The device gets the verdict so its logs line up with Nova's, but never a
    // reason — a sensor at the door should not be able to learn how close a
    // rhythm was.
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    console.error("[nova-dashboard] doorbell ingest failed", {
      message: (error as Error)?.message,
    });
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
