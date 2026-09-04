import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertionToPayload,
  beginFlow,
  cancelFlow,
  csrfToken,
  base64UrlToBytes,
  bytesToBase64Url,
  challengeError,
  faceAssertionToPayload,
  fieldError,
  flowUrl,
  isTerminal,
  safeNext,
  submitFlow,
  toCredentialRequestOptions,
  webauthnChallenge,
  webauthnChallengeValue,
  type DeviceChallenge,
  type FlowChallenge,
} from "./authentik-flow";

describe("flowUrl", () => {
  it("stays on the dashboard origin under the proxied prefix", () => {
    // Not authentik's :9443 origin: a cross-origin fetch is CORS-blocked, and
    // an assertion produced on :443 is rejected by a flow served on :9443.
    expect(flowUrl("passkey-login")).toBe("/authentik/api/v3/flows/executor/passkey-login/?query=");
  });

  it("encodes a slug rather than interpolating it raw", () => {
    expect(flowUrl("a/b")).toBe("/authentik/api/v3/flows/executor/a%2Fb/?query=");
  });
});

describe("base64url", () => {
  it("round-trips bytes that need padding and both substituted characters", () => {
    // 0xfb 0xff encodes to "+/" in standard base64, the two characters
    // base64url replaces. If either substitution is missed the challenge
    // decodes to the wrong bytes and the signature silently fails to verify.
    const bytes = new Uint8Array([0xfb, 0xff, 0x00, 0x10, 0x41]);
    const encoded = bytesToBase64Url(bytes.buffer);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes));
  });

  it("decodes a real authentik challenge without padding", () => {
    const challenge = "eDlxqWxjNxkBQ9a7TK66xfYM6W2LPb-IUqBryHturqIWRLa3oxKse1OYP76HRcHfnF5B4rTwQxlWf6kMwnXVTQ";
    expect(base64UrlToBytes(challenge)).toHaveLength(64);
  });

  it("round-trips every byte length modulo 4", () => {
    for (let length = 1; length <= 8; length += 1) {
      const bytes = new Uint8Array(Array.from({ length }, (_, i) => (i * 37 + 200) % 256));
      expect(Array.from(base64UrlToBytes(bytesToBase64Url(bytes.buffer)))).toEqual(Array.from(bytes));
    }
  });
});

describe("challenge inspection", () => {
  const identification: FlowChallenge = {
    component: "ak-stage-identification",
    user_fields: ["email", "username"],
    password_fields: true,
    response_errors: { password: [{ string: "Invalid password", code: "invalid" }] },
  };

  it("reads a field error", () => {
    expect(fieldError(identification, "password")).toBe("Invalid password");
    expect(fieldError(identification, "uid_field")).toBeNull();
  });

  it("falls back to any error when none is non_field", () => {
    expect(challengeError(identification)).toBe("Invalid password");
  });

  it("prefers an explicit access-denied message", () => {
    expect(challengeError({ component: "ak-stage-access-denied", error_message: "Denied." })).toBe("Denied.");
  });

  it("returns null when a challenge carries no errors", () => {
    expect(challengeError({ component: "ak-stage-identification" })).toBeNull();
  });

  it("recognises the terminal component", () => {
    expect(isTerminal({ component: "xak-flow-redirect", to: "/" })).toBe(true);
    expect(isTerminal(identification)).toBe(false);
  });
});

