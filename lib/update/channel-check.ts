// Outbound: asks the update channel for the branch head commit and caches the
// answer. One request shape serves GitHub and Forgejo/Gitea, and there is
// deliberately no provider switch — the two hosts differ in nothing this file
// cares about. The request and response shapes were probed on both; see
// specs/self-update-channel.md.
import { readDashboardConfig } from "../dashboard-config";
import { CHECK_PATH, UPDATE_CHECK_TIMEOUT_MS } from "./constants";
import { writeJsonAtomic } from "./store";
import type { UpdateCheck } from "./types";

type ChannelCommit = {
  sha?: string;
  commit?: { message?: string; committer?: { date?: string } };
};

/**
 * The list-commits endpoint answers with an array on both hosts, because the
 * branch goes in the query string: `/commits/{branch}` is GitHub-only and 404s
 * on Forgejo. A bare object is tolerated so a future provider that insists on
 * the path form still parses.
 */
function headCommit(payload: unknown): ChannelCommit | null {
  const entry = Array.isArray(payload) ? payload[0] : payload;
  return entry && typeof entry === "object" ? entry as ChannelCommit : null;
}

function token(): string | undefined {
  return process.env.NOVA_UPDATE_TOKEN?.trim() || process.env.NOVA_GITHUB_TOKEN?.trim() || undefined;
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  const config = await readDashboardConfig();
  const { apiBase, repo, branch } = config.update;
  const root = apiBase.replace(/\/+$/, "");
  const url =
    `${root}/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1&limit=1`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "nova-ha-dashboard-updater",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const bearer = token();
    if (bearer) {
      // "Bearer" is accepted by GitHub and by Forgejo/Gitea alike.
      headers.Authorization = `Bearer ${bearer}`;
    }

    const response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      const check: UpdateCheck = {
        checkedAt: new Date().toISOString(),
        ok: false,
        branch,
        error: `Update channel responded ${response.status}`,
      };
      await writeJsonAtomic(CHECK_PATH, check);
      return check;
    }

    const commit = headCommit(await response.json());
    const check: UpdateCheck = {
      checkedAt: new Date().toISOString(),
      ok: Boolean(commit?.sha),
      branch,
      latestSha: commit?.sha,
      latestMessage: commit?.commit?.message?.split("\n", 1)[0],
      latestCommittedAt: commit?.commit?.committer?.date,
      error: commit?.sha ? undefined : "Update channel response missing sha",
    };
    await writeJsonAtomic(CHECK_PATH, check);
    return check;
  } catch (error) {
    const check: UpdateCheck = {
      checkedAt: new Date().toISOString(),
      ok: false,
      branch,
      error:
        (error as Error)?.name === "AbortError"
          ? "Update check timed out"
          : (error as Error)?.message ?? "Update check failed",
    };
    await writeJsonAtomic(CHECK_PATH, check);
    return check;
  } finally {
    clearTimeout(timer);
  }
}
