import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HouseholdPerson } from "../../lib/config-schema";
import { WashWhoSelect } from "./laundry-client";

/**
 * The laundry page's claim field (specs/power-meters.md §5.3).
 *
 * It is a plain `<select>` on purpose — the dashboard's themed, portalled listbox
 * is app furniture on a printed bill — so what is worth pinning is what a pick
 * *sends* (the chosen id, never a step in config order), and what the row *shows*,
 * which is only ever the name the page was rendered with.
 *
 * That last part is the whole design and it was arrived at twice: an optimistic
 * value cleared when the response landed put the owner from before the write back
 * on screen for as long as the refresh took, and one held until the read agreed
 * could never clear when the store's answer came back different, leaving the row
 * naming somebody the store did not hold beside totals, rendered from that same
 * store, that named somebody else.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const PEOPLE: HouseholdPerson[] = [
  { arrival: [], color: "#22d3ee", departure: [], id: "addie", label: "Addie", primary: true },
  { arrival: [], color: "#e879f9", departure: [], id: "tonya", label: "Tonya" },
];

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

/** A write that has not answered yet, so the in-flight state can be observed. */
function stubPendingFetch() {
  let settle: (response: { ok: boolean }) => void = () => undefined;
  const fetchMock = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { settle = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: (ok: boolean) => settle({ ok }) };
}

function stubFetch(ok = true) {
  const fetchMock = vi.fn(async () => ({ ok }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodyOf = (fetchMock: ReturnType<typeof stubFetch>) =>
  JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body));

const field = () => screen.getByRole("combobox", { name: /Who ran this wash/ }) as HTMLSelectElement;
const shownValue = () => (field().selectedOptions[0]?.textContent ?? "").trim();

describe("claiming a wash from the laundry page", () => {
  it("sends the person that was picked, not the next one in config order", async () => {
    const fetchMock = stubFetch();
    render(<WashWhoSelect cycleId="wash-1" people={PEOPLE} person="tonya" />);

    fireEvent.change(field(), { target: { value: "addie" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock)).toEqual({ cycleId: "wash-1", person: "addie" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("clears the owner with null rather than stepping to the next person", async () => {
    const fetchMock = stubFetch();
    render(<WashWhoSelect cycleId="wash-1" people={PEOPLE} person="addie" />);

    fireEvent.change(field(), { target: { value: "" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock)).toEqual({ cycleId: "wash-1", person: null });
  });

  it("claims the wash under way through the active path", async () => {
    const fetchMock = stubFetch();
    render(<WashWhoSelect active cycleId="running" people={PEOPLE} person={null} />);

    fireEvent.change(field(), { target: { value: "tonya" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock)).toEqual({ active: true, cycleId: "running", person: "tonya" });
  });

  it("offers every configured person and Unassigned", () => {
    render(<WashWhoSelect cycleId="wash-1" people={PEOPLE} person={null} />);

    expect([...field().options].map((option) => option.textContent)).toEqual(["Addie", "Tonya", "Unassigned"]);
    expect(shownValue()).toBe("Unassigned");
  });

  it("shows the server's answer only, and says it is working while the write is in flight", async () => {
    // The row must NOT carry the pick before the read does: a name on screen that
    // the store does not hold reads as a claim that was made, and this page is
    // read as a bill — beside totals rendered from that same store.
    const { release } = stubPendingFetch();
    const { rerender } = render(<WashWhoSelect cycleId="wash-1" people={PEOPLE} person="tonya" />);

    fireEvent.change(field(), { target: { value: "addie" } });

    expect(shownValue()).toBe("Tonya");
    expect(field().value).toBe("tonya");
    expect(screen.getByText("Saving…")).toBeTruthy();
    expect(field()).toBeDisabled();

    // The write lands; the refreshed render arrives carrying it.
    release(true);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    rerender(<WashWhoSelect cycleId="wash-1" people={PEOPLE} person="addie" />);
    expect(shownValue()).toBe("Addie");
    await waitFor(() => expect(screen.queryByText("Saving…")).toBeNull());
  });

  it("keeps showing the store's answer when a later read disagrees with the pick", async () => {
    // The defect the optimistic overlay could not avoid: another screen names the
    // same wash between the write and the read. The read wins, because the read is
    // the store — and the totals and the printed sheet on this page are rendered
    // from that same store, so the row cannot be allowed to say something else.
    stubFetch();
    const { rerender } = render(<WashWhoSelect cycleId="wash-1" people={PEOPLE} person={null} />);

    fireEvent.change(field(), { target: { value: "addie" } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    rerender(<WashWhoSelect cycleId="wash-1" people={PEOPLE} person="tonya" />);

    expect(shownValue()).toBe("Tonya");
    expect(document.querySelector(".laundry-who-printed")?.textContent).toContain("Tonya");
  });

  it("shows a person this household no longer configures as Unassigned", () => {
    // The store holds `tonya`; this household configures somebody else under a
    // new id. That wash counts as unassigned in the totals, so the field must read
    // the same way rather than wearing the first configured person's name.
    render(<WashWhoSelect cycleId="wash-1" people={[{ arrival: [], color: "#22d3ee", departure: [], id: "addie", label: "Addie", primary: true }]} person="tonya" />);

    expect(shownValue()).toBe("Unassigned");
    expect(field().value).toBe("");
  });

  it("says so when the write is refused, and shows the store's answer still", async () => {
    stubFetch(false);
    render(<WashWhoSelect cycleId="wash-1" people={PEOPLE} person="addie" />);

    fireEvent.change(field(), { target: { value: "tonya" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved");
    expect(refresh).not.toHaveBeenCalled();
    expect(shownValue()).toBe("Addie");
    expect(field()).not.toBeDisabled();
  });
});
