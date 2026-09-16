"use client";

import { useState } from "react";
import type { ZoneLightRuleValue } from "../../../../lib/zone-light-rules";
import { hsvToRgb } from "../../colorEncoderModel";
import { ZoneColorEncoder } from "./ZoneColorEncoder";

export function ValueEncoder({
  ruleId,
  value,
  zoneId,
  onCommit,
}: {
  ruleId: string;
  value: ZoneLightRuleValue;
  zoneId: string;
  onCommit: (value: ZoneLightRuleValue) => void;
}) {
  // The dial moves locally while dragged and saves on release.
  const [draft, setDraft] = useState<ZoneLightRuleValue | null>(null);
  const shown = draft ?? value;
  return (
    <ZoneColorEncoder
      brightness={shown.brightnessPct}
      colorEnabled
      disabled={false}
      label="Sets"
      size={100}
      spectrum={{
        cursor: { x: shown.hue / 359, y: 1 - shown.saturation / 100 },
        preview: hsvToRgb(shown.hue, shown.saturation, 100),
      }}
      zoneId={`${zoneId}:${ruleId}`}
      onBrightnessChange={(brightnessPct) => setDraft({ ...shown, brightnessPct })}
      onBrightnessCommit={(brightnessPct) => {
        setDraft(null);
        onCommit({ ...shown, brightnessPct });
      }}
      onColorCommit={(_rgb, brightnessPct, cursor) => {
        setDraft(null);
        onCommit({ hue: Math.round(cursor.x * 359), saturation: Math.round((1 - cursor.y) * 100), brightnessPct });
      }}
      onSpectrumChange={(spectrum) =>
        setDraft({ ...shown, hue: Math.round(spectrum.cursor.x * 359), saturation: Math.round((1 - spectrum.cursor.y) * 100) })}
    />
  );
}
