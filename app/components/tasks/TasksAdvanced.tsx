import { ArrowLeft } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * The Reminders panel's Advanced region: the lists (with their action rows), or
 * — while a reminder is being added, edited or viewed — that editor in their
 * place, under a back arrow that cancels. specs/tasks-panel.md "Round 2".
 */
export function TasksAdvanced({
  editor,
  lists,
  onBack,
}: {
  editor: ReactNode | null;
  lists: ReactNode;
  onBack: () => void;
}) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const showingEditor = Boolean(editor);

  // Switching views lands on the new view's start: the fold scrolls so the
  // view's top (landscape) or left edge (portrait) meets its own. That is still
  // past the line, so the fold stays open.
  useLayoutEffect(() => {
    const view = viewRef.current;
    const fold = view?.closest<HTMLElement>(".advanced-fold");
    if (!view || !fold) return;
    const viewBox = view.getBoundingClientRect();
    const foldBox = fold.getBoundingClientRect();
    if (fold.dataset.axis === "x") fold.scrollLeft += viewBox.left - foldBox.left;
    else fold.scrollTop += viewBox.top - foldBox.top;
  }, [showingEditor]);

  if (editor) {
    return (
      <div ref={viewRef} className="tasks-advanced-cell tasks-editor-view grid content-start gap-3" data-tasks-view="editor">
        <button
          aria-label="Back"
          className="tasks-editor-back inline-flex h-11 w-11 items-center justify-center border border-neutral-700"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {editor}
      </div>
    );
  }
  return (
    <div ref={viewRef} className="tasks-advanced-cell tasks-list-view grid content-start gap-3" data-tasks-view="lists">
      {lists}
    </div>
  );
}
