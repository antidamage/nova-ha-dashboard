import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { publishTaskAudioStatus } from "../../../../lib/dashboard-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AUDIO_PATH =
  process.env.NOVA_DASHBOARD_TASK_AUDIO ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "task-reminder.mp3");
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

function audioHeaders(size: number) {
  return {
    "Cache-Control": "no-store",
    "Content-Length": String(size),
    "Content-Type": "audio/mpeg",
  };
}

async function audioStatus() {
  try {
    const details = await stat(AUDIO_PATH);
    return {
      exists: true,
      size: details.size,
      updatedAt: details.mtime.toISOString(),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

function isMp3File(file: File) {
  return file.type === "audio/mpeg" || file.name.toLowerCase().endsWith(".mp3");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("status") === "1") {
      return NextResponse.json(await audioStatus());
    }

    const data = await readFile(AUDIO_PATH);
    return new NextResponse(data, { headers: audioHeaders(data.byteLength) });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return NextResponse.json({ error: "No reminder MP3 has been uploaded" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read reminder audio" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("MP3 file is required");
    }
    if (!isMp3File(file)) {
      throw new Error("Reminder audio must be an MP3 file");
    }
    if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
      throw new Error("Reminder audio must be between 1 byte and 10 MB");
    }

    const data = Buffer.from(await file.arrayBuffer());
    await mkdir(path.dirname(AUDIO_PATH), { recursive: true });
    await writeFile(AUDIO_PATH, data);

    const status = await audioStatus();
    publishTaskAudioStatus(status);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload reminder audio" },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  try {
    await unlink(AUDIO_PATH);
    const status = { exists: false };
    publishTaskAudioStatus(status);
    return NextResponse.json(status);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const status = { exists: false };
      publishTaskAudioStatus(status);
      return NextResponse.json(status);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove reminder audio" },
      { status: 400 },
    );
  }
}
