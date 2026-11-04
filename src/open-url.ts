import { parseSafeUrl } from "./link-target"

export async function openUrl(url: string): Promise<void> {
  if (!parseSafeUrl(url)) throw new Error("Cannot open URL: expected a safe absolute HTTP, HTTPS, or mailto URL")
  const command = process.platform === "darwin" ? ["open", url]
    : process.platform === "linux" ? ["xdg-open", url]
    : process.platform === "win32" ? [
      "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
      "Start-Process -FilePath $env:OPENGH_OPEN_URL -ErrorAction Stop",
    ] : undefined
  if (!command) throw new Error(`Opening URLs is not supported on ${process.platform}`)

  try {
    // Windows receives the URL as data, never as PowerShell or cmd source text.
    const child = Bun.spawn(command, {
      env: { ...process.env, OPENGH_OPEN_URL: url },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, 20_000)
    try {
      const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
      if (timedOut) throw new Error(`${command[0]} timed out after 20 seconds`)
      if (code !== 0) throw new Error(error.trim() || `${command[0]} failed (exit code ${code})`)
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    throw new Error(`Could not open URL using ${command[0]}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
