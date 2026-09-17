// Outbound JSON fetch shared by every provider and the Spotify token request.
export async function fetchJson(url: URL, timeoutMs = 4_000, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", "Nova-Phonoscope/1.0 (single-household visualiser)");
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}
