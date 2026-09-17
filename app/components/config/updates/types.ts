// Update-channel status shape shared by the Updates section. Zero runtime.
export type UpdateStatus = {
  channel: { repo: string; branch: string };
  currentShortSha: string | null;
  deployedAt: string | null;
  latestShortSha: string | null;
  latestMessage: string | null;
  updateAvailable: boolean;
  autoUpdate: boolean;
  showUpdatesOnHome: boolean;
  canRollback: boolean;
  previousSha: string | null;
  phase: string;
  phaseMessage: string | null;
  lastCheckedAt: string | null;
  checkOk: boolean;
  checkError: string | null;
  busy: boolean;
};
