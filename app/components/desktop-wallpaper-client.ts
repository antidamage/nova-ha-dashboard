export type DesktopWallpaperAsset = {
  contentType: string;
  createdAt: string;
  height: number;
  id: string;
  name: string;
  size: number;
  updatedAt: string;
  url: string;
  width: number;
};

const WALLPAPER_ENDPOINT = "/api/desktop/wallpapers";

export async function loadDesktopWallpapers() {
  const response = await fetch(WALLPAPER_ENDPOINT, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load desktop wallpapers");
  }
  return (payload.assets ?? []) as DesktopWallpaperAsset[];
}

export async function uploadDesktopWallpaper(file: File) {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(WALLPAPER_ENDPOINT, {
    body: form,
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to upload desktop wallpaper");
  }
  return payload.asset as DesktopWallpaperAsset;
}

export async function removeDesktopWallpaper(id: string) {
  const response = await fetch(`${WALLPAPER_ENDPOINT}/${encodeURIComponent(id)}`, { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to remove desktop wallpaper");
  }
  return (payload.assets ?? []) as DesktopWallpaperAsset[];
}
