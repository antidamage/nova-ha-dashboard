import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedComputersConfig } from "./ManagedComputersConfig";

const { saveManagedComputers } = vi.hoisted(() => ({
  saveManagedComputers: vi.fn(async (computers: Array<Record<string, unknown>>) => computers),
}));

vi.mock("./managed-computers-client", () => ({
  applyManagedDesktopWallpapers: vi.fn(async () => []),
  loadManagedComputers: vi.fn(async () => [{
    address: "desktop.local",
    capabilities: { lockScreen: true, sleep: true, wake: true, wallpaper: true, voiceSatellite: false },
    commandTimeoutMs: 15000,
    enabled: true,
    hostKey: "",
    id: "desktop",
    macAddress: "",
    name: "Desktop",
    orientation: "landscape",
    platform: "windows",
    roomId: "",
    sshKeyConfigured: false,
    sshKeyPath: "",
    sshPublicKey: null,
    updatedAt: "2026-07-23T00:00:00.000Z",
    username: "nova",
  }]),
  saveManagedComputers,
}));

describe("ManagedComputersConfig autosave", () => {
  afterEach(() => vi.clearAllMocks());

  it("saves text on blur and discrete controls immediately without a save button", async () => {
    render(<ManagedComputersConfig />);
    fireEvent.click(screen.getByRole("button", { name: /^managed computers$/i }));

    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Studio PC" } });
    expect(saveManagedComputers).not.toHaveBeenCalled();
    fireEvent.blur(name);
    await waitFor(() => expect(saveManagedComputers).toHaveBeenCalled());
    expect(saveManagedComputers.mock.calls.at(-1)?.[0][0].name).toBe("Studio PC");
    expect(screen.queryByRole("button", { name: /save managed computers/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
    await waitFor(() => expect(saveManagedComputers.mock.calls.at(-1)?.[0][0].enabled).toBe(false));
  });
});
