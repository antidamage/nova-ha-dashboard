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

export async function loadCentreImages(): Promise<CentreImage[]> {
  const response = await fetch(IMAGES_API_PATH, { cache: "no-store" });
  if (!response.ok) throw new Error((await body(response)).error ?? "Failed to load centre images");
  return (await response.json()).images ?? [];
}

export async function uploadCentreImage(file: File): Promise<CentreImage> {
  const form = new FormData();
  form.set("file", file);
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
export async function deleteCentreImage(id: string): Promise<CentreImage[]> {
  const response = await fetch(`${IMAGES_API_PATH}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const payload = await body(response);
  if (!response.ok) throw new Error(payload.error ?? "Failed to remove the image");
  return payload.images ?? [];
}
