import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TasksAdvanced } from "./TasksAdvanced";

describe("TasksAdvanced", () => {
  it("shows the lists when no editor is open", () => {
    render(<TasksAdvanced editor={null} lists={<p>Today list</p>} onBack={() => undefined} />);
    expect(screen.getByText("Today list")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("replaces the lists with the editor under a back arrow that cancels", () => {
    const onBack = vi.fn();
    render(<TasksAdvanced editor={<form aria-label="editor" />} lists={<p>Today list</p>} onBack={onBack} />);
    expect(screen.queryByText("Today list")).not.toBeInTheDocument();
    const back = screen.getByRole("button", { name: "Back" });
    const editor = screen.getByRole("form", { name: "editor" });
    expect(back.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
