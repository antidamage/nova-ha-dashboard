import { NextResponse } from "next/server";

import { publishPhonoscopeConfig } from "../../../../lib/dashboard-events";
import {
  deletePhonoscopeImage,
  listPhonoscopeImages,
  maxPhonoscopeImageBytes,
  PHONOSCOPE_IMAGE_LIMIT,
  savePhonoscopeImage,
} from "../../../../lib/phonoscope-images";
import { readPhonoscopeConfig } from "../../../../lib/phonoscope-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Every image the configuration currently points at. Only colour themes can
 * name one, so this is exactly the set of themes with an image: these are the
 * ids the cap must not evict and a delete must refuse.
 */
async function referencedImageIds() {
  const config = await readPhonoscopeConfig();
  return new Set(config.colorThemes.flatMap((theme) => theme.imageId ? [theme.imageId] : []));
}

async function referrersOf(id: string) {
  const config = await readPhonoscopeConfig();
  return config.colorThemes
    .filter((theme) => theme.imageId === id)
    .map((theme) => `the colour theme “${theme.name}”`);
}

export async function GET() {
  try {
    return NextResponse.json({
      images: await listPhonoscopeImages(),
      limit: PHONOSCOPE_IMAGE_LIMIT,
      maxBytes: maxPhonoscopeImageBytes(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list centre images" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("A PNG file is required");
    if (file.size <= 0 || file.size > maxPhonoscopeImageBytes()) {
      throw new Error(
        `The centre image must be between 1 byte and ${Math.round(maxPhonoscopeImageBytes() / 1024 / 1024)} MB`);
    }

    const data = Buffer.from(await file.arrayBuffer());
    const saved = await savePhonoscopeImage(file, data, await referencedImageIds());
    // The renderer re-reads the configuration on this nudge, which is how a new
    // upload reaches the picture without waiting for the ETag poll.
    publishPhonoscopeConfig("centre-image");
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload the centre image" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) throw new Error("An image id is required");

    // Refused rather than silently cascading: deleting the image a colour theme
    // depends on would change what that theme looks like, somewhere the person
    // deleting it is not looking.
    const referrers = await referrersOf(id);
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
    return NextResponse.json({ images: await listPhonoscopeImages() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove the centre image" },
      { status: 400 },
    );
  }
}
