import { NextResponse } from "next/server";
import { fetchIridiumVoicePreview } from "../../../../lib/iridium-voice-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TEXT = 200;

// The personality Test button posts here; the dashboard forwards the synthesis
// request to Iridium over mTLS and streams the WAV straight back so the browser
// can play it locally. The body is optional — with no text Iridium picks a
// default sample line naming the agent.
export async function POST(request: Request) {
  let text: string | undefined;
  try {
    const body = (await request.json()) as { text?: unknown };
    if (typeof body?.text === "string") {
      text = body.text.slice(0, MAX_TEXT);
    }
  } catch {
    // An empty or non-JSON body is fine.
  }

  const result = await fetchIridiumVoicePreview(text);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return new NextResponse(new Uint8Array(result.audio), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "no-store",
    },
  });
}
