import type { ReactNode } from "react";
import type { Task } from "../../../lib/types";
import { taskStartMs, taskVisibleInTab, type TaskTab } from "./task-model";

const LISTS: { tab: TaskTab; heading: string; empty: string }[] = [
  { tab: "today", heading: "Today", empty: "No reminders today" },
  { tab: "upcoming", heading: "Upcoming", empty: "No upcoming reminders" },
];

export function tasksForList(tasks: Task[], tab: TaskTab, nowMs: number): Task[] {
  return tasks
    .filter((task) => taskVisibleInTab(task, tab, nowMs))
    .sort((left, right) => taskStartMs(left) - taskStartMs(right));
}

/** Today and Upcoming as two stacked lists, Today first. */
export function TaskLists({
  tasks,
  nowMs,
  renderRow,
}: {
  tasks: Task[];
  nowMs: number;
  renderRow: (task: Task) => ReactNode;
}) {
  return (
    <>
      {LISTS.map(({ tab, heading, empty }) => {
        const listTasks = tasksForList(tasks, tab, nowMs);
        return (
          <section key={tab} className="grid gap-3" aria-labelledby={`tasks-list-${tab}`} data-task-list={tab}>
            <h3 id={`tasks-list-${tab}`} className="text-sm font-black uppercase text-cyan-100">{heading}</h3>
            {listTasks.length ? (
              listTasks.map((task) => renderRow(task))
            ) : (
              <div className="border border-neutral-700 bg-neutral-950/70 p-4 font-mono text-sm font-black uppercase text-neutral-500">
                {empty}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
