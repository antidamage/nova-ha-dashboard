import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { uploadedSoundPath } from "../../../lib/sound-storage";
import { publishSoundLibrary } from "../../../lib/dashboard-events";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import {
  isBuiltinSoundId,
  normalizeSoundLibrary,
  normalizeSoundName,
  SOUND_FILE_MAX_BYTES,
  SOUND_LIBRARY_MAX_UPLOADS,
  soundLibraryWithBuiltins,
  uniqueSoundId,
  type SoundLibraryEntry,
} from "../../../lib/sound-library";

// The UX sound library: list, upload, rename, delete. Uploads are files under
// data/sounds/, following app/api/tasks/audio/route.ts — the established
// pattern for storing an MP3 the dashboard plays. Built-ins are never stored.
// See specs/ux-sounds.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isMp3File(file: File) {
  return file.type === "audio/mpeg" || file.name.toLowerCase().endsWith(".mp3");
}

async function readStoredLibrary() {
  return normalizeSoundLibrary((await readDashboardPreferences()).soundLibrary);
}

async function saveStoredLibrary(entries: SoundLibraryEntry[], reason: string) {
  const library = normalizeSoundLibrary({ entries });
  await mergeDashboardPreferences({ soundLibrary: library as unknown as Record<string, unknown> });
  publishSoundLibrary(reason);
  return library;
}

export async function GET() {
  try {
    const stored = await readStoredLibrary();
    return NextResponse.json({ entries: soundLibraryWithBuiltins(stored) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read the sound library" },
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
      throw new Error("A UX sound must be an MP3 file");
    }
    if (file.size <= 0 || file.size > SOUND_FILE_MAX_BYTES) {
      throw new Error(`MP3 must be between 1 byte and ${SOUND_FILE_MAX_BYTES} bytes`);
    }

    const stored = await readStoredLibrary();
    if (stored.entries.length >= SOUND_LIBRARY_MAX_UPLOADS) {
      throw new Error(`The sound library holds at most ${SOUND_LIBRARY_MAX_UPLOADS} uploaded clips`);
    }

    const requestedName = form.get("name");
    const fallbackName = file.name.replace(/\.[^.]+$/, "") || "Sound";
    const name = normalizeSoundName(typeof requestedName === "string" ? requestedName : null, fallbackName);
    const id = uniqueSoundId(name, stored.entries.map((entry) => entry.id));

    const target = uploadedSoundPath(id);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await file.arrayBuffer()));

    const entry: SoundLibraryEntry = {
      id,
      name,
      origin: "upload",
      bytes: file.size,
      updatedAt: new Date().toISOString(),
    };
    const library = await saveStoredLibrary([...stored.entries, entry], "upload");

    return NextResponse.json({ entry, entries: soundLibraryWithBuiltins(library) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload the sound" },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: unknown; name?: unknown };
    if (typeof body.id !== "string") {
      throw new Error("Sound id is required");
    }
    if (isBuiltinSoundId(body.id)) {
      throw new Error("Built-in sounds cannot be renamed");
    }

    const stored = await readStoredLibrary();
    const existing = stored.entries.find((entry) => entry.id === body.id);
    if (!existing) {
      throw new Error("No such sound");
    }

    const entries = stored.entries.map((entry) =>
      entry.id === existing.id ? { ...entry, name: normalizeSoundName(body.name, entry.name) } : entry,
    );
    const library = await saveStoredLibrary(entries, "rename");

    return NextResponse.json({ entries: soundLibraryWithBuiltins(library) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rename the sound" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      throw new Error("Sound id is required");
    }
    if (isBuiltinSoundId(id)) {
      throw new Error("Built-in sounds cannot be deleted");
    }

    const stored = await readStoredLibrary();
    if (!stored.entries.some((entry) => entry.id === id)) {
      throw new Error("No such sound");
    }

    try {
      await unlink(uploadedSoundPath(id));
    } catch (error) {
      // Already gone on disk: still drop the manifest row rather than leaving
      // an entry pointing at nothing.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const library = await saveStoredLibrary(
      stored.entries.filter((entry) => entry.id !== id),
      "delete",
    );

    // Assignments still pointing here are left alone: a dangling id resolves to
    // the button-press default, so a delete never silences an action
    // (specs/ux-sounds.md).
    return NextResponse.json({ entries: soundLibraryWithBuiltins(library) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete the sound" },
      { status: 400 },
    );
  }
}
