import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stream = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: MessageEvent) => void>,
}));

vi.mock("../sharedDashboardEvents", () => ({
  subscribeToDashboardEvents: (handlers: Record<string, (event: MessageEvent) => void>) => {
    stream.handlers = handlers;
    return () => {};
  },
}));

import { NotificationStack } from "./NotificationStack";

function push(id: string, title: string) {
  act(() => {
    stream.handlers.notification({
      data: JSON.stringify({ id, title, severity: "info", createdAt: "2026-10-27T00:00:00Z", expiresAt: null }),
    } as MessageEvent);
  });
}

describe("NotificationStack Clear all", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is absent for one notification and present from two", () => {
    render(<NotificationStack />);
    push("a", "First");
    expect(screen.queryByRole("button", { name: "Clear all notifications" })).toBeNull();
    push("b", "Second");
    expect(screen.getByRole("button", { name: "Clear all notifications" }).textContent).toBe("Clear all (2)");
  });

  it("draws the reminder banner classes on every tappable element, so the reminder tap swallow lets taps through", () => {
    render(<NotificationStack />);
    push("a", "First");
    push("b", "Second");
    const clearAll = screen.getByRole("button", { name: "Clear all notifications" });
    const banner = screen.getByRole("button", { name: "Dismiss First notification" });
    expect(clearAll.closest(".task-alert-banner")).toBe(clearAll);
    expect(banner.closest(".task-alert-banner")).toBe(banner);
    expect(banner.querySelector(".task-alert-title")?.textContent).toBe("First");
  });

  it("dismisses one notification when its banner is tapped", () => {
    render(<NotificationStack />);
    push("a", "First");
    push("b", "Second");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss First notification" }));
    expect(fetchMock.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["/api/notifications?id=a"]);
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear all notifications" })).toBeNull();
  });

  it("dismisses only the notifications showing, by id, and ignores a 404", () => {
    render(<NotificationStack />);
    push("a", "First");
    push("b", "Second");
    fireEvent.click(screen.getByRole("button", { name: "Clear all notifications" }));
    expect(fetchMock.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "/api/notifications?id=a",
      "/api/notifications?id=b",
    ]);
    expect(screen.queryByText("First")).toBeNull();
    push("c", "Third");
    expect(screen.getByText("Third")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
