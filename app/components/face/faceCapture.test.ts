import { describe, expect, it } from "vitest";
import { FACE_REASON_MESSAGES, faceReasonDetail, faceReasonMessage } from "./faceCapture";

describe("face refusal messages", () => {
  it("distinguishes the three kinds of failure, because each calls for a different action", () => {
    // Camera problem -> retry can work.
    expect(faceReasonDetail("face_too_small", "x").message).toMatch(/closer/i);
    // Not recognised -> retrying probably will not help, but it is about you.
    expect(faceReasonDetail("ambiguous", "x").message).toMatch(/not recognised/i);
    // Recognised but not released -> retrying definitely will not help.
    const released = faceReasonDetail("no_veto_channel", "x").message;
    expect(released).toMatch(/recognised/i);
    expect(released).toMatch(/password/i);
  });

  it("names no host, port, service, key or third party", () => {
    // The login screen is reachable by anyone who can load the page. The old
    // no_veto_channel string named Discord, which is topology, and was also
    // wrong: the mapping lookup had failed, not the mapping itself.
    const forbidden = /discord|authentik|iridium|nocturnium|tailscale|tuatara|localhost|127\.0\.0\.1|192\.168|:\d{4}|webauthn|veto|api key|nova_/i;
    for (const [reason, message] of Object.entries(FACE_REASON_MESSAGES)) {
      expect(message, `${reason} leaks topology: ${message}`).not.toMatch(forbidden);
    }
  });

  it("withholds the reason name for the liveness and match signals", () => {
    // Naming which signal caught you is a tuning aid for somebody iterating
    // against the thresholds. face-auth.md's decision, kept.
    for (const reason of ["liveness_rigid", "antispoof", "ambiguous", "too_few_agreeing"]) {
      expect(faceReasonDetail(reason, "x").code, reason).toBeNull();
    }
    // …and the two liveness texts stay identical, so the message does not leak
    // what the code withholds.
    expect(FACE_REASON_MESSAGES.liveness_rigid).toBe(FACE_REASON_MESSAGES.antispoof);
  });

  it("withholds the reason name for all three switched-off states", () => {
    // Telling them apart says whether a probing campaign tripped the counter.
    const codes = ["disarmed", "locked_out", "rate_limited"].map((r) => faceReasonDetail(r, "x"));
    for (const detail of codes) expect(detail.code).toBeNull();
    // One string between them, for the same reason.
    expect(new Set(codes.map((d) => d.message)).size).toBe(1);
  });

  it("tells 'no credential registered' apart from every other refusal", () => {
    // This is the one that actually bit: the face was recognised, the liveness
    // gate passed, and the signing step had nothing to sign with. It had no
    // wording at all, so the UI showed a generic line and the real cause was
    // invisible. The fix is a setup step, not a retry, and the message says so.
    const detail = faceReasonDetail("no_credential", "generic");
    expect(detail.message).toMatch(/recognised/i);
    expect(detail.message).toMatch(/no sign-in credential/i);
    expect(detail.code).toBe("no_credential");
    expect(detail.message).not.toBe(FACE_REASON_MESSAGES.no_veto_channel);
  });

  it("names operational reasons, which are what make a failure reportable", () => {
    for (const reason of ["no_veto_channel", "no_credential", "nonce_invalid", "network_denied", "service_unavailable"]) {
      expect(faceReasonDetail(reason, "x").code, reason).toBe(reason);
    }
  });

  it("names a reason it has no wording for, rather than swallowing it", () => {
    // Exactly the case where the raw string is worth the most.
    const detail = faceReasonDetail("something_new_from_the_service", "Generic fallback.");
    expect(detail.message).toBe("Generic fallback.");
    expect(detail.code).toBe("something_new_from_the_service");
  });

  it("falls back cleanly when there is no reason at all", () => {
    expect(faceReasonDetail(undefined, "Fallback.")).toEqual({ message: "Fallback.", code: null });
    expect(faceReasonDetail("", "Fallback.").code).toBeNull();
    expect(faceReasonMessage(null)).toBe("That clip was refused.");
  });
});
