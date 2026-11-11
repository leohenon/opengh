import { createContext, useContext, type Accessor, type JSX } from "solid-js"

export type MentionSearch = (query: string, signal: AbortSignal) => Promise<readonly string[]>
type MentionSource = {
  identity: Accessor<string>
  users: Accessor<readonly string[]>
  search: Accessor<MentionSearch | undefined>
}
const MentionContext = createContext<MentionSource>()

export function MentionProvider(props: { identity: string; users: readonly string[]; search?: MentionSearch; children: JSX.Element }) {
  const source: MentionSource = { identity: () => props.identity, users: () => props.users, search: () => props.search }
  return <MentionContext.Provider value={source}>{props.children}</MentionContext.Provider>
}

export const useMentions = () => useContext(MentionContext)
