import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { listPhonoscopeModules, readPhonoscopeConfig, writePhonoscopeConfig } from "../../../../lib/phonoscope-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(value: unknown) {
  const body = JSON.stringify(value);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: `"${createHash("sha256").update(body).digest("hex")}"`,
    },
  });
}

export async function GET() {
  try {
    const [config, modules] = await Promise.all([readPhonoscopeConfig(), listPhonoscopeModules()]);
    return response({ config, modules });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to read Phonoscope config" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const config = await writePhonoscopeConfig(await request.json());
    return response({ config });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update Phonoscope config" }, { status: 400 });
  }
}
