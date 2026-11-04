import { createMemo, For, Show } from "solid-js"
import { referenceLinkChunks } from "../reference-links"
import { useTheme } from "../theme"

/** Inline content only: mount inside <text> (or another inline text element). */
export function LinkedText(props: { text: string; repositoryUrl?: string; fallbackHref?: string }) {
  const { theme } = useTheme()
  const chunks = createMemo(() => referenceLinkChunks(props.text, props.repositoryUrl))
  return (
    <For each={chunks()}>
      {(chunk) => <Show when={chunk.href ?? props.fallbackHref} fallback={chunk.text}>{(href) => <span style={{ fg: theme.markdownLink }}><a href={href()}>{chunk.text}</a></span>}</Show>}
    </For>
  )
}
