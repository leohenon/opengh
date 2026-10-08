#!/usr/bin/env bun

import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const child = Bun.spawn([
  process.execPath,
  "--config",
  resolve(root, "bunfig.toml"),
  resolve(root, "src/index.tsx"),
  ...process.argv.slice(2),
], {
  cwd: process.cwd(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await child.exited)
