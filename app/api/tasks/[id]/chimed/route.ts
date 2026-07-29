import { NextResponse } from "next/server";
import { markTaskAlertChimed } from "../../../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// Claim this occurrence's chime. The first screen to play the sound calls
// this; the resulting task broadcast is what keeps every other screen -- and
// every later page load -- from playing it again.
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const task = await markTaskAlertChimed(id);

    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record reminder chime" },
      { status: 400 },
    );
  }
}
