import { NextResponse } from "next/server";
import { writePlayResult } from "../../../../../lib/appletv-command";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * What the Apple TV's app did with the play command it was handed (Adeline,
 * 2026-09-22).
 *
 * The dashboard cannot start a named Apple Music playlist itself — HA's
 * `apple_tv` integration is pyatv, transport and metadata with no view of the
 * library — so the app reports the outcome here and the preset editor shows it.
 * Without that, a preset whose name does not match a library playlist would
 * only ever be silence.
 *
 * No `attributeControl`: this is the television answering the dashboard, not a
 * person touching a control (specs/kiosk-attribution.md).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body as { id?: unknown; name?: unknown; played?: unknown; reason?: unknown } | null;
  if (
    typeof record?.id !== "number" ||
    !Number.isFinite(record.id) ||
    typeof record.name !== "string" ||
    !record.name ||
    typeof record.played !== "boolean" ||
    (record.reason !== undefined && typeof record.reason !== "string")
  ) {
    return NextResponse.json(
      { error: "expected { id: number, name: string, played: boolean, reason?: string }" },
      { status: 400 },
    );
  }
  const result = await writePlayResult({
    id: record.id,
    name: record.name,
    played: record.played,
    reason: record.reason ?? null,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
