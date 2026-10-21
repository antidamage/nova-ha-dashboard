import { describe, expect, it } from "vitest";
import { violationsIn } from "./no-household-data.fixtures";

describe("no household data in product source", () => {
  it("actually detects the shapes it claims to", () => {
    expect(violationsIn("light.bedroom_light")).toBe("home-assistant entity id");
    expect(violationsIn("Pacific/Auckland")).toBe("hard-coded timezone");
    expect(violationsIn("192.168.8.20")).toBe("ip address");
    expect(violationsIn("d0:73:d5:a1:52:6f")).toBe("mac address");
    expect(violationsIn("light.tuya_mobile_kitchen")).toBe("home-assistant entity id");
    expect(violationsIn("http://nocturnium.local:8080")).toContain("nocturnium");

    // Shapes that must NOT trip it, or the rule becomes noise people mute.
    expect(violationsIn("sun.sun")).toBeNull();
    expect(violationsIn("weather.forecast_home")).toBeNull();
    expect(violationsIn("2.14.3")).toBeNull();
    expect(violationsIn("hvac_modes")).toBeNull();
    expect(violationsIn("Mon")).toBeNull();
    expect(violationsIn("http://127.0.0.1:8123")).toBeNull();
    expect(violationsIn("255.255.255.255")).toBeNull();
    // Interpolated code that merely looks like an entity id.
    expect(violationsIn("eq=brightness=${camera.brightness}")).toBeNull();
    expect(violationsIn("${camera.id}-${stamp}.ts")).toBeNull();
    // A third-party integration NAME is a product feature, not household data.
    expect(violationsIn("powershop")).toBeNull();
  });
});
