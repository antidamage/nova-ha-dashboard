/**
 * What the Apple TV's app last did with a preset press, as it reports it back
 * (`POST /api/appletv/command/result`) and as `GET /api/appletv` carries it.
 *
 * Its own module because two things read it — the amp store, which publishes it,
 * and the preset editor, which shows it — and because the store is close to the
 * repo's file-size cap, where a shared type and its reader are the cheapest
 * thing to lift out (specs/agent-token-footprint.md).
 */

export type AppleTVPlayResult = {
  at: string;
  /** The command this answers. */
  id: number;
  /** The preset that was asked for. */
  name: string;
  played: boolean;
  /** Why it did not play, when it did not — the app's own words. */
  reason: string | null;
};

/** The app's reported outcome, or nothing at all when it is not one. */
export function readPlayResult(value: unknown): AppleTVPlayResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<Record<keyof AppleTVPlayResult, unknown>>;
  if (typeof record.id !== "number" || typeof record.name !== "string" || typeof record.at !== "string") return null;
  return {
    at: record.at,
    id: record.id,
    name: record.name,
    played: record.played === true,
    reason: typeof record.reason === "string" && record.reason ? record.reason : null,
  };
}
