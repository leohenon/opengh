import { join } from "node:path"

export const root = join(import.meta.dir, "..")
export const dist = join(root, "dist")

// One executable per entry. Linux builds embed exactly one libc variant of OpenTUI's native library.
export const targets: Record<string, { os: "darwin" | "linux"; cpu: "arm64" | "x64"; libc?: "glibc" | "musl" }> = {
  "darwin-arm64": { os: "darwin", cpu: "arm64" },
  "darwin-x64": { os: "darwin", cpu: "x64" },
  "linux-x64": { os: "linux", cpu: "x64", libc: "glibc" },
  "linux-arm64": { os: "linux", cpu: "arm64", libc: "glibc" },
  "linux-x64-musl": { os: "linux", cpu: "x64", libc: "musl" },
  "linux-arm64-musl": { os: "linux", cpu: "arm64", libc: "musl" },
}
