import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeDashboardServiceRequest } from "./service-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboard service authentication", () => {
  it("fails closed when the token is absent", () => {
    vi.stubEnv("NOVA_DASHBOARD_MCP_TOKEN", "");
    const result = authorizeDashboardServiceRequest(new Request("http://nova.local/api/agent/events"));
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it("requires the exact bearer token", () => {
    vi.stubEnv("NOVA_DASHBOARD_MCP_TOKEN", "household-secret");
    const rejected = authorizeDashboardServiceRequest(new Request("http://nova.local/api/agent/events", {
      headers: { Authorization: "Bearer household-secrex" },
    }));
    const accepted = authorizeDashboardServiceRequest(new Request("http://nova.local/api/agent/events", {
      headers: { Authorization: "Bearer household-secret" },
    }));

    expect(rejected).toMatchObject({ ok: false, status: 401 });
    expect(accepted).toMatchObject({ ok: true, status: 200 });
  });
});
