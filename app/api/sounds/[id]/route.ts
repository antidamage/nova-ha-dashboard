import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { isBuiltinSoundId, slugifySoundId } from "../../../../lib/sound-library";
import { uploadedSoundPath } from "../../../../lib/sound-storage";

// Serves one uploaded UX sound. Built-ins are static files under
// public/sounds/ux/ and never reach here. See specs/ux-sounds.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  // Re-slug rather than trusting the path segment: this becomes a filename.
  const id = slugifySoundId(rawId);

  if (isBuiltinSoundId(id)) {
    return NextResponse.redirect(new URL(`/sounds/ux/${id}.mp3`, _request.url));
  }

  try {
    const data = await readFile(uploadedSoundPath(id));
    return new NextResponse(data, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(data.byteLength),
        // The id is stable for the life of a clip and its bytes never change,
        // so this can be cached hard; a replacement gets a new id.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "No such sound" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read the sound" },
      { status: 500 },
    );
  }
}
