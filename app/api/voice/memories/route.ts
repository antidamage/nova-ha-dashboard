import { NextRequest, NextResponse } from "next/server";
import {
  backupIridiumAgentMemories,
  consolidateIridiumAgentMemories,
  fetchIridiumAgentMemories,
  forgetIridiumAgentMemory,
  updateIridiumAgentMemory,
} from "../../../../lib/iridium-voice-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const memories = await fetchIridiumAgentMemories();
  return memories
    ? NextResponse.json({ memories }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Voice memory is unavailable" }, { status: 502 });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return NextResponse.json({ error: "Invalid memory request" }, { status: 400 });
  }
  let result;
  if (body.action === "backup") result = await backupIridiumAgentMemories();
  else if (body.action === "consolidate") result = await consolidateIridiumAgentMemories();
  else if (body.action === "forget" && typeof body.memoryId === "string") result = await forgetIridiumAgentMemory(body.memoryId);
  else if (body.action === "update" && typeof body.memoryId === "string" && body.update && typeof body.update === "object") {
    result = await updateIridiumAgentMemory(body.memoryId, body.update as Record<string, unknown>);
  } else return NextResponse.json({ error: "Unsupported memory request" }, { status: 400 });
  return "payload" in result
    ? NextResponse.json(result.payload, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}
