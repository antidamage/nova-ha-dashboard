import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArrivalConfig } from "./ArrivalConfig";

const payload = {
  members: [
    {
      id: "ada",
      label: "Ada",
      color: "#22d3ee",
      primary: true,
      arrival: [{ target: "lighting", presetId: "adaptive-office" }],
      departure: [],
    },
  ],
  targets: [
    { kind: "lighting", label: "Lighting" },
    { kind: "climate", label: "Air conditioning" },
    { kind: "volume", label: "Volume" },
  ],
  presets: {
    lighting: [{ id: "adaptive-office", label: "Office · Adaptive", group: "Office" }],
    climate: [],
    volume: [],
  },
};

function stubFetch() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "PUT" ? { json: async () => payload, ok: true } : { json: async () => payload, ok: true },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The accordion is collapsed by default; its body only exists once opened. */
async function openSection() {
  const header = screen.getByRole("button", { name: /Arrival & Departure/ });
  fireEvent.click(header);
  return header;
}

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ArrivalConfig", () => {
  it("lists the members, their states and each target's presets", async () => {
    stubFetch();

    render(<ArrivalConfig />);
    await openSection();

    expect(await screen.findByDisplayValue("Ada")).toBeInTheDocument();
    expect(screen.getByText("Office · Adaptive")).toBeInTheDocument();
    // The targets with no presets are named rather than shown as empty pickers.
    expect(screen.getByText(/No air conditioning presets are defined yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No volume presets are defined yet/i)).toBeInTheDocument();
  });

  it("saves a new member by PUTting the whole people array", async () => {
    const fetchMock = stubFetch();

    render(<ArrivalConfig />);
    await openSection();
    fireEvent.click(await screen.findByRole("button", { name: "Add person" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/arrivals", expect.objectContaining({ method: "PUT" })),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const body = JSON.parse(String((put?.[1] as RequestInit).body)) as {
      people: Array<{ id: string; label: string; primary: boolean; arrival: unknown[] }>;
    };

    expect(body.people).toHaveLength(2);
    expect(body.people[1]).toMatchObject({
      id: "new-person",
      label: "New person",
      primary: false,
      arrival: [],
      departure: [],
    });
  });

  it("shows the endpoint a member answers to, and refuses to remove the last one", async () => {
    const fetchMock = stubFetch();

    render(<ArrivalConfig />);
    await openSection();
    await screen.findByDisplayValue("Ada");

    expect(screen.getByText("/api/arrival/ada")).toBeInTheDocument();
    // The only member cannot be removed: the endpoints need someone to answer to.
    expect(screen.getByRole("button", { name: "Remove Ada" })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });

  it("offers only targets that have a preset", async () => {
    stubFetch();

    render(<ArrivalConfig />);
    await openSection();
    await screen.findByDisplayValue("Ada");

    fireEvent.click(screen.getAllByRole("button", { name: "Arrival target" })[0]);

    const names = screen.getAllByRole("option").map((option) => option.textContent ?? "");
    expect(names).toEqual(["Lighting"]);
  });

  it("adds an arrival state from the presets that exist", async () => {
    const fetchMock = stubFetch();

    render(<ArrivalConfig />);
    await openSection();
    fireEvent.click(await screen.findByRole("button", { name: "Add arrival state" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const body = JSON.parse(String((put?.[1] as RequestInit).body)) as {
      people: Array<{ arrival: Array<{ target: string; presetId: string }> }>;
    };

    expect(body.people[0].arrival).toHaveLength(2);
    expect(body.people[0].arrival[1]).toEqual({ target: "lighting", presetId: "adaptive-office" });
  });
});
