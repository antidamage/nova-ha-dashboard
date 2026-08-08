import { NextResponse } from "next/server";

import { publishPhonoscopeConfig } from "../../../../lib/dashboard-events";
import {
  deletePhonoscopeImage,
  listPhonoscopeImages,
  maxPhonoscopeImageBytes,
  phonoscopeImageSlot,
  PHONOSCOPE_IMAGE_LIMIT,
  savePhonoscopeImage,
  type PhonoscopeImageSlot,
} from "../../../../lib/phonoscope-images";
import { readPhonoscopeConfig } from "../../../../lib/phonoscope-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The ids each slot's half of the configuration points at.
 *
 * `background` doubles as the answer for which library an untagged legacy entry
 * belongs to, which is why it is read even when only the centre is being asked
 * about: an image a theme uses as its backdrop is a background image, whenever
 * it was uploaded.
 */
async function referencedImageIds() {
  const config = await readPhonoscopeConfig();
  const ids = (pick: (theme: (typeof config.colorThemes)[number]) => string | null | undefined) =>
    new Set(config.colorThemes.map(pick).filter((id): id is string => Boolean(id)));
  return {
    centre: ids((theme) => theme.imageId),
    background: ids((theme) => theme.backgroundImageId),
  };
}

/**
 * What still uses an image, IN ITS OWN SLOT. A centre image is never held back
 * by a background reference — they are separate libraries, and a delete in one
 * has nothing to do with the other.
 */
async function referrersOf(id: string, slot: PhonoscopeImageSlot) {
  const config = await readPhonoscopeConfig();
  return config.colorThemes.flatMap((theme) => {
    if (slot === "background") {
      return theme.backgroundImageId === id
        ? [`the background of the colour theme “${theme.name}”`]
        : [];
    }
    return theme.imageId === id
      ? [`the centre image of the colour theme “${theme.name}”`]
      : [];
  });
}

export async function GET(request: Request) {
  try {
    const slot = phonoscopeImageSlot(new URL(request.url).searchParams.get("slot"));
    const referenced = await referencedImageIds();
    return NextResponse.json({
      images: await listPhonoscopeImages({ slot, backgroundIds: referenced.background }),
      limit: PHONOSCOPE_IMAGE_LIMIT,
      maxBytes: maxPhonoscopeImageBytes(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list images" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("A PNG, JPEG or WebP file is required");
    if (file.size <= 0 || file.size > maxPhonoscopeImageBytes()) {
      throw new Error(
        `The image must be between 1 byte and ${Math.round(maxPhonoscopeImageBytes() / 1024 / 1024)} MB`);
    }

    const slot = phonoscopeImageSlot(form.get("slot"));
    const referenced = await referencedImageIds();
    const inUse = new Set([...referenced.centre, ...referenced.background]);
    const data = Buffer.from(await file.arrayBuffer());
    const saved = await savePhonoscopeImage(file, data, inUse, slot, referenced.background);
    // The renderer re-reads the configuration on this nudge, which is how a new
    // upload reaches the picture without waiting for the ETag poll.
    publishPhonoscopeConfig("centre-image");
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload the image" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    if (!id) throw new Error("An image id is required");
    const slot = phonoscopeImageSlot(url.searchParams.get("slot"));
    const referenced = await referencedImageIds();

    // Refused rather than silently cascading: deleting the image a colour theme
    // depends on would change what that theme looks like, somewhere the person
    // deleting it is not looking.
    const referrers = await referrersOf(id, slot);
    if (referrers.length) {
      return NextResponse.json({
        error: `That image is still used by ${referrers.join(" and ")}.`,
        referrers,
      }, { status: 409 });
    }

    if (!await deletePhonoscopeImage(id)) {
      return NextResponse.json({ error: "No such image" }, { status: 404 });
    }
    publishPhonoscopeConfig("centre-image");
    return NextResponse.json({
      images: await listPhonoscopeImages({ slot, backgroundIds: referenced.background }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove the image" },
      { status: 400 },
    );
  }
}
