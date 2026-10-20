import { describe, expect, it } from "vitest";
import {
  csrfToken,
  base64UrlToBytes,
  bytesToBase64Url,
  flowUrl,
  safeNext,
} from "../authentik-flow";

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
