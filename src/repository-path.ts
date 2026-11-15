import { isAbsolute } from "node:path"

export function isRepositoryPath(value: string): boolean {
  return value === "." || value === ".." || isAbsolute(value) || value.startsWith("./") || value.startsWith("../") || value.startsWith("~/")
}
