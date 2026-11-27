import { join } from "node:path"
import { atomicPrivateWrite, readPrivateJson } from "./filesystem"
import { configDirectory } from "./paths"

const shortcutTipPath = () => join(configDirectory(), "shortcut-tip.json")

export async function shouldOfferShortcutTip(path = shortcutTipPath()): Promise<boolean> {
  try {
    return (await readPrivateJson(path, { maxBytes: 64 })) !== true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT"
  }
}

export async function saveShortcutTipShown(path = shortcutTipPath()): Promise<void> {
  await atomicPrivateWrite(path, "true\n")
}
