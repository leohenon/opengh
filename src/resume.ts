import { join } from "node:path"
import type { DetailTarget, NavigationState, Page } from "./navigation"
import { normalizeRepository } from "./repository-name"
import { configDirectory } from "./paths"
import { atomicPrivateWrite, readPrivateJson } from "./filesystem"

export type ResumeLocation = { repository: string; state: NavigationState }

const pages: readonly Page[] = ["overview", "commits", "issues", "pulls", "actions"]
const detailPages = { commit: "commits", issue: "issues", pull: "pulls", run: "actions" } as const
const resumePath = () => join(configDirectory(), "resume.json")
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const positiveNumber = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0

function detailTarget(value: unknown): DetailTarget | undefined {
  const target = record(value)
  if (!target) return
  if (target.kind === "commit" && typeof target.sha === "string" && /^[a-f\d]{4,40}$/i.test(target.sha))
    return { kind: "commit", sha: target.sha.toLowerCase() }
  if ((target.kind === "issue" || target.kind === "pull") && positiveNumber(target.number))
    return { kind: target.kind, number: target.number }
  if (target.kind === "run" && positiveNumber(target.id)) return { kind: "run", id: target.id }
}

export function resumeLocation(repository: string, navigation: NavigationState): ResumeLocation {
  const { page } = navigation
  const detail = navigation.details?.[page]
  const diff = navigation.diffs?.[page]
  return { repository, state: {
    page,
    ...(detail ? { details: { [page]: detail } } : {}),
    ...(diff ? { diffs: { [page]: diff } } : {}),
    ...(page === "overview" && navigation.document ? { document: navigation.document } : {}),
  } }
}

function normalizeLocation(value: unknown): ResumeLocation | undefined {
  const location = record(value)
  const repository = typeof location?.repository === "string" && normalizeRepository(location.repository)
  const state = record(location?.state)
  if (!repository || !state || !pages.includes(state.page as Page)) return
  const page = state.page as Page
  const rawDetail = record(state.details)?.[page]
  const rawDiff = record(state.diffs)?.[page]
  const detail = detailTarget(rawDetail)
  const target = detailTarget(rawDiff)
  const diff = target?.kind === "commit" || target?.kind === "pull" ? target : undefined
  if (rawDetail !== undefined && (!detail || detailPages[detail.kind] !== page)) return
  if (rawDiff !== undefined && (!diff || detailPages[diff.kind] !== page)) return
  const document = typeof state.document === "string" && state.document.length <= 1024 && !/[\x00-\x1f\x7f]/.test(state.document)
    ? state.document : undefined
  return resumeLocation(repository, { page,
    ...(detail ? { details: { [page]: detail } } : {}),
    ...(diff ? { diffs: { [page]: diff } } : {}),
    document,
  })
}

export async function loadResume(path = resumePath()): Promise<ResumeLocation | undefined> {
  try {
    return normalizeLocation(await readPrivateJson(path, { maxBytes: 4096 }))
  } catch {
    return undefined
  }
}

export async function saveResume(location: ResumeLocation, path = resumePath()): Promise<void> {
  const normalized = normalizeLocation(location)
  if (!normalized) throw new Error("Invalid resume location")
  await atomicPrivateWrite(path, JSON.stringify(normalized) + "\n")
}

export function createResumeWriter(save: (location: ResumeLocation) => Promise<void>, delay = 250) {
  let dirty: ResumeLocation | undefined
  let pending: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous = ""
  const flush = (): Promise<void> | undefined => {
    clearTimeout(timer)
    timer = undefined
    if (pending) return pending.then(flush)
    if (!dirty) return
    const snapshot = dirty
    pending = Promise.resolve().then(() => save(snapshot)).then(() => {
      if (dirty === snapshot) dirty = undefined
    }).catch(() => {}).finally(() => { pending = undefined })
    return pending
  }
  return {
    remember(location: ResumeLocation) {
      const snapshot = resumeLocation(location.repository, location.state)
      const key = JSON.stringify(snapshot)
      if (key === previous) return
      previous = key
      dirty = snapshot
      clearTimeout(timer)
      timer = setTimeout(() => { void flush() }, delay)
    },
    flush,
  }
}
