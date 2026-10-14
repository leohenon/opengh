import { normalizeRepository } from "../repository-name";
import { spawnGitHub } from "./process";
import { configDirectory } from "../paths";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_RECENT = 100;

export async function repositoryFromDirectory(
  cwd: string,
): Promise<string | undefined> {
  try {
    const child = spawnGitHub(
      [
        "repo",
        "view",
        "--json",
        "nameWithOwner",
        "--jq",
        ".nameWithOwner",
      ],
      cwd,
    );
    const [output, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    if (exitCode !== 0) return undefined;
    return normalizeRepository(output);
  } catch {
    return undefined;
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
