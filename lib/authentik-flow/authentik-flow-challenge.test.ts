import { describe, expect, it } from "vitest";
import {
  assertionToPayload,
  challengeError,
  faceAssertionToPayload,
  fieldError,
  isTerminal,
  toCredentialRequestOptions,
  webauthnChallenge,
  webauthnChallengeValue,
  type DeviceChallenge,
  type FlowChallenge,
} from "../authentik-flow";

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
