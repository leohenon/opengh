const children = new Set<Bun.Subprocess>()
let stopping = false

export async function copyToHostClipboard(text: string): Promise<boolean> {
  if (stopping) throw new Error("Application is shutting down")
  // A native tool over SSH would copy to the server, not the user's terminal.
  if (process.env.SSH_TTY || process.env.SSH_CONNECTION || process.env.SSH_CLIENT) return false

  let candidates: string[][] = []
  if (process.platform === "darwin") {
    candidates = [["pbcopy"]]
  } else if (process.platform === "linux") {
    if (process.env.WAYLAND_DISPLAY || process.env.WAYLAND_SOCKET || process.env.XDG_SESSION_TYPE === "wayland") {
      candidates.push(["wl-copy"])
    }
    if (process.env.DISPLAY) {
      candidates.push(["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"])
    }
  }

  for (const [command, ...args] of candidates) {
    if (!command) continue
    const executable = Bun.which(command)
    if (!executable) continue

    // Clipboard tools may fork a background owner that inherits stdout/stderr.
    // Ignore those streams so completion depends only on the original process.
    const child = Bun.spawn([executable, ...args], {
      stdin: new TextEncoder().encode(text),
      stdout: "ignore",
      stderr: "ignore",
    })
    children.add(child)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, 3000)
    try {
      const exitCode = await child.exited
      if (timedOut) throw new Error(`${command} timed out after 3 seconds`)
      if (exitCode !== 0) throw new Error(`${command} failed (exit code ${exitCode})`)
      return true
    } finally {
      clearTimeout(timer)
      children.delete(child)
    }
  }
  return false
}

export async function stopClipboardProcesses(): Promise<void> {
  stopping = true
  const active = [...children]
  for (const child of active) child.kill("SIGKILL")
  await Promise.allSettled(active.map((child) => child.exited))
}
