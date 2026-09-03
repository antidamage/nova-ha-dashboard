import { describe, expect, it } from "vitest";
import {
  assertionToPayload,
  base64UrlToBytes,
  bytesToBase64Url,
  challengeError,
  faceAssertionToPayload,
  fieldError,
  flowUrl,
  isTerminal,
  safeNext,
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
