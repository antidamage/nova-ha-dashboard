import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who holds the floating meter's plug, and when — the half of
 * specs/amp-appletv-power.md §5 the pure decision cannot cover, because it is
 * about the race between this loop and the meter guard at boot.
 */

const config = {
  categoryId: "amp",
  sourceEntityId: "media_player.home_theatre",
  offStates: ["off", "standby"],
  switchEntityIds: ["switch.tuya_mobile_floating_meter", "switch.floating_meter"],
  minIntervalSeconds: 30,
  pollIntervalSeconds: 5,
  staleRestoreSeconds: 600,
};

let activeCategoryId = "amp";
/** The panel's two switches (§7), as the mock hands them to the loop. */
let switches = { autoOff: true, autoOn: true };

/** Hoisted so the assertions still see them after `vi.resetModules()`. */
const callServiceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const haRestMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("./dashboard-config", () => ({
  readDashboardConfigSync: () => ({ power: { ampPowerControl: config } }),
}));
vi.mock("./ha", () => ({
  callService: callServiceMock,
  haRest: haRestMock,
}));
vi.mock("./power", () => ({
  readActiveFloatingCategoryId: () => Promise.resolve(activeCategoryId),
  readAmpAutomation: () => Promise.resolve(switches),
}));

async function freshModule() {
  vi.resetModules();
  return import("./amp-power-control");
}

/** What the loop reads from HA on a tick: the Apple TV and the plug. */
function haStates(entries: Record<string, string>) {
  return Object.entries(entries).map(([entity_id, state]) => ({ attributes: {}, entity_id, state }));
}

describe("amp control ownership", () => {
  beforeEach(() => {
    activeCategoryId = "amp";
    switches = { autoOff: true, autoOn: true };
    callServiceMock.mockClear();
    haRestMock.mockClear();
    haRestMock.mockResolvedValue([]);
  });

  afterEach(async () => {
    const mod = await import("./amp-power-control");
    mod.resetAmpPowerControlForTest();
    vi.useRealTimers();
  });

  it("owns nothing before it is started", async () => {
    const { ampControlledEntityIds } = await freshModule();

    expect([...ampControlledEntityIds()]).toEqual([]);
  });

  it("holds the guard off the plug from the moment it starts, before its first tick", async () => {
    // The live bug: both loops begin at boot and the guard's first tick won the
    // race, restoring power a beat before the controller switched the amp off.
    const { ampControlledEntityIds, startAmpPowerControl } = await freshModule();
    startAmpPowerControl();

    expect([...ampControlledEntityIds()]).toEqual(config.switchEntityIds);
  });

  it("keeps holding it once the first tick confirms the Amp category", async () => {
    const { ampControlledEntityIds, startAmpPowerControl } = await freshModule();
    startAmpPowerControl();
    await vi.waitFor(() => expect([...ampControlledEntityIds()]).toEqual(config.switchEntityIds));
  });

  it("lets the plug go once the first tick finds another category", async () => {
    activeCategoryId = "kitchen";
    const { ampControlledEntityIds, startAmpPowerControl } = await freshModule();
    startAmpPowerControl();

    await vi.waitFor(() => expect([...ampControlledEntityIds()]).toEqual([]));
  });

  it("lets the plug go, and never reads the Apple TV, with both switches off", async () => {
    // The Grid panel's two checkboxes (§7). Both off, the controller is as
    // inert as it is under another category: no command of any kind, and the
    // guard has the plug back within the tick.
    switches = { autoOff: false, autoOn: false };
    const { ampControlledEntityIds, startAmpPowerControl } = await freshModule();
    startAmpPowerControl();

    await vi.waitFor(() => expect([...ampControlledEntityIds()]).toEqual([]));
    expect(haRestMock).not.toHaveBeenCalled();
    expect(callServiceMock).not.toHaveBeenCalled();
  });

  it("holds the plug but never switches the amp on with Auto On off", async () => {
    // One direction on is still a controller: it manages the plug, so the guard
    // stays off it — and the direction that is switched off is not commanded,
    // even though the Apple TV is asking for it.
    switches = { autoOff: true, autoOn: false };
    haRestMock.mockResolvedValue(haStates({ "media_player.home_theatre": "playing", "switch.floating_meter": "off" }));
    const { ampControlledEntityIds, startAmpPowerControl } = await freshModule();
    startAmpPowerControl();

    await vi.waitFor(() => expect([...ampControlledEntityIds()]).toEqual(config.switchEntityIds));
    expect(callServiceMock).not.toHaveBeenCalled();
  });

  it("never switches the amp off with Auto Off off", async () => {
    switches = { autoOff: false, autoOn: true };
    haRestMock.mockResolvedValue(haStates({ "media_player.home_theatre": "off", "switch.floating_meter": "on" }));
    const { ampControlledEntityIds, startAmpPowerControl } = await freshModule();
    startAmpPowerControl();

    await vi.waitFor(() => expect([...ampControlledEntityIds()]).toEqual(config.switchEntityIds));
    expect(callServiceMock).not.toHaveBeenCalled();
  });
});
