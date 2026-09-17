/**
 * Shapes the face enrolment section works with. Split out of
 * `FaceEnrolmentConfig.tsx` (specs/agent-token-footprint.md §4).
 */

export type FaceSubject = {
  id: string;
  name: string;
  clips: number;
  ready: boolean;
  createdAt?: string;
};

export type EnrolProgress = { clipsSoFar: number; needed: number; remaining: number };

export type Tone = "ok" | "error" | "info";
