import { NextResponse } from "next/server";
import { claimWashChime } from "../../../../../lib/tasks";
export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ claimed: typeof body.taskId === "string" && await claimWashChime(body.taskId) });
}
