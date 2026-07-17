export type TaskReminderAudioStatus = {
  exists: boolean;
  size?: number;
  updatedAt?: string;
};

export const TASK_REMINDER_AUDIO_PATH = "/api/tasks/audio";

export async function loadTaskReminderAudioStatus() {
  const response = await fetch(`${TASK_REMINDER_AUDIO_PATH}?status=1`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to read reminder audio");
  }
  return payload as TaskReminderAudioStatus;
}

export async function uploadTaskReminderAudio(file: File) {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(TASK_REMINDER_AUDIO_PATH, {
    method: "POST",
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to upload reminder audio");
  }
  return payload as TaskReminderAudioStatus;
}

export async function removeTaskReminderAudio() {
  const response = await fetch(TASK_REMINDER_AUDIO_PATH, { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to remove reminder audio");
  }
  return payload as TaskReminderAudioStatus;
}
