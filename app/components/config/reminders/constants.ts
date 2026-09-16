import { Circle, RectangleHorizontal, Square } from "lucide-react";
import type { ReminderOutlineShape } from "../../dashboard/reminderBarSettings";
import type { RosterEntry } from "./types";

export const OUTLINE_OPTIONS: { value: ReminderOutlineShape; label: string; Icon: typeof Circle }[] = [
  { value: "rounded-rect", label: "Rounded", Icon: RectangleHorizontal },
  { value: "circle", label: "Circle", Icon: Circle },
  { value: "square", label: "Square", Icon: Square },
];

export const SOURCE_LABELS: Record<RosterEntry["source"], string> = {
  user: "Yours",
  llm: "Auto",
  keyword: "Auto",
  fallback: "Default",
};
