import { TextAttributes, type BoxRenderable } from "@opentui/core"
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import type { MergeCheck } from "../../command-actions"
import type { ComposeDraft, ComposeDrafts } from "../../compose-drafts"
import type { NewPull, Paginated, PullBranchComparison, PullComparison, PullRepositories, PullRepository } from "../../models"
import type { ResourceState } from "../../repository-state"
import { GitHubApiError } from "../../github/transport"
import { fitText } from "../format"
import { mouseClick } from "../mouse"
import { useTheme } from "../theme"
import { BranchPicker } from "./branch-picker"
import { ComposeDialog, type ComposeControls } from "./compose-dialog"
import { LoadingText } from "./loading-text"
import { RepositoryPicker } from "./repository-picker"

type Item = "base" | "head" | "existing" | "diff"
type Summary =
  | { status: "idle"; note?: string }
  | { status: "loading" }
  | { status: "ready"; result: PullBranchComparison }
  | { status: "error"; message: string }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const owner = (repository: PullRepository) => repository.nameWithOwner.split("/")[0]!
const createChoices = [
  { label: "Create", hint: "create", draft: false },
  { label: "Create as draft", hint: "create draft", draft: true },
]

export type PullSides = { baseRepository: PullRepository; base: string; headRepository: PullRepository; head: string }

export const pullHeadRef = (base: PullRepository, head: PullRepository, branch: string) =>
  head.id === base.id ? branch : `${owner(head)}:${branch}`

export function defaultPullDraft(comparison: PullComparison, head: string, template = ""): ComposeDraft {
  const filled = template.replace(/\r\n?/g, "\n")
  if (comparison.message !== undefined) {
    const [subject = "", ...rest] = comparison.message.split(/\r?\n/)
    return { title: subject.trim(), body: [rest.join("\n").trim(), filled].filter(Boolean).join("\n\n") }
  }
  const title = head.replace(/[-_]+/g, " ").trim()
  return { title: title.charAt(0).toUpperCase() + title.slice(1), body: filled }
}

