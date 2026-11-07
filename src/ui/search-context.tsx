import { createContext, createEffect, createMemo, createSignal, onCleanup, Show, untrack, useContext, type JSX } from "solid-js"
import { useKeyActions } from "./keybindings"
import { SearchBar } from "./components/search-bar"
import { wrapSearchIndex } from "./search"

export type SearchResult = { id: string; reveal(): void; position?: number }
export type SearchTarget = {
  // Overlay targets must not compete with the retained page underneath them.
  scope?: string
  id(): string
  active(): boolean
  // A visible diff pane may keep its accepted scope after keyboard focus moves.
  retain?(): boolean
  search(query: string): SearchResult[]
  highlight(activeId?: string): void
  clear(): void
  snapshot(): () => void
  position?(): number
  // Lists have an explicit cursor; document viewports are not occurrence cursors.
  selection?(): string | undefined
}
type Session = { query: string; current?: string }
type Draft = { query: string; restore(): void; anchor: number; previous?: string }
const SearchContext = createContext<{ register(target: SearchTarget): () => void }>()

export function useSearchTarget(target: SearchTarget) {
  const context = useContext(SearchContext)
  if (context) onCleanup(context.register(target))
}

export function SearchProvider(props: { identity: string; enabled: boolean; scope?: string; footer?: JSX.Element; children: JSX.Element }) {
  const [targets, setTargets] = createSignal<SearchTarget[]>([])
  const [ownerVersion, setOwnerVersion] = createSignal(0)
  const [draft, setDraft] = createSignal<Draft>()
  const [session, setSession] = createSignal<Session>({ query: "" })
  const [results, setResults] = createSignal<SearchResult[]>([])
  const sessions = new Map<string, Session>()
  let owner: SearchTarget | undefined
  let identity = ""
  let viewIdentity = ""
  const query = () => draft()?.query ?? session().query
  const retaining = createMemo(() => !!query())
  const currentIndex = () => results().findIndex((result) => result.id === session().current)
  const active = () => targets().findLast((target) => target.scope === props.scope && target.active())
  const targetIdentity = (target?: SearchTarget) => JSON.stringify([props.identity, props.scope, target?.id() ?? "empty"])
  const cancel = () => {
    const value = draft()
    if (!value) return
    setDraft(undefined)
    setSession((session) => ({ ...session, current: value.previous }))
    refresh(false)
    value.restore()
  }
  const refresh = (reveal: boolean) => {
    if (!owner) return
    const found = owner.search(query())
    setResults(found)
    const previous = session().current
    let selected = found.find((result) => result.id === previous)
    if (draft() && (reveal || !selected)) selected = found.find((result) => (result.position ?? 0) >= draft()!.anchor) ?? found[0]
    else selected ??= found[0]
    setSession((session) => ({ ...session, current: selected?.id }))
    owner.highlight(selected?.id)
    if (reveal || draft() && selected?.id !== previous) selected?.reveal()
  }
  const switchTarget = (target: SearchTarget | undefined, key: string) => {
    if (key === identity && target === owner) return
    // Restore a cancelled draft before handing ownership to another retained view.
    cancel()
    if (identity) sessions.set(identity, session())
    owner?.clear()
    owner = target
    identity = key
    viewIdentity = props.identity
    setSession(sessions.get(key) ?? { query: "" })
    setResults([])
    refresh(false)
    setOwnerVersion((version) => version + 1)
  }
  createEffect(() => {
    ownerVersion()
    if (!props.enabled) { untrack(cancel); return }
    const focused = active()
    const target = retaining() && viewIdentity === props.identity && owner?.scope === props.scope && owner?.retain?.() && targets().includes(owner) ? owner : focused
    const key = targetIdentity(target)
    untrack(() => switchTarget(target, key))
  })
  // Native Markdown and Hunk finish asynchronously and do not publish Solid
  // dependencies. Reconcile loaded content and geometry only while searching.
  const timer = setInterval(() => { if (query() && props.enabled) refresh(false) }, 150)
  onCleanup(() => { clearInterval(timer); owner?.clear() })

  const start = () => {
    const target = active()
    switchTarget(target, targetIdentity(target))
    if (!owner) return false
    setDraft({ query: session().query, previous: session().current, restore: owner.snapshot(), anchor: owner.position?.() ?? 0 })
    refresh(false)
  }
  const move = (delta: number) => {
    if (!session().query) return false
    refresh(false)
    const matches = results()
    const selection = owner?.selection?.()
    const index = selection === undefined ? currentIndex() : matches.findIndex((result) => result.id === selection)
    let result = matches[wrapSearchIndex(index, delta, matches.length)]
    if (selection !== undefined && index < 0) {
      const cursor = owner?.position?.() ?? 0
      result = delta > 0
        ? matches.find((result) => (result.position ?? 0) > cursor) ?? matches[0]
        : matches.findLast((result) => (result.position ?? 0) < cursor) ?? matches.at(-1)
    }
    setSession((session) => ({ ...session, current: result?.id }))
    owner?.highlight(result?.id)
    result?.reveal()
  }
  const clear = () => {
    if (!session().query) return false
    setSession({ query: "" })
    owner?.clear()
    setResults([])
  }
  useKeyActions({
    "search.start": start,
    "search.next": () => move(1),
    "search.previous": () => move(-1),
    "navigation.back": () => props.scope === undefined ? clear() : false,
    "dialog.close": () => props.scope !== undefined ? clear() : false,
  }, { when: () => props.enabled && !draft(), get priority() { return props.scope === undefined ? 20 : 150 } })
  useKeyActions({
    "dialog.close": cancel,
    "input.submit": () => {
      setSession((session) => ({ ...session, query: draft()!.query }))
      setDraft(undefined)
    },
  }, { when: () => props.enabled && !!draft(), priority: 200, modal: true })

  return <SearchContext.Provider value={{ register(target) {
    setTargets((targets) => [...targets, target])
    return () => { target.clear(); setTargets((targets) => targets.filter((entry) => entry !== target)) }
  } }}>
    {props.children}
    <Show when={props.enabled && (!!draft() || !!session().query)} fallback={props.footer}>
      <SearchBar query={query()} editing={!!draft()} current={currentIndex() + 1} total={results().length}
        zIndex={props.scope === undefined ? 0 : 350}
        onInput={(query) => { setDraft((draft) => draft && { ...draft, query }); refresh(true) }} />
    </Show>
  </SearchContext.Provider>
}
