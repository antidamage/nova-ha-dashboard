import { currentWallpaperResponse } from "../handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same response as the parent route. The extension exists so clients that key
// off the URL - iOS Shortcuts among them - recognise it as an image.
export async function GET(request: Request) {
  return currentWallpaperResponse(request);
}
