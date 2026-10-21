import { normalizeRepository } from "../repository-name";
import { spawnGitHub } from "./process";
import { GitHubApiError } from "./errors";
import { configDirectory } from "../paths";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_RECENT = 100;

export async function repositoryFromDirectory(
  cwd: string,
): Promise<string | undefined> {
  const child = spawnGitHub(
    ["repo", "view", "--json", "nameWithOwner,url"],
    cwd,
  );
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 20_000);
  try {
    const [output, error, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (timedOut) throw new GitHubApiError("repository discovery", "Repository discovery timed out");
    if (exitCode !== 0) throw new GitHubApiError(
      "repository discovery",
      error.trim() || `gh repo view failed (${exitCode})`,
      exitCode === 4 ? 401 : undefined,
    );
    const repository = JSON.parse(output) as { nameWithOwner: string; url: string };
    // gh repo view can select a host from a Git remote even with GH_HOST set.
    if (!/^https:\/\/github\.com\//i.test(repository.url))
      throw new Error("Only GitHub.com repositories are supported; GitHub Enterprise remotes cannot be opened.");
    return normalizeRepository(repository.nameWithOwner);
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveRepository(
  argument: string | undefined,
  cwd: string,
  fromDirectory = repositoryFromDirectory,
) {
  if (!argument) return undefined;
  if (argument === ".") return fromDirectory(cwd);
  return normalizeRepository(argument);
}

export function recentRepositoriesPath() {
  return join(configDirectory(), "recent.json");
}

export async function loadRecentRepositories(
  path = recentRepositoriesPath(),
): Promise<string[]> {
  try {
    const value = await Bun.file(path).json();
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
      .flatMap((item) =>
        typeof item === "string" ? [normalizeRepository(item)] : [],
      )
      .filter((repository): repository is string => {
        if (!repository || seen.has(repository.toLowerCase())) return false;
        seen.add(repository.toLowerCase());
        return true;
      })
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export async function rememberRepository(
  repository: string,
  path = recentRepositoriesPath(),
) {
  const normalized = normalizeRepository(repository);
  if (!normalized) return;
  const recent = await loadRecentRepositories(path);
  const next = [
    normalized,
    ...recent.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ].slice(0, MAX_RECENT);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(next, null, 2) + "\n");
}
