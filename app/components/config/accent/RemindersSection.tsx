"use client";

import { TASK_GLOW_INTENSITY_DEFAULT } from "../../accentColor";
import type { DeviceTheme } from "../../theme/accent/types";
import type { SetConfigTheme } from "./accent-config-model";
import { TaskGlowIntensityControl } from "./TaskGlowIntensityControl";
import { TaskReminderAudioControl } from "./TaskReminderAudioControl";

export function RemindersSection({
  highlightRgb,
  previewTaskGlow,
  setTaskReminderAudioExists,
  setTheme,
  theme,
}: {
  highlightRgb: [number, number, number];
  previewTaskGlow: () => void;
  setTaskReminderAudioExists: (exists: boolean) => void;
  setTheme: SetConfigTheme;
  theme: DeviceTheme;
}) {
  return (
            <div className="grid gap-3">
              <TaskGlowIntensityControl
                color={highlightRgb}
                value={theme.taskGlowIntensity ?? TASK_GLOW_INTENSITY_DEFAULT}
                onPreview={(taskGlowIntensity) => setTheme({ ...theme, taskGlowIntensity }, { persist: false })}
                onCommit={(taskGlowIntensity) => setTheme({ ...theme, taskGlowIntensity })}
                onReleased={previewTaskGlow}
              />
              <TaskReminderAudioControl onStatusChange={setTaskReminderAudioExists} />
            </div>
  );
}
