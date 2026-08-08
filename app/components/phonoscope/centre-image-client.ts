export type CentreImage = {
  id: string;
  name: string;
  width: number;
  height: number;
  size: number;
  hasAlpha: boolean;
  updatedAt: string;
  url: string;
};

const IMAGES_API_PATH = "/api/phonoscope/images";

async function body(response: Response) {
  try {
    return await response.json() as { error?: string; images?: CentreImage[] };
  } catch {
    return {};
  }
}

/**
 * Which library to talk to. The centre and the background keep separate ones:
 * they are different kinds of picture, and one shared list put every centre
 * logo in the background picker.
 */
export type CentreImageSlot = "centre" | "background";

export async function loadCentreImages(slot: CentreImageSlot): Promise<CentreImage[]> {
  const response = await fetch(`${IMAGES_API_PATH}?slot=${slot}`, { cache: "no-store" });
  if (!response.ok) throw new Error((await body(response)).error ?? "Failed to load images");
  return (await response.json()).images ?? [];
}

export async function uploadCentreImage(file: File, slot: CentreImageSlot): Promise<CentreImage> {
  const form = new FormData();
  form.set("file", file);
  form.set("slot", slot);
  const response = await fetch(IMAGES_API_PATH, { method: "POST", body: form });
  if (!response.ok) throw new Error((await body(response)).error ?? "Failed to upload the image");
  return await response.json();
}

/**
 * Deleting an image the configuration still points at is refused with a 409 and
 * an explanation naming what still uses it, which is surfaced as-is rather than
 * flattened into a generic failure — "still used by the colour theme Dusk" is
 * the whole answer.
 */
export async function deleteCentreImage(
  id: string,
  slot: CentreImageSlot,
): Promise<CentreImage[]> {
  const response = await fetch(`${IMAGES_API_PATH}?id=${encodeURIComponent(id)}&slot=${slot}`, {
    method: "DELETE",
  });
  const payload = await body(response);
  if (!response.ok) throw new Error(payload.error ?? "Failed to remove the image");
  return payload.images ?? [];
}
