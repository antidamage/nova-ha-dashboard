import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginFlow,
  cancelFlow,
  challengeError,
  submitFlow,
} from "../authentik-flow";

describe("submitFlow and the executor's redirect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * A same-origin 3xx read with `redirect: "manual"`. The browser hands back an
   * opaque redirect: status 0, no headers, empty body.
   */
  const opaqueRedirect = () =>
    ({ type: "opaqueredirect", status: 0, ok: false, redirected: false, json: async () => {
      throw new Error("opaque redirect has no body");
    } }) as unknown as Response;

  const jsonResponse = (body: unknown, status = 200) =>
    ({ type: "basic", status, ok: status < 400, redirected: false, json: async () => body }) as unknown as Response;

  it("never follows the redirect, and re-reads the PREFIXED executor url", async () => {
    // The regression this guards: `handle_path /authentik/*` strips the prefix
    // before authentik sees the request, so authentik's Location is
    // `/api/v3/flows/executor/...` — a path that is Next.js on this origin,
    // not authentik. Following it produced a 404 immediately after the server
    // had logged "Successful authentication", and every sign-in died there.
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return init?.method === "POST"
        ? opaqueRedirect()
        : jsonResponse({ component: "ak-stage-authenticator-validate", device_challenges: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const next = await submitFlow("default-authentication-flow", {
      component: "ak-stage-identification",
      uid_field: "someone",
      password: "correct horse",
    });

    expect(next.component).toBe("ak-stage-authenticator-validate");
    expect(calls).toHaveLength(2);
    expect(calls[0].init?.redirect).toBe("manual");
    // Both requests stay under the proxied prefix.
    expect(calls[0].url).toBe("/authentik/api/v3/flows/executor/default-authentication-flow/?query=");
    expect(calls[1].url).toBe("/authentik/api/v3/flows/executor/default-authentication-flow/?query=");
    expect(calls[1].init?.method ?? "GET").toBe("GET");
  });

  it("recognises a plain 3xx as the same redirect", async () => {
    // Node's fetch and jsdom expose the real status rather than an opaque
    // response, so a runner must not decide the answer differently to a browser.
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? ({ type: "basic", status: 302, ok: false, redirected: false, json: async () => null } as unknown as Response)
        : jsonResponse({ component: "xak-flow-redirect", to: "/" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await submitFlow("passkey-login", { component: "ak-stage-authenticator-validate" })).toEqual({
      component: "xak-flow-redirect",
      to: "/",
    });
  });

  it("reads a refusal inline, without a second request", async () => {
    // A stage that REFUSED the answer does not redirect: it answers 200 with
    // the same challenge and `response_errors` filled in.
    const refusal = {
      component: "ak-stage-identification",
      response_errors: { non_field_errors: [{ string: "Failed to authenticate.", code: "invalid" }] },
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(refusal));
    vi.stubGlobal("fetch", fetchMock);

    const next = await submitFlow("default-authentication-flow", {
      component: "ak-stage-identification",
      uid_field: "someone",
      password: "wrong",
    });
    expect(challengeError(next)).toBe("Failed to authenticate.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("begins a flow with a single GET of the prefixed url", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse({ component: "ak-stage-identification" });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await beginFlow("face-auth-webauthn")).component).toBe("ak-stage-identification");
    expect(urls).toEqual(["/authentik/api/v3/flows/executor/face-auth-webauthn/?query="]);
  });

  it("cancels without following the redirect either", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return opaqueRedirect();
    });
    vi.stubGlobal("fetch", fetchMock);
    await cancelFlow();
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/authentik/flows/-/cancel/");
    expect(seen[0].init?.redirect).toBe("manual");
  });
});
