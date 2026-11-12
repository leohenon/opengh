#!/usr/bin/env node
"use strict"

// Published as the `opengh` command of the npm package. The executable itself comes from the
// optional dependency built for this platform; this file only finds and runs it.
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")

function usesMusl() {
  if (process.platform !== "linux") return false
  try { return !process.report.getReport().header.glibcVersionRuntime }
  catch { return fs.existsSync("/etc/alpine-release") }
}

// Package managers that ignore "libc" install both Linux variants, so the choice is made here.
const musl = usesMusl()
const name = `opengh-${process.platform}-${process.arch}${musl ? "-musl" : ""}`
let executable
try { executable = require.resolve(`${name}/bin/opengh`) }
catch {
  console.error(`opengh: no executable is installed for ${process.platform} ${process.arch}${musl ? " (musl)" : ""}.
Reinstall without omitting optional dependencies (they provide ${name}),
or download a release from https://github.com/leohenon/opengh/releases.`)
  process.exit(1)
}

// Some package managers drop the executable bit when unpacking.
try { if (!(fs.statSync(executable).mode & 0o111)) fs.chmodSync(executable, 0o755) } catch {}

const result = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" })
if (result.error) {
  console.error(`opengh: ${result.error.message}`)
  process.exit(1)
}
// End the way the application did, so that shells and scripts see the same outcome.
if (result.signal) process.kill(process.pid, result.signal)
process.exit(result.status ?? 1)
