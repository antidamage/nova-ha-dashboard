import { CalendarDays, ListTodo } from "lucide-react";
import type { Task } from "../../../lib/types";

export function TaskSourceIcon({ task }: { task: Task }) {
  if (task.source === "icloud-calendar") {
    return <CalendarDays className="h-4 w-4 text-cyan-200" aria-label="iCloud calendar" />;
  }
  if (task.source === "icloud-reminders") {
    return <ListTodo className="h-4 w-4 text-cyan-200" aria-label="iCloud reminder" />;
  }
  return null;
}
