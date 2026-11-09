import { RGBA, type BoxRenderable } from "@opentui/core"
import { onCleanup, type JSX } from "solid-js"
import { createRenderedSearch } from "../rendered-search"
import { useSearchTarget } from "../search-context"
import { useTheme } from "../theme"

// The page subtree is the source of truth: collapsed content, hidden retained
// views and concealed link destinations must never enter the index.
export function SearchSurface(props: { active: boolean; children: JSX.Element }) {
  const { colors } = useTheme()
  let adapter: ReturnType<typeof createRenderedSearch> | undefined
  useSearchTarget({
    fallback: true,
    id: () => "page",
    active: () => props.active,
    search: (query) => adapter?.search(query) ?? [],
    highlight: (id) => adapter?.highlight(id),
    clear: () => adapter?.clear(),
    snapshot: () => adapter?.snapshot() ?? (() => {}),
    position: () => adapter?.position() ?? 0,
  })
  onCleanup(() => adapter?.dispose())
  return <box ref={(root: BoxRenderable) => { adapter = createRenderedSearch(root, {
      get matchBackground() { return RGBA.fromHex(colors.searchMatchBg) },
      get matchForeground() { return RGBA.fromHex(colors.searchMatchFg) },
      get activeBackground() { return RGBA.fromHex(colors.searchCurrentMatchBg) },
      get activeForeground() { return RGBA.fromHex(colors.searchCurrentMatchFg) },
    }) }} visible={props.active}
    flexGrow={1} minHeight={0} flexDirection="column">{props.children}</box>
}
