import type { ReactionCounts, ReactionKind } from "../models"

const kinds: ReactionKind[] = ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"]
const contents: Record<string, ReactionKind> = {
  THUMBS_UP: "+1", THUMBS_DOWN: "-1", LAUGH: "laugh", HOORAY: "hooray",
  CONFUSED: "confused", HEART: "heart", ROCKET: "rocket", EYES: "eyes",
}

export function parseReactions(value: unknown): ReactionCounts | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const source = value as Record<string, unknown>
  const result: ReactionCounts = {}
  for (const kind of kinds) {
    const count = source[kind]
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) result[kind] = count
  }
  return result
}

export function parseReactionGroups(value: unknown): ReactionCounts | undefined {
  if (!Array.isArray(value)) return
  const result: ReactionCounts = {}
  for (const group of value) {
    const kind = contents[group?.content]
    const count = group?.users?.totalCount
    if (kind && typeof count === "number" && Number.isSafeInteger(count) && count >= 0) result[kind] = count
  }
  return result
}
