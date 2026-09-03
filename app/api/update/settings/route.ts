import { NextResponse } from "next/server";
import { mergeDashboardPreferences } from "../../../../lib/preferences";
import { getUpdateStatus } from "../../../../lib/update";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      autoUpdate?: unknown;
      showUpdatesOnHome?: unknown;
    };
    const patch: { autoUpdate?: boolean; showUpdatesOnHome?: boolean } = {};
    if (body.autoUpdate !== undefined) {
      if (typeof body.autoUpdate !== "boolean") {
        return NextResponse.json({ error: "autoUpdate must be a boolean." }, { status: 400 });
      }
      patch.autoUpdate = body.autoUpdate;
    }
    if (body.showUpdatesOnHome !== undefined) {
      if (typeof body.showUpdatesOnHome !== "boolean") {
        return NextResponse.json({ error: "showUpdatesOnHome must be a boolean." }, { status: 400 });
      }
      patch.showUpdatesOnHome = body.showUpdatesOnHome;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Expected at least one of { autoUpdate, showUpdatesOnHome }." },
        { status: 400 },
      );
    }

    await mergeDashboardPreferences({ update: patch });
    return NextResponse.json(await getUpdateStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update settings" },
      { status: 500 },
    );
  }
}
