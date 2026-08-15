import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeakerProfilesPayload } from "../../lib/voice-host-settings";
import { SpeakerProfilesConfig } from "./SpeakerProfilesConfig";

const now = new Date("2026-07-20T02:00:00.000Z").getTime();

const profiles: SpeakerProfilesPayload = {
  enabled: true,
  profiles: [{
    id: "person-addie",
    displayName: "Addie",
    pronouns: "she/her",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    templates: [{
      id: "associated-template",
      state: "active",
      sampleCount: 8,
      createdAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      expiresAt: null,
    }],
  }],
  provisionalTemplates: [{
    id: "unassociated-template",
    state: "provisional",
    sampleCount: 2,
    createdAt: "2026-07-19T00:00:00.000Z",
    lastSeenAt: "2026-07-20T01:55:00.000Z",
    expiresAt: "2026-07-21T04:00:00.000Z",
  }],
};

describe("SpeakerProfilesConfig", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => profiles,
    })));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists associated and unassociated identities with last-seen and expiry details", async () => {
    render(<SpeakerProfilesConfig />);

    const identitySection = (await screen.findByText("Recorded identities (2)")).closest("section");
    expect(identitySection).not.toBeNull();
    const identities = within(identitySection!);
    expect(identities.getByRole("button", { name: "Delete recorded identity Addie" }))
      .toBeInTheDocument();
    expect(identities.getByText("Unassociated voice")).toBeInTheDocument();
    expect(identities.getByText(/Last seen .+ \(2h ago\)/)).toBeInTheDocument();
    expect(identities.getByText(/Last seen .+ \(5m ago\)/)).toBeInTheDocument();
    expect(identities.getByText("Does not expire while associated")).toBeInTheDocument();
    expect(identities.getByText("Expires in 1d 2h")).toBeInTheDocument();
    expect(identities.getAllByRole("button", { name: /Delete recorded identity/ })).toHaveLength(2);
  });

  it("requires confirmation before deleting every recorded identity", async () => {
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<SpeakerProfilesConfig />);

    const deleteAll = await screen.findByRole("button", { name: "Delete all" });
    fireEvent.click(deleteAll);
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(deleteAll);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/voice/speaker-templates",
      { method: "DELETE" },
    ));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining(
      "Delete all 2 recorded voice identities?",
    ));
  });

  it("autosaves profile fields without an explicit save button", async () => {
    render(<SpeakerProfilesConfig />);

    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Adeline" } });
    fireEvent.blur(name);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/voice/speaker-profiles/person-addie",
      expect.objectContaining({ method: "PATCH" }),
    ));
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });
});
