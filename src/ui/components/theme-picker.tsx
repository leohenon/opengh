import { TextAttributes, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { defaultTheme, themeNames, type ThemeName } from "../../theme"
import { useTheme } from "../theme"

function fuzzyScore(value: string, query: string) {
  const target = value.toLowerCase()
  const needle = query.trim().toLowerCase()
  if (!needle) return 0

  let cursor = 0
  let score = 0
  for (const character of needle) {
    const index = target.indexOf(character, cursor)
    if (index < 0) return undefined
    score += index - cursor
    cursor = index + 1
  }
  return score + (target.startsWith(needle) ? -100 : 0)
}

export function ThemePicker(props: {
  current: ThemeName
  saving?: boolean
  onPreview: (theme: ThemeName) => void
  onCancel: () => void
  onSelect: (theme: ThemeName) => Promise<void>
}) {
  const { colors } = useTheme()
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal<ThemeName>(props.current)
  const [saving, setSaving] = createSignal(false)
  const busy = () => saving() || props.saving === true
  const [error, setError] = createSignal("")
  let list: ScrollBoxRenderable | undefined

  const themes = createMemo(() => themeNames
    .map((theme, index) => ({ theme, index, score: fuzzyScore(theme, query()) }))
    .filter((entry): entry is { theme: ThemeName; index: number; score: number } => entry.score !== undefined)
    .sort((left, right) => left.score - right.score || left.theme.localeCompare(right.theme)))

  const move = (delta: number) => {
    const available = themes()
    if (!available.length) return
    const current = Math.max(0, available.findIndex((entry) => entry.theme === selected()))
    const next = available[Math.max(0, Math.min(available.length - 1, current + delta))]
    if (next) setSelected(next.theme)
  }

  createEffect(() => {
    const available = themes()
    const active = available.find((entry) => entry.theme === selected()) ?? available[0]
    if (!active) {
      props.onPreview(props.current)
      return
    }
    if (active.theme !== selected()) setSelected(active.theme)
    props.onPreview(active.theme)
    list?.scrollChildIntoView(`theme-${active.theme}`)
  })

  const choose = async () => {
    if (busy() || !themes().some((entry) => entry.theme === selected())) return
    setSaving(true)
    setError("")
    try {
      await props.onSelect(selected())
    } catch (error) {
      props.onPreview(props.current)
      setError(error instanceof Error ? error.message : "Theme save failed")
    } finally {
      setSaving(false)
    }
  }

  const handleKey = (event: KeyEvent) => {
    if (busy()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.name === "escape" || event.name === "esc" || event.raw === "\u001b" || event.sequence === "\u001b")
      return props.onCancel()
    if (event.name === "up") return move(-1)
    if (event.name === "down") return move(1)
    if (event.name === "return" || event.name === "enter") void choose()
  }

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={4} paddingRight={4} paddingBottom={1}>
      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>Themes</text>
        <Show when={busy()}><text fg={colors.muted}>Saving…</text></Show>
      </box>
      <box height={2} flexShrink={0} paddingTop={1}>
        <input
          width="100%"
          focused={!busy()}
          value={query()}
          placeholder="Search themes"
          placeholderColor={colors.muted}
          focusedBackgroundColor={colors.panel}
          textColor={colors.text}
          cursorColor={colors.blue}
          onInput={(value) => {
            setQuery(value)
            setError("")
          }}
          onKeyDown={handleKey}
        />
      </box>
      <box height={1} flexShrink={0} />
      <scrollbox
        ref={(value) => (list = value)}
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{ visible: false }}
        scrollY
      >
        <Show
          when={themes().length > 0}
          fallback={<box height={1} paddingLeft={1}><text fg={colors.muted}>No matching themes</text></box>}
        >
          <For each={themes()}>
            {(entry) => {
              const active = () => entry.theme === selected()
              return (
                <box
                  id={`theme-${entry.theme}`}
                  height={1}
                  flexShrink={0}
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active() ? colors.panelHover : colors.panel}
                >
                  <text width={2} fg={colors.blue}>{active() ? "›" : " "}</text>
                  <text
                    flexGrow={1}
                    minWidth={0}
                    fg={active() ? colors.blue : colors.text}
                    attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}
                  >
                    {entry.theme === defaultTheme ? `${entry.theme} (default)` : entry.theme}
                  </text>
                  <text width={10} flexShrink={0} fg={colors.green}>
                    {entry.theme === props.current ? "✓ current" : ""}
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
      <Show when={error()}>{(message) => <text fg={colors.red}>{message()}</text>}</Show>
    </box>
  )
}
