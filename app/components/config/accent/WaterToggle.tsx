"use client";

import { SwitchRow } from "../../SlideSwitch";

export function WaterToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <SwitchRow
      checked={checked}
      label="Water Fill"
      detail={checked ? "Harbour fill is visible on the map" : "Water layer is hidden on the map"}
      onChange={onChange}
    />
  );
}