export function NewPullDialog(props: {
  repository: string
  repositoryId: number
  repositoryNodeId: string
  repositoryUrl: string
  defaultBranch: string
  localBranch?: string
  template?: string
  branches: ResourceState<Paginated<string>>
  drafts: ComposeDrafts
  showScrollbar: boolean
  showStatusBarHints?: boolean
  onCompare(repository: PullRepository, base: string, head: string): Promise<PullBranchComparison>
  onCreate?(repository: PullRepository, pull: NewPull): Promise<unknown>
  onLoadRepositories?(): Promise<PullRepositories>
  onLoadBranches?(repository: PullRepository, page: number): Promise<{ items: string[]; hasMore: boolean }>
  onCheckMerge?(base: string, head: string): Promise<MergeCheck>
  onOpenPull(number: number): void
  onViewDiff?(sides: PullSides, head: string): void
  initial?: PullSides
  onLoadMoreBranches(): Promise<void>
  onRetryBranches(): void
  onClose(): void
  onHintChange(hint: string | undefined): void
}) {
  const { colors } = useTheme()
  const browsed: PullRepository = {
    id: props.repositoryId,
    nodeId: props.repositoryNodeId,
    nameWithOwner: props.repository,
    defaultBranch: props.defaultBranch,
  }
  const local = !props.initial && props.localBranch && props.localBranch !== props.defaultBranch ? props.localBranch : undefined
  const [repositories, setRepositories] = createSignal<PullRepositories>({ bases: [browsed], heads: [browsed] })
  const [baseRepository, setBaseRepository] = createSignal(props.initial?.baseRepository ?? browsed)
  const [headRepository, setHeadRepository] = createSignal(props.initial?.headRepository ?? browsed)
  const [base, setBase] = createSignal(props.initial?.base ?? props.defaultBranch)
  const [head, setHead] = createSignal(props.initial?.head ?? local)
  const [selected, setSelected] = createSignal<Item>(props.initial ? "diff" : "head")
  const [picker, setPicker] = createSignal<{ side: "base" | "head"; repository?: PullRepository }>()
  const [otherBranches, setOtherBranches] = createSignal<Record<number, ResourceState<Paginated<string>>>>({})
  let baseChosen = !!props.initial
  const [summary, setSummary] = createSignal<Summary>({ status: "idle" })
  const [saved, setSaved] = createSignal<{ key: string; draft: ComposeDraft }>()
  const [merge, setMerge] = createSignal<MergeCheck | { status: "checking" }>()
  const [rowWidth, setRowWidth] = createSignal(0)
  let row: BoxRenderable | undefined
  let controls: ComposeControls | undefined
  let applied: ComposeDraft = { title: "", body: "" }
  let request = 0
  let mergeRequest = 0
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const existing = () => {
    const current = summary()
    return current.status === "ready" ? current.result.existing : undefined
  }
  const creatable = () => {
    const current = summary()
    return current.status === "ready" && !current.result.existing && current.result.comparison.aheadBy > 0
  }
  const diffable = () => {
    const current = summary()
    return !!props.onViewDiff && current.status === "ready" && current.result.comparison.aheadBy > 0
  }
  const items = (): Item[] => ["base", "head", ...(existing() ? ["existing" as const] : []), ...(diffable() ? ["diff" as const] : [])]
  const next = () => {
    const all = items()
    const index = all.indexOf(selected())
    if (index < 0 || index >= all.length - 1) return false
    setSelected(all[index + 1]!)
    return true
  }
  const label = (repository: PullRepository, branch: string) =>
    repository.id === browsed.id
      ? branch
      : owner(repository) !== owner(browsed)
        ? `${owner(repository)}:${branch}`
        : `${repository.nameWithOwner}:${branch}`
  const headRef = () => {
    const branch = head()
    return branch ? pullHeadRef(baseRepository(), headRepository(), branch) : undefined
  }
  const baseLabel = () => label(baseRepository(), base())
  const headLabel = () => {
    const branch = head()
    return branch ? label(headRepository(), branch) : "choose head"
  }
  const draftKey = () => {
    const ref = headRef()
    return ref ? { repositoryId: baseRepository().id, head: ref } : undefined
  }
  const viewDiff = () => {
    const branch = head()
    const ref = headRef()
    if (diffable() && branch && ref)
      props.onViewDiff?.({ baseRepository: baseRepository(), base: base(), headRepository: headRepository(), head: branch }, ref)
  }
  const loadBranches = async (repository: PullRepository, page = 1) => {
    if (!props.onLoadBranches) return
    const previous = otherBranches()[repository.id]?.value
    const phase = page > 1 ? ("pagination" as const) : ("load" as const)
    setOtherBranches((current) => ({ ...current, [repository.id]: { status: "loading", phase, value: previous } }))
    try {
      const result = await props.onLoadBranches(repository, page)
      if (disposed) return
      const items =
        page > 1 && previous ? [...previous.items, ...result.items.filter((item) => !previous.items.includes(item))] : result.items
      setOtherBranches((current) => ({ ...current, [repository.id]: { status: "ready", value: { items, page, hasMore: result.hasMore } } }))
    } catch (error) {
      if (disposed) return
      const message = error instanceof Error ? error.message : String(error)
      setOtherBranches((current) => ({ ...current, [repository.id]: { status: "error", phase, message, value: previous } }))
    }
  }
  const branchesFor = (repository: PullRepository): ResourceState<Paginated<string>> =>
    repository.id === browsed.id ? props.branches : (otherBranches()[repository.id] ?? { status: "loading", phase: "load" })
  const chooseBranches = (side: "base" | "head", repository: PullRepository) => {
    if (repository.id !== browsed.id && !otherBranches()[repository.id]) void loadBranches(repository)
    setPicker({ side, repository })
  }
  const openPicker = (side: "base" | "head") => {
    const choices = side === "base" ? repositories().bases : repositories().heads
    if (choices.length > 1) setPicker({ side })
    else chooseBranches(side, side === "base" ? baseRepository() : headRepository())
  }
  const move = (delta: number) => {
    const all = items()
    setSelected(all[Math.max(0, Math.min(all.length - 1, all.indexOf(selected()) + delta))]!)
  }
  const activate = (item = selected()) => {
    setSelected(item)
    if (item === "existing") {
      const pull = existing()
      if (pull) props.onOpenPull(pull.number)
    } else if (item === "diff") viewDiff()
    else openPicker(item)
  }
  const choose = (branch: string) => {
    const current = picker()
    setPicker()
    if (!current?.repository) return
    if (current.side === "base") {
      baseChosen = true
      setBaseRepository(current.repository)
      setBase(branch)
    } else {
      setHeadRepository(current.repository)
      setHead(branch)
    }
  }

  const untouched = () => {
    const current = controls?.draft()
    return !current || (current.title === applied.title && current.body === applied.body)
  }
  const apply = (draft: ComposeDraft) => {
    applied = draft
    controls?.replace(draft)
  }

  createEffect(
    on([baseRepository, base, headRef], ([repository, base, ref]) => {
      const id = ++request
      const head = ref
      if (!head) return setSummary((current) => (current.status === "idle" ? current : { status: "idle" }))
      setSummary({ status: "loading" })
      props.onCompare(repository, base, head).then(
        (result) => {
          if (!disposed && id === request) setSummary({ status: "ready", result })
        },
        (error) => {
          if (disposed || id !== request) return
          if (head === local && repository.id === browsed.id && error instanceof GitHubApiError && error.status === 404) {
            setSummary({ status: "idle", note: `${head} isn't on GitHub. Choose a head branch.` })
            setHead(undefined)
            setSelected("head")
            controls?.focus("top")
            setPicker({ side: "head", repository: headRepository() })
            return
          }
          setSummary({ status: "error", message: error instanceof Error ? error.message : String(error) })
        },
      )
    }),
  )
  const keyText = (key: { repositoryId: number; head: string }) => `${key.repositoryId}:${key.head}`
  createEffect(
    on(draftKey, (key) => {
      if (!key) return
      void props.drafts.load(key).then((draft) => {
        const latest = draftKey()
        if (disposed || !latest || keyText(latest) !== keyText(key)) return
        setSaved({ key: keyText(key), draft })
        if ((draft.title || draft.body) && untouched()) apply(draft)
      })
    }),
  )
  createEffect(() => {
    const current = summary()
    const draft = saved()
    const key = draftKey()
    const branch = head()
    if (
      current.status !== "ready" ||
      !key ||
      !branch ||
      draft?.key !== keyText(key) ||
      draft.draft.title ||
      draft.draft.body ||
      !untouched()
    )
      return
    apply(defaultPullDraft(current.result.comparison, branch, props.template))
  })
  createEffect(
    on(creatable, (ready) => {
      const id = ++mergeRequest
      const branch = head()
      if (!ready || !branch) return setMerge()
      if (baseRepository().id !== browsed.id || headRepository().id !== browsed.id)
        return setMerge({ status: "unavailable", reason: "not checked across repositories yet" })
      if (!props.onCheckMerge) return setMerge({ status: "unavailable", reason: "open opengh in a local checkout" })
      setMerge({ status: "checking" })
      props.onCheckMerge(base(), branch).then(
        (result) => {
          if (!disposed && id === mergeRequest) setMerge(result)
        },
        () => {
          if (!disposed && id === mergeRequest) setMerge({ status: "unavailable", reason: "git couldn't test the merge" })
        },
      )
    }),
  )
  createEffect(() => {
    const current = summary()
    if (!items().includes(selected()) && current.status !== "loading" && current.status !== "idle") setSelected("head")
  })
  onMount(() => {
    if (!head()) setPicker({ side: "head", repository: headRepository() })
    void props.onLoadRepositories?.().then(
      (result) => {
        if (disposed) return
        setRepositories(result)
        const original = result.bases[0]
        if (!baseChosen && original && original.id !== browsed.id) {
          setBaseRepository(original)
          setBase(original.defaultBranch)
        }
      },
      () => {},
    )
  })

  const itemColor = (item: Item, active: boolean) => (active && selected() === item ? colors.blue : colors.text)
  const itemAttributes = (item: Item, active: boolean) => (active && selected() === item ? TextAttributes.BOLD : TextAttributes.NONE)
  const summaryText = () => {
    const current = summary()
    if (current.status === "idle")
      return { text: current.note ?? "Choose a head branch", color: current.note ? colors.yellow : colors.muted }
    if (current.status === "error") return { text: current.message, color: colors.red }
    if (current.status !== "ready") return undefined
    const { comparison, existing } = current.result
    if (existing) return { text: `Pull request #${existing.number} already exists`, color: colors.yellow }
    if (comparison.aheadBy === 0)
      return { text: `Nothing to compare — ${headLabel()} has no commits ahead of ${baseLabel()}`, color: colors.yellow }
    const capped = comparison.files >= 300
    const files = capped ? "300+ files" : plural(comparison.files, "file")
    const total = (count: number) => `${count.toLocaleString("en-US")}${capped ? "+" : ""}`
    return {
      text: `${plural(comparison.commits, "commit")} · ${files} · `,
      color: colors.muted,
      additions: `+${total(comparison.additions)}`,
      deletions: `−${total(comparison.deletions)}`,
    }
  }

  const summaryWidth = () => {
    const line = summaryText()
    if (!line) return Bun.stringWidth("Comparing...")
    const totals = line.additions ? Bun.stringWidth(`${line.additions} ${line.deletions}`) : 0
    return Bun.stringWidth(line.text) + totals + (diffable() ? 2 : 0)
  }
  const mergeRoom = () => {
    const pull = existing()
    const used =
      Bun.stringWidth(`${baseLabel()} ← ${headLabel()}`) + (pull ? Bun.stringWidth(`  Open #${pull.number}`) : 0) + summaryWidth() + 4
    return Math.max(0, rowWidth() - used)
  }
  const mergeLine = (check: MergeCheck) => {
    const room = mergeRoom()
    const fit = (...forms: string[]) => {
      const form = forms.find((text) => Bun.stringWidth(text) <= room)
      return form === undefined ? undefined : form || undefined
    }
    if (check.status === "clean") return { text: fit("✓ Able to merge", "✓"), color: colors.green }
    if (check.status === "unavailable")
      return {
        text: fit(`Merge check unavailable — ${check.reason}`, "Merge check unavailable", "Can't check merge"),
        color: colors.muted,
      }
    const shown = check.files.slice(0, 3).join(", ")
    const more = check.files.length > 3 ? `, and ${check.files.length - 3} more` : ""
    const full = `✗ Can't merge automatically — conflicts in ${shown}${more}`
    const text =
      fit(full) ??
      (room >= Bun.stringWidth("✗ Can't merge automatically — conflicts in ...") ? fitText(full, room) : fit("✗ Conflicts", "✗"))
    return { text, color: colors.red }
  }

  return (
    <>
      <ComposeDialog
        idPrefix="new-pull"
        heading="New pull request"
        confirmation={`Create pull request in ${baseRepository().nameWithOwner}: ${base()} ← ${headRef() ?? ""}?`}
        choices={createChoices}
        repositoryUrl={props.repositoryUrl}
        defaultBranch={props.defaultBranch}
        showScrollbar={props.showScrollbar}
        showStatusBarHints={props.showStatusBarHints}
        draft={{ title: "", body: "" }}
        draftError={props.drafts.error()}
        initialField="top"
        blocked={!creatable()}
        suspended={!!picker()}
        onReady={(value) => {
          controls = value
        }}
        onDraftChange={(draft) => {
          const key = draftKey()
          if (key) props.drafts.set(key, draft)
        }}
        onSubmit={
          props.onCreate
            ? (title, body, choice) => {
                const ref = headRef()
                if (!ref || !props.onCreate) return Promise.reject(new Error("Choose a head branch."))
                return props.onCreate(baseRepository(), {
                  base: base(),
                  head: ref,
                  title,
                  body,
                  ...(createChoices[choice]?.draft ? { draft: true } : {}),
                })
              }
            : undefined
        }
        onClose={props.onClose}
        onHintChange={props.onHintChange}
        top={{
          label: "branches",
          keys: {
            "navigation.previousTab": () => move(-1),
            "navigation.nextTab": () => move(1),
            "navigation.activate": () => activate(),
            "item.diff": viewDiff,
          },
          next,
          hints: () => [
            [["navigation.previousTab", "navigation.nextTab"], "base/head"],
            [
              "navigation.activate",
              selected() === "existing" ? `open #${existing()?.number}` : selected() === "diff" ? "view diff" : `change ${selected()}`,
            ],
            ...(diffable() && selected() !== "diff" ? [["item.diff", "diff"] as const] : []),
            ...(items().indexOf(selected()) < items().length - 1 ? [["dialog.nextField", "next"] as const] : []),
          ],
          render: (active, focus) => (
            <box
              ref={(value) => {
                row = value
              }}
              onSizeChange={() => setRowWidth(row?.width ?? 0)}
              flexGrow={1}
              minWidth={0}
              height={1}
              flexDirection="row"
              overflow="hidden"
            >
              <text
                id="new-pull-base"
                flexShrink={0}
                selectable={false}
                fg={itemColor("base", active())}
                attributes={itemAttributes("base", active())}
                {...mouseClick(() => {
                  focus()
                  activate("base")
                })}
              >
                {baseLabel()}
              </text>
              <text flexShrink={0} fg={colors.muted}>
                {" ← "}
              </text>
              <text
                id="new-pull-head"
                flexShrink={0}
                selectable={false}
                fg={head() ? itemColor("head", active()) : colors.muted}
                attributes={itemAttributes("head", active())}
                {...mouseClick(() => {
                  focus()
                  activate("head")
                })}
              >
                {headLabel()}
              </text>
              <Show when={existing()}>
                {(pull) => (
                  <text
                    id="new-pull-existing"
                    flexShrink={0}
                    selectable={false}
                    fg={itemColor("existing", active())}
                    attributes={itemAttributes("existing", active())}
                    {...mouseClick(() => {
                      focus()
                      activate("existing")
                    })}
                  >
                    {`  Open #${pull().number}`}
                  </text>
                )}
              </Show>
              <Show when={merge()}>
                {(state) => (
                  <box flexShrink={0} marginLeft={2} height={1} flexDirection="row">
                    <Show when={state().status !== "checking"} fallback={<LoadingText text="Checking merge…" />}>
                      <Show when={mergeLine(state() as MergeCheck)}>
                        {(line) => (
                          <Show when={line().text}>
                            {(text) => (
                              <text id="new-pull-merge" wrapMode="none" fg={line().color}>
                                {text()}
                              </text>
                            )}
                          </Show>
                        )}
                      </Show>
                    </Show>
                  </box>
                )}
              </Show>
              <box flexGrow={1} minWidth={2} />
              <Show when={summaryText()} fallback={<LoadingText text="Comparing…" />}>
                {(line) => (
                  <text
                    id="new-pull-summary"
                    flexShrink={0}
                    minWidth={0}
                    wrapMode="none"
                    selectable={false}
                    fg={diffable() && active() && selected() === "diff" ? colors.blue : line().color}
                    attributes={itemAttributes("diff", active())}
                    {...mouseClick(() => {
                      focus()
                      activate("diff")
                    }, diffable)}
                  >
                    {line().text}
                    <Show when={line().additions}>
                      <span style={{ fg: colors.green }}>{line().additions}</span>{" "}
                      <span style={{ fg: colors.red }}>{line().deletions}</span>
                    </Show>
                    {diffable() ? " ›" : ""}
                  </text>
                )}
              </Show>
            </box>
          ),
        }}
      />
      <Show when={picker()}>
        {(current) => (
          <Show
            when={current().repository}
            fallback={
              <RepositoryPicker
                title={current().side === "base" ? "Choose base repository" : "Choose head repository"}
                repositories={current().side === "base" ? repositories().bases : repositories().heads}
                current={current().side === "base" ? baseRepository() : headRepository()}
                showScrollbar={props.showScrollbar}
                zIndex={300}
                onSelect={(repository) => chooseBranches(current().side, repository)}
                onClose={() => setPicker()}
              />
            }
          >
            {(repository) => {
              const side = current().side
              const several = () => (side === "base" ? repositories().bases : repositories().heads).length > 1
              const selectedBranch = () =>
                side === "base"
                  ? baseRepository().id === repository().id
                    ? base()
                    : undefined
                  : headRepository().id === repository().id
                    ? head()
                    : undefined
              return (
                <BranchPicker
                  title={`${side === "base" ? "Choose base branch" : "Choose head branch"}${several() ? ` · ${repository().nameWithOwner}` : ""}`}
                  currentLabel="✓ selected"
                  branches={branchesFor(repository())}
                  current={selectedBranch()}
                  showScrollbar={props.showScrollbar}
                  zIndex={300}
                  onLoadMore={
                    repository().id === browsed.id
                      ? props.onLoadMoreBranches
                      : () => loadBranches(repository(), (otherBranches()[repository().id]?.value?.page ?? 0) + 1)
                  }
                  onRetry={repository().id === browsed.id ? props.onRetryBranches : () => void loadBranches(repository())}
                  onClose={() => setPicker()}
                  onSelect={choose}
                />
              )
            }}
          </Show>
        )}
      </Show>
    </>
  )
}
