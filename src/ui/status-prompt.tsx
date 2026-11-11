import { createContext, createSignal, Show, useContext, type JSX } from "solid-js"
import { KeyInput } from "./keybindings"
import { useTheme } from "./theme"

// A one-line text prompt that takes over the status bar row while open, like `/` search.
export type StatusPrompt = {
  id?: string
  prefix: string
  placeholder?: string
  value(): string
  onInput(value: string): void
  detail?(): string
}

const StatusPromptContext = createContext<{ prompt(): StatusPrompt | undefined; open(prompt: StatusPrompt): () => void }>()

export function StatusPromptProvider(props: { children: JSX.Element }) {
  const [prompt, setPrompt] = createSignal<StatusPrompt>()
  return <StatusPromptContext.Provider value={{
    prompt,
    open(next) {
      setPrompt(next)
      return () => setPrompt((current) => current === next ? undefined : current)
    },
  }}>{props.children}</StatusPromptContext.Provider>
}

export function useStatusPrompt() {
  return useContext(StatusPromptContext)
}

export function StatusPromptBar(props: { fallback: JSX.Element; zIndex?: number }) {
  const context = useStatusPrompt()
  const { colors } = useTheme()
  return <Show when={context?.prompt()} fallback={props.fallback} keyed>
    {(prompt) => <box height={1} minWidth={0} flexShrink={0} flexDirection="row" overflow="hidden" backgroundColor={colors.canvas} zIndex={props.zIndex ?? 0}>
      <text height={1} flexShrink={0} wrapMode="none" fg={colors.blue}> {prompt.prefix} </text>
      <box height={1} flexGrow={1} flexBasis={0} minWidth={0} overflow="hidden">
        <KeyInput id={prompt.id} width="100%" focused value={prompt.value()} onInput={prompt.onInput}
          placeholder={prompt.placeholder} placeholderColor={colors.muted} textColor={colors.text} backgroundColor={colors.canvas} />
      </box>
      <Show when={prompt.detail?.()}>
        {(detail) => <text height={1} flexShrink={0} wrapMode="none" fg={colors.muted}>{detail()} </text>}
      </Show>
    </box>}
  </Show>
}
