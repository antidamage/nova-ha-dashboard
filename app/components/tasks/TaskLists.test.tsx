import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Task } from "../../../lib/types";
import { TaskLists } from "./TaskLists";

const now = new Date(2026, 4, 21, 12, 0, 0).getTime();

function localIso(dayOffset: number, hour: number) {
  const base = new Date(now);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0).toISOString();
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    name: "Medication",
    start: localIso(0, 9),
    createdAt: localIso(-1, 8),
    source: "local",
    readOnly: false,
    ...overrides,
  };
}

const renderRow = (item: Task) => <p key={item.id}>{item.name}</p>;

describe("TaskLists", () => {
  it("renders Today above Upcoming, each with its own reminders", () => {
    const { container } = render(
      <TaskLists
        nowMs={now}
        renderRow={renderRow}
        tasks={[
          task({ id: "later", name: "Bins", start: localIso(2, 9) }),
          task({ id: "today", name: "Medication", start: localIso(0, 9) }),
        ]}
      />,
    );

    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["Today", "Upcoming"]);

    const sections = container.querySelectorAll("[data-task-list]");
    expect(sections[0]).toHaveAttribute("data-task-list", "today");
    expect(within(sections[0] as HTMLElement).getByText("Medication")).toBeInTheDocument();
    expect(within(sections[0] as HTMLElement).queryByText("Bins")).not.toBeInTheDocument();
    expect(within(sections[1] as HTMLElement).getByText("Bins")).toBeInTheDocument();
    expect(within(sections[1] as HTMLElement).queryByText("Medication")).not.toBeInTheDocument();
  });

  it("keeps both headings with their empty lines when there are no reminders", () => {
    render(<TaskLists nowMs={now} renderRow={renderRow} tasks={[]} />);

    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Today", "Upcoming"]);
    expect(screen.getByText("No reminders today")).toBeInTheDocument();
    expect(screen.getByText("No upcoming reminders")).toBeInTheDocument();
  });
});
