import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"
import { defaultConfig, type MarkdownStyle } from "../config"

const MarkdownContext = createContext<Accessor<MarkdownStyle>>(() => defaultConfig.markdownStyle)

export function MarkdownProvider(props: ParentProps<{ style: MarkdownStyle }>) {
  return <MarkdownContext.Provider value={() => props.style}>{props.children}</MarkdownContext.Provider>
}

export function useMarkdownPreference() {
  return useContext(MarkdownContext)
}
