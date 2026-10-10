import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import type { Config } from "../../config"
import { useTheme } from "../theme"
import { Popup } from "./popup"
import { ThemePicker } from "./theme-picker"

type Setting = "theme" | "scrollbars" | "about-sidebar"

const settingOrder: Setting[] = ["theme", "scrollbars", "about-sidebar"]
const sidebarValues = ["auto", "show", "hide"] as const

export function Settings(props: {
  config: Config
  onChange: (config: Config) => Promise<void>
  onClose: () => void
}) {
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const { colors } = theme
  const [screen, setScreen] = createSignal<"settings" | "themes">("settings")
  const [selected, setSelected] = createSignal<Setting>("theme")
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")
  const popupHeight = 20
  const split = () => dimensions().width >= 110
  const scrollbarValue = () => props.config.showScrollbars ? "on" : "off"

  const moveSetting = (delta: number) => {
    const current = settingOrder.indexOf(selected())
    setSelected(settingOrder[Math.max(0, Math.min(settingOrder.length - 1, current + delta))]!)
  }

  const toggleScrollbars = async () => {
    if (saving()) return
    setSaving(true)
    setError("")
    try {
      await props.onChange({ ...props.config, showScrollbars: !props.config.showScrollbars })
    } catch (error) {
      setError(error instanceof Error ? error.message : "Settings save failed")
    } finally {
      setSaving(false)
    }
  }

  const changeSidebar = async (direction: number) => {
    if (saving()) return
    const current = sidebarValues.indexOf(props.config.aboutSidebar)
    const next = sidebarValues[(current + direction + sidebarValues.length) % sidebarValues.length]!
    setSaving(true)
    setError("")
    try {
      await props.onChange({ ...props.config, aboutSidebar: next })
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save settings")
    } finally {
      setSaving(false)
    }
  }

  const openThemes = () => {
    setError("")
    setScreen("themes")
  }

  useKeyboard((event) => {
    if (screen() === "themes") return
    const enter = event.name === "return" || event.name === "enter"
      || event.raw === "\r" || event.raw === "\n" || event.sequence === "\r" || event.sequence === "\n"
    if (event.name === "escape" || event.name === "esc" || event.raw === "\u001b" || event.sequence === "\u001b")
      return props.onClose()
    if (event.name === "up" || event.name === "k") return moveSetting(-1)
    if (event.name === "down" || event.name === "j") return moveSetting(1)
    if (selected() === "theme" && (event.name === "left" || event.name === "right" || enter)) {
      event.preventDefault()
      event.stopPropagation()
      return openThemes()
    }
    if (selected() === "scrollbars" && (event.name === "left" || event.name === "right" || enter))
      return void toggleScrollbars()
    if (selected() === "about-sidebar" && (event.name === "left" || event.name === "right" || enter))
      void changeSidebar(event.name === "left" ? -1 : 1)
  })

  const settingRow = (setting: Setting, title: string, description: string, value: string) => {
    const active = () => selected() === setting
    return (
      <box
        height={3}
        flexShrink={0}
        flexDirection="row"
        alignItems="flex-start"
        backgroundColor={active() ? colors.panelHover : colors.panel}
        paddingLeft={1}
        paddingRight={1}
      >
        <text width={2} fg={colors.blue}>{active() ? "›" : " "}</text>
        <box flexGrow={1} minWidth={0} flexDirection="column">
          <text fg={colors.text} attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}>{title}</text>
          <text fg={colors.muted}>{description}</text>
        </box>
        <text width={24} flexShrink={0} fg={active() ? colors.blue : colors.muted}>‹ {value} ›</text>
      </box>
    )
  }

  const detail = () => {
    if (selected() === "theme") return {
      title: "Theme",
      description: "Choose the color theme used throughout openGH. Moving through the theme list previews each theme.",
    }
    if (selected() === "scrollbars") return {
      title: "Scrollbars",
      description: "Show vertical scrollbars beside repository documents and lists.",
    }
    return {
      title: "About sidebar",
      description: "Control repository metadata visibility. Auto hides the sidebar when the terminal is narrower than 100 columns.",
    }
  }

  return (
    <Popup width={100} height={popupHeight} zIndex={200} placement="center">
      <Show
        when={screen() === "settings"}
        fallback={(
          <ThemePicker
            current={props.config.theme}
            onPreview={theme.preview}
            onCancel={() => {
              theme.preview()
              setScreen("settings")
            }}
            onSelect={async (name) => {
              await props.onChange({ ...props.config, theme: name })
              theme.preview()
              setScreen("settings")
            }}
          />
        )}
      >
        <box flexGrow={1} minHeight={0} flexDirection="row">
          <box
            width={split() ? "58%" : "100%"}
            minWidth={0}
            flexDirection="column"
            paddingLeft={4}
            paddingRight={4}
            paddingBottom={1}
          >
            <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
              <text fg={colors.text} attributes={TextAttributes.BOLD}>Settings</text>
              <Show when={!split()}><text fg={colors.muted}>esc</text></Show>
            </box>
            <box height={1} flexShrink={0} />
            <text fg={colors.muted}>Appearance</text>
            <box height={1} flexShrink={0} />
            {settingRow("theme", "Theme", "Interface color theme", props.config.theme)}
            {settingRow("scrollbars", "Scrollbars", "Lists and documents", scrollbarValue())}
            {settingRow("about-sidebar", "About sidebar", "Repository metadata", props.config.aboutSidebar)}
            <box flexGrow={1} minHeight={0} />
            <Show when={error()}>
              {(message) => <text fg={colors.red} wrapMode="word">{message()}</text>}
            </Show>
          </box>
          <Show when={split()}>
            <box
              position="relative"
              top={-1}
              width="42%"
              height={popupHeight}
              minWidth={0}
              flexDirection="column"
              paddingTop={1}
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={colors.panelHover}
            >
              <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
                <text fg={colors.blue} attributes={TextAttributes.BOLD}>{detail().title}</text>
                <text fg={colors.muted}>esc</text>
              </box>
              <box height={1} flexShrink={0} />
              <text fg={colors.text} wrapMode="word">{detail().description}</text>
            </box>
          </Show>
        </box>
      </Show>
    </Popup>
  )
}
