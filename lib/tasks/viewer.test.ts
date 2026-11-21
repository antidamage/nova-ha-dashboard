import { describe, expect, it } from "vitest";
import { parseCookie, resolveViewer } from "./viewer";

const settings = {
  userIds: new Set(["alex", "lilith"]),
  clientViewers: [{ userAgentContains: "NovaAppleTV", user: "alex" }],
};

describe("parseCookie", () => {
  it("finds one cookie among several and decodes it", () => {
    expect(parseCookie("a=1; nova-viewer=ad%20e; b=2", "nova-viewer")).toBe("ad e");
    expect(parseCookie("a=1", "nova-viewer")).toBeNull();
    expect(parseCookie(null, "nova-viewer")).toBeNull();
  });
});

describe("resolveViewer", () => {
  it("reads a home user's id from the cookie", () => {
    expect(resolveViewer({ cookie: "nova-viewer=lilith" }, settings)).toEqual({ kind: "user", id: "lilith" });
  });

  it("reads household, and an unknown user, as household", () => {
    expect(resolveViewer({ cookie: "nova-viewer=household" }, settings)).toEqual({ kind: "household" });
    expect(resolveViewer({ cookie: "nova-viewer=nobody" }, settings)).toEqual({ kind: "household" });
  });

  it("reads no viewer at all as household: unidentified clients fail closed", () => {
    expect(resolveViewer({}, settings)).toEqual({ kind: "household" });
    expect(resolveViewer({ userAgent: "Mozilla/5.0" }, settings)).toEqual({ kind: "household" });
  });

  it("lets the header name system, and beat the cookie", () => {
    expect(resolveViewer({ header: "system" }, settings)).toEqual({ kind: "system" });
    expect(resolveViewer({ header: "alex", cookie: "nova-viewer=lilith" }, settings)).toEqual({ kind: "user", id: "alex" });
  });

  it("never reads system from a cookie", () => {
    expect(resolveViewer({ cookie: "nova-viewer=system" }, settings)).toEqual({ kind: "household" });
  });

  it("binds a client with no viewer by its User-Agent, but only to a current user", () => {
    expect(resolveViewer({ userAgent: "NovaAppleTVDashboard/1 CFNetwork" }, settings)).toEqual({ kind: "user", id: "alex" });
    const gone = { ...settings, userIds: new Set(["lilith"]) };
    expect(resolveViewer({ userAgent: "NovaAppleTVDashboard/1" }, gone)).toEqual({ kind: "household" });
  });

  it("lets a stated viewer take precedence over a binding", () => {
    expect(resolveViewer({ cookie: "nova-viewer=household", userAgent: "NovaAppleTV" }, settings)).toEqual({ kind: "household" });
  });
});