describe("webauthn challenge handling", () => {
  // Shape taken verbatim from a live GET of the passkey-login executor.
  const device: DeviceChallenge = {
    device_class: "webauthn",
    device_uid: "-1",
    challenge: {
      challenge: "eDlxqWxjNxkBQ9a7TK66xfYM6W2LPb-IUqBryHturqIWRLa3oxKse1OYP76HRcHfnF5B4rTwQxlWf6kMwnXVTQ",
      timeout: 60000,
      rpId: "nova.tuatara-dory.ts.net",
      allowCredentials: [],
      userVerification: "required",
    },
  };
  const challenge: FlowChallenge = {
    component: "ak-stage-authenticator-validate",
    device_challenges: [device],
  };

  it("picks the webauthn device and ignores others", () => {
    expect(webauthnChallenge(challenge)).toBe(device);
    expect(
      webauthnChallenge({
        component: "ak-stage-authenticator-validate",
        device_challenges: [{ device_class: "totp", device_uid: "1", challenge: {} }],
      }),
    ).toBeNull();
  });

  it("exposes the challenge string verbatim for the face oracle to sign", () => {
    // The oracle signs the base64url string authentik issued. Re-encoding it
    // here would change the bytes and the assertion would not verify.
    expect(webauthnChallengeValue(device)).toBe(device.challenge.challenge);
  });

  it("builds request options with the rp id and an empty allow list", () => {
    const options = toCredentialRequestOptions(device);
    expect(options.rpId).toBe("nova.tuatara-dory.ts.net");
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials).toEqual([]);
    expect(new Uint8Array(options.challenge as ArrayBuffer)).toHaveLength(64);
  });
});

describe("assertion payloads", () => {
  it("prefers the browser's own toJSON when present", () => {
    const expected = {
      id: "abc",
      rawId: "abc",
      type: "public-key",
      clientExtensionResults: {},
      response: { clientDataJSON: "a", authenticatorData: "b", signature: "c", userHandle: null },
    };
    const credential = { toJSON: () => expected } as unknown as PublicKeyCredential;
    expect(assertionToPayload(credential)).toBe(expected);
  });

  it("assembles the face oracle's reply without re-encoding it", () => {
    // The oracle already returns base64url, having constructed clientDataJSON
    // itself with the pinned origin. Anything that "helpfully" encoded these
    // again would produce a signature over different bytes.
    const payload = faceAssertionToPayload({
      credentialId: "cred-1",
      clientDataJSON: "Y2xpZW50",
      authenticatorData: "YXV0aA",
      signature: "c2ln",
      userHandle: "dXNlcg",
    });
    expect(payload).toEqual({
      id: "cred-1",
      rawId: "cred-1",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: "Y2xpZW50",
        authenticatorData: "YXV0aA",
        signature: "c2ln",
        userHandle: "dXNlcg",
      },
    });
  });

  it("tolerates an absent user handle", () => {
    expect(
      faceAssertionToPayload({
        credentialId: "c",
        clientDataJSON: "a",
        authenticatorData: "b",
        signature: "c",
      }).response.userHandle,
    ).toBeNull();
  });
});

describe("csrfToken", () => {
  // CSRF is enforced the moment a session exists -- DRF only runs the check
  // when session authentication resolves a user, which is why an anonymous
  // probe said it was not enforced and every signed-in submit then 500'd.
  it("reads the token authentik's own client reads", () => {
    expect(csrfToken("authentik_csrf=abc123")).toBe("abc123");
    expect(csrfToken("other=1; authentik_csrf=abc123; more=2")).toBe("abc123");
  });

  it("url-decodes it", () => {
    expect(csrfToken("authentik_csrf=a%2Bb")).toBe("a+b");
  });

  it("is null when absent, and does not match a lookalike name", () => {
    expect(csrfToken("")).toBeNull();
    expect(csrfToken("authentik_session=zzz")).toBeNull();
    // Must not match a cookie that merely ends with the name.
    expect(csrfToken("not_authentik_csrf=zzz")).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps a same-origin path", () => {
    expect(safeNext("/config")).toBe("/config");
    expect(safeNext("/config?tab=voice#x")).toBe("/config?tab=voice#x");
  });

  it("refuses anything that could leave the origin", () => {
    // A login page that honours an attacker-supplied `next` is a phishing
    // primitive wearing the household's own branding.
    expect(safeNext("https://evil.example/")).toBe("/");
    expect(safeNext("//evil.example/")).toBe("/");
    expect(safeNext("/\\evil.example/")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
  });

  it("falls back for empty and missing values", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext("", "/dashboard")).toBe("/dashboard");
  });
});

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
