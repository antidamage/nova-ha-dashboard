const CAMERA_EVENTS_URL = (process.env.NOVA_CAMERA_EVENTS_URL ?? "http://127.0.0.1:8098").replace(/\/$/, "");

export async function cameraEventsFetch(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`${CAMERA_EVENTS_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function proxyCameraEventsJson(path: string, init?: RequestInit) {
  try {
    const response = await cameraEventsFetch(path, init);
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Camera analysis service unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

