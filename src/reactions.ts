import { reactionKinds, type ReactionKind, type ReactionTarget } from "./models"

export function reactionKey(target: ReactionTarget): string {
  if (!Number.isSafeInteger(target.number) || target.number <= 0) throw new Error("Invalid reaction parent number.")
  if (target.nodeId !== undefined && (typeof target.nodeId !== "string" || !target.nodeId.trim()
    || target.kind === "review-comment" && target.nodeId !== target.id)) throw new Error("Invalid reaction subject ID.")
  if (target.kind === "issue" || target.kind === "pull") return `${target.kind}:${target.number}:body`
  if (target.kind === "comment" && (target.parent === "issue" || target.parent === "pull")
    && Number.isSafeInteger(target.id) && target.id > 0) return `${target.parent}:${target.number}:comment:${target.id}`
  if (target.kind === "review-comment" && typeof target.id === "string" && target.id.trim()) return `pull:${target.number}:review-comment:${target.id}`
  throw new Error("Invalid reaction target.")
}

export function validateReactionKind(kind: ReactionKind) {
  if (!(reactionKinds as readonly string[]).includes(kind)) throw new Error("Unsupported reaction kind.")
}

export function reactionParent(target: ReactionTarget): "issue" | "pull" {
  return target.kind === "comment" ? target.parent : target.kind === "review-comment" ? "pull" : target.kind
}
