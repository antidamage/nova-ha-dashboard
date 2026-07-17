import { NextResponse } from "next/server";
import { mergeDashboardPreferences } from "../../../../lib/preferences";
import { getUpdateStatus } from "../../../../lib/update";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { autoUpdate?: unknown };
    if (typeof body.autoUpdate !== "boolean") {
      return NextResponse.json(
        { error: "Expected { autoUpdate: boolean }." },
        { status: 400 },
      );
    }

    await mergeDashboardPreferences({ update: { autoUpdate: body.autoUpdate } });
    return NextResponse.json(await getUpdateStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update settings" },
      { status: 500 },
    );
  }
}
