export type UpdatePhase =
  | "idle"
  | "queued"
  | "checking"
  | "building"
  | "restarting"
  | "verifying"
  | "success"
  | "failed"
  | "rolledback";

/** Written by the host updater (nova-release). The app never writes this. */
export type UpdaterState = {
  schema: number;
  currentSha?: string;
  currentRef?: string;
  deployedAt?: string;
  previousSha?: string;
  phase?: UpdatePhase;
  phaseMessage?: string;
  phaseAt?: string;
  canRollback?: boolean;
  releases?: Array<{
    sha: string;
    builtAt?: string;
    current?: boolean;
    previous?: boolean;
  }>;
};

export type UpdateCheck = {
  checkedAt: string;
  ok: boolean;
  branch?: string;
  latestSha?: string;
  latestMessage?: string;
  latestCommittedAt?: string;
  error?: string;
};

export type UpdateControlAction = "apply" | "rollback";

export type UpdateControlRequest = {
  id: string;
  action: UpdateControlAction;
  sha?: string;
  requestedAt: string;
  requestedBy: string;
};

export type UpdateStatus = {
  channel: { repo: string; branch: string };
  currentSha: string | null;
  currentShortSha: string | null;
  deployedAt: string | null;
  latestSha: string | null;
  latestShortSha: string | null;
  latestMessage: string | null;
  updateAvailable: boolean;
  autoUpdate: boolean;
  showUpdatesOnHome: boolean;
  canRollback: boolean;
  previousSha: string | null;
  phase: UpdatePhase;
  phaseMessage: string | null;
  phaseAt: string | null;
  lastCheckedAt: string | null;
  checkOk: boolean;
  checkError: string | null;
  busy: boolean;
};
