import { normalizeRepository } from "../repository-name";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_RECENT = 8;

export async function repositoryFromDirectory(
  cwd: string,
): Promise<string | undefined> {
  try {
    const child = Bun.spawn(
      [
        "gh",
        "repo",
        "view",
        "--json",
        "nameWithOwner",
        "--jq",
        ".nameWithOwner",
      ],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      },
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
  const config =
    process.env.XDG_CONFIG_HOME || join(process.env.HOME || ".", ".config");
  return join(config, "opengh", "recent.json");
}

export async function loadRecentRepositories(
  path = recentRepositoriesPath(),
): Promise<string[]> {
  try {
    const value = await Bun.file(path).json();
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((item) =>
        typeof item === "string" ? [normalizeRepository(item)] : [],
      )
      .filter(Boolean)
      .slice(0, MAX_RECENT) as string[];
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
