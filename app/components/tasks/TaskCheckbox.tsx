import { Check } from "lucide-react";
import { classNames } from "./panel-model";

export function TaskCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={classNames("cyber-checkbox-row border p-3 text-left", checked && "cyber-checkbox-row-active")}
      onClick={() => onChange(!checked)}
    >
      <span className={classNames("cyber-checkbox", checked && "cyber-checkbox-checked")} aria-hidden="true">
        {checked ? <Check className="h-5 w-5" strokeWidth={3} /> : null}
      </span>
      <span className="theme-display-label zone-title-bar">{label}</span>
    </button>
  );
}
