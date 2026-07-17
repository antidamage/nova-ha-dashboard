export type BackgroundTextureStatus = {
  contentType?: string;
  exists: boolean;
  height?: number;
  name?: string;
  size?: number;
  updatedAt?: string;
  url?: string;
  width?: number;
};

export const BACKGROUND_TEXTURE_PATH = "/api/background-texture";

export async function loadBackgroundTextureStatus() {
  const response = await fetch(`${BACKGROUND_TEXTURE_PATH}?status=1`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to read background texture");
  }
  return payload as BackgroundTextureStatus;
}

export async function uploadBackgroundTexture(file: File) {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(BACKGROUND_TEXTURE_PATH, {
    body: form,
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to upload background texture");
  }
  return payload as BackgroundTextureStatus;
}

export async function removeBackgroundTexture() {
  const response = await fetch(BACKGROUND_TEXTURE_PATH, { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to remove background texture");
  }
  return payload as BackgroundTextureStatus;
}
