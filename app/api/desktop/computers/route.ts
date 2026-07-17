import { NextResponse } from "next/server";
import { listManagedComputers, saveManagedComputers } from "../../../../lib/managed-computers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ computers: await listManagedComputers() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read managed computers" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ computers: await saveManagedComputers(body) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update managed computers" },
      { status: 400 },
    );
  }
}
