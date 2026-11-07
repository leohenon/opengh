import { userInfo } from "node:os"
import { isAbsolute, join } from "node:path"

export function configDirectory() {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && isAbsolute(xdg)) return join(xdg, "opengh")
  const home = process.env.HOME
  // userInfo reads the OS account rather than honoring an invalid HOME value.
  const fallback = home && isAbsolute(home) ? home : userInfo().homedir
  if (!isAbsolute(fallback)) throw new Error("Home directory must be absolute")
  return join(fallback, ".config", "opengh")
}
