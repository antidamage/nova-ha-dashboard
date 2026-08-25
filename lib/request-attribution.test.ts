import { expect, test } from "vitest";
import { callerAttribution } from "./request-attribution";

/*
 * These exist because the bedroom heater changed state overnight and nothing in
 * the stack could say what sent the request. Caddy proxies the dashboard, so the
 * socket peer is always the proxy — the forwarded headers are the only thing
 * that identifies the real caller.
 */

function requestWith(headers: Record<string, string>) {
  return new Request("http://nova.local/api/bedroom-heater", { method: "POST", headers });
}

test("takes the leftmost address from a forwarded chain", () => {
  const caller = callerAttribution(
    requestWith({ "x-forwarded-for": "100.78.137.53, 192.168.8.20" }),
  );
  expect(caller.ip).toBe("100.78.137.53");
});

test("tolerates whitespace in the forwarded chain", () => {
  const caller = callerAttribution(requestWith({ "x-forwarded-for": "  100.78.137.53  " }));
  expect(caller.ip).toBe("100.78.137.53");
});

test("falls back to x-real-ip when there is no forwarded chain", () => {
  const caller = callerAttribution(requestWith({ "x-real-ip": "192.168.8.30" }));
  expect(caller.ip).toBe("192.168.8.30");
});

test("reports null rather than guessing when no header identifies the caller", () => {
  const caller = callerAttribution(requestWith({}));
  expect(caller.ip).toBe(null);
  expect(caller.userAgent).toBe(null);
});

test("carries the user agent through, so a phone can be told from a kiosk", () => {
  const caller = callerAttribution(
    requestWith({ "x-forwarded-for": "100.78.137.53", "user-agent": "Mozilla/5.0 (iPhone)" }),
  );
  expect(caller.userAgent).toBe("Mozilla/5.0 (iPhone)");
});

test("an empty forwarded header does not become an empty-string address", () => {
  const caller = callerAttribution(requestWith({ "x-forwarded-for": "" }));
  expect(caller.ip).toBe(null);
});
