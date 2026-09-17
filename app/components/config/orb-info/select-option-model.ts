// Turn a value list plus a label table into ConfigSelect options.
import type { ConfigSelectOption } from "../../ConfigSelect";

export function options<T extends string>(values: T[], labels: Partial<Record<T, string>>): ConfigSelectOption<T>[] {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}
