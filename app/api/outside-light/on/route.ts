import { handleLightShortcut } from "../../../../lib/api/light-shortcut-endpoint";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleLightShortcut("outside", "on", request);
}
