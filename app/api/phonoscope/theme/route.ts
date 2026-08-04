import { NextResponse } from "next/server";
import { readPhonoscopeConfig } from "../../../../lib/phonoscope-store";
import { commandPhonoscopeTheme, readPhonoscopeThemeState } from "../../../../lib/phonoscope-theme-state";
import { publishPhonoscopeConfig } from "../../../../lib/dashboard-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(readPhonoscopeThemeState(await readPhonoscopeConfig()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read visualiser theme" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    const state = commandPhonoscopeTheme(await readPhonoscopeConfig(), action);
    publishPhonoscopeConfig("theme-control");
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to control visualiser theme" },
      { status: 400 },
    );
  }
}
