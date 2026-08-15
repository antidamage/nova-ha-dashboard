import { NextRequest, NextResponse } from "next/server";
import {
  backupVoiceHostAgentMemories,
  consolidateVoiceHostAgentMemories,
  fetchVoiceHostAgentMemories,
  forgetVoiceHostAgentMemory,
  updateVoiceHostAgentMemory,
} from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const memories = await fetchVoiceHostAgentMemories();
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
  if (body.action === "backup") result = await backupVoiceHostAgentMemories();
  else if (body.action === "consolidate") result = await consolidateVoiceHostAgentMemories();
  else if (body.action === "forget" && typeof body.memoryId === "string") result = await forgetVoiceHostAgentMemory(body.memoryId);
  else if (body.action === "update" && typeof body.memoryId === "string" && body.update && typeof body.update === "object") {
    result = await updateVoiceHostAgentMemory(body.memoryId, body.update as Record<string, unknown>);
  } else return NextResponse.json({ error: "Unsupported memory request" }, { status: 400 });
  return "payload" in result
    ? NextResponse.json(result.payload, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}
