import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/**
 * The switches' write path (specs/amp-appletv-power.md §7). Both values are
 * always sent and a body missing either is refused rather than merged, because
 * the panel holds both — the assertion the Done-means list makes.
 */

const setAmpAutomation = vi.hoisted(() => vi.fn().mockResolvedValue({ autoOff: true, autoOn: true, updatedAt: "x" }));
vi.mock("../../../../lib/power", () => ({ setAmpAutomation }));

const post = (body: unknown) =>
  POST(
    new Request("http://nova.test/api/power/amp-automation", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

describe("POST /api/power/amp-automation", () => {
  beforeEach(() => {
    setAmpAutomation.mockClear();
  });

  it("stores the pair it is given", async () => {
    const response = await post({ autoOff: false, autoOn: true });

    expect(response.status).toBe(200);
    expect(setAmpAutomation).toHaveBeenCalledWith({ autoOff: false, autoOn: true });
    expect(await response.json()).toEqual({ autoOff: true, autoOn: true, updatedAt: "x" });
  });

  it("refuses a body missing a direction, rather than merging it", async () => {
    for (const body of [{ autoOn: true }, { autoOff: true }, {}, null, [true, false], "true"]) {
      const response = await post(body);

      expect(response.status).toBe(400);
    }
    expect(setAmpAutomation).not.toHaveBeenCalled();
  });

  it("refuses a value that is not a boolean", async () => {
    const response = await post({ autoOff: "off", autoOn: true });

    expect(response.status).toBe(400);
    expect(setAmpAutomation).not.toHaveBeenCalled();
  });

  it("answers 400 rather than 500 when the body is not JSON", async () => {
    const response = await post("not json at all");

    expect(response.status).toBe(400);
    expect(setAmpAutomation).not.toHaveBeenCalled();
  });
});
