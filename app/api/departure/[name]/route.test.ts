import { describe, expect, it, vi } from "vitest";

const runArrivalEvent = vi.hoisted(() =>
  vi.fn(async (_event: string, _name: string, _request?: Request) => new Response("{}", { status: 200 })),
);

vi.mock("../../../../lib/arrivals/run", () => ({ runArrivalEvent }));

const { GET } = await import("./route");

describe("/api/departure/[name]", () => {
  it("passes the name and the request to the event runner as a departure", async () => {
    const request = new Request("http://localhost/api/departure/Ada");

    await GET(request, { params: Promise.resolve({ name: "Ada" }) });

    expect(runArrivalEvent).toHaveBeenCalledWith("departure", "Ada", request);
  });
});
