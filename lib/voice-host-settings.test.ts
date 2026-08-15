import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerVoiceHostSettingsRefresh } from "./voice-host-settings";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Voice host settings refresh", () => {
  it("sends a no-payload collection signal to the configured voice host endpoint", async () => {
    let observed: { body: string; method?: string; path?: string } | undefined;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        observed = {
          body: Buffer.concat(chunks).toString("utf8"),
          method: request.method,
          path: request.url,
        };
        response.statusCode = 204;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    vi.stubEnv("NOVA_VOICE_IRIDIUM_URL", `http://127.0.0.1:${port}`);

    try {
      await expect(triggerVoiceHostSettingsRefresh()).resolves.toEqual({ ok: true, status: 204 });
      expect(observed).toEqual({ body: "", method: "POST", path: "/v1/settings/refresh" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
