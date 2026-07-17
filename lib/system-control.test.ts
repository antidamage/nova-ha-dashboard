import { mkdtemp, readFile, readdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("requestSystemAction", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "nova-system-"));
    process.env.NOVA_SYSTEM_DIR = dir;
    // Re-evaluate the module so its module-level SYSTEM_DIR reads NOVA_SYSTEM_DIR.
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.NOVA_SYSTEM_DIR;
  });

  async function loadModule() {
    return await import("./system-control");
  }

  it("writes a restart request file with a generated id and trimmed requester", async () => {
    const { requestSystemAction } = await loadModule();
    const request = await requestSystemAction("restart-dashboard", { requestedBy: "  config-ui  " });

    expect(request.action).toBe("restart-dashboard");
    expect(request.id).toMatch(/[0-9a-f-]{36}/);
    expect(request.requestedBy).toBe("config-ui");
    expect(Date.parse(request.requestedAt)).not.toBeNaN();

    const files = await readdir(path.join(dir, "control"));
    expect(files).toContain(`${request.id}.json`);
    const written = JSON.parse(await readFile(path.join(dir, "control", `${request.id}.json`), "utf8"));
    expect(written).toEqual(request);
  });

  it("writes a restart-stack request (restart HA + services, short of a reboot)", async () => {
    const { requestSystemAction } = await loadModule();
    const request = await requestSystemAction("restart-stack", { requestedBy: "config" });

    expect(request.action).toBe("restart-stack");
    const written = JSON.parse(await readFile(path.join(dir, "control", `${request.id}.json`), "utf8"));
    expect(written.action).toBe("restart-stack");
  });

  it("falls back to 'api' when the requester is blank and caps its length", async () => {
    const { requestSystemAction } = await loadModule();
    const blank = await requestSystemAction("reboot-host", { requestedBy: "   " });
    expect(blank.requestedBy).toBe("api");

    const long = await requestSystemAction("reboot-host", { requestedBy: "x".repeat(80) });
    expect(long.requestedBy).toHaveLength(40);
  });
});
