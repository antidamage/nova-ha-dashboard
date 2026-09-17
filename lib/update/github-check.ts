// Outbound: asks GitHub for the channel's head commit and caches the answer.
import { readDashboardConfig } from "../dashboard-config";
import { CHECK_PATH, GITHUB_CHECK_TIMEOUT_MS } from "./constants";
import { writeJsonAtomic } from "./store";
import type { UpdateCheck } from "./types";

export async function checkGitHubForUpdate(): Promise<UpdateCheck> {
  const config = await readDashboardConfig();
  const { repo, branch } = config.update;
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_CHECK_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "nova-ha-dashboard-updater",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const token = process.env.NOVA_GITHUB_TOKEN?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      const check: UpdateCheck = {
        checkedAt: new Date().toISOString(),
        ok: false,
        branch,
        error: `GitHub responded ${response.status}`,
      };
      await writeJsonAtomic(CHECK_PATH, check);
      return check;
    }

    const data = (await response.json()) as {
      sha?: string;
      commit?: { message?: string; committer?: { date?: string } };
    };
    const check: UpdateCheck = {
      checkedAt: new Date().toISOString(),
      ok: Boolean(data.sha),
      branch,
      latestSha: data.sha,
      latestMessage: data.commit?.message?.split("\n", 1)[0],
      latestCommittedAt: data.commit?.committer?.date,
      error: data.sha ? undefined : "GitHub response missing sha",
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
          ? "GitHub check timed out"
          : (error as Error)?.message ?? "GitHub check failed",
    };
    await writeJsonAtomic(CHECK_PATH, check);
    return check;
  } finally {
    clearTimeout(timer);
  }
}
