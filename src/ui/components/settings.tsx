import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import type { Config } from "../../config"
import { useTheme } from "../theme"
import { Popup } from "./popup"
import { ThemePicker } from "./theme-picker"

type Setting = "theme" | "scrollbars" | "about-sidebar" | "detail-layout" | "status-bar-hints" | "icon-style" | "compact-header" | "hide-documents-tab"

const settingOrder: Setting[] = ["theme", "scrollbars", "about-sidebar", "detail-layout", "status-bar-hints", "icon-style", "compact-header", "hide-documents-tab"]
const sidebarValues = ["auto", "show", "hide"] as const

export function Settings(props: {
  config: Config
  saving?: boolean
  loadError?: string
  onChange: (config: Config) => Promise<void>
  onHintChange?: (hint: string | undefined) => void
  onClose: () => void
}) {
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const { colors } = theme
  const [screen, setScreen] = createSignal<"settings" | "themes">("settings")
  const [selected, setSelected] = createSignal<Setting>("theme")
  const [saving, setSaving] = createSignal(false)
  const busy = () => saving() || props.saving === true
  const [error, setError] = createSignal("")
  const rowHeight = () => dimensions().height < 29 ? 2 : 3
  const popupHeight = () => settingOrder.length * rowHeight() + 11
  const split = () => dimensions().width >= 110
  createEffect(() => props.onHintChange?.(screen() === "themes"
    ? "↑/↓ select · enter confirm · esc back"
    : "↑/↓ select · ←/→ change · enter " + (selected() === "theme" ? "open" : "change") + " · esc close"))
  onCleanup(() => props.onHintChange?.(undefined))
  const scrollbarValue = () => props.config.showScrollbars ? "on" : "off"

  const moveSetting = (delta: number) => {
    const current = settingOrder.indexOf(selected())
    setSelected(settingOrder[Math.max(0, Math.min(settingOrder.length - 1, current + delta))]!)
  }

  const toggleBoolean = async (key: "showScrollbars" | "showStatusBarHints" | "compactHeader" | "hideDocumentsTab") => {
    if (busy()) return
    setSaving(true)
    setError("")
    try {
      await props.onChange({ ...props.config, [key]: !props.config[key] })
    } catch (error) {
      setError(error instanceof Error ? error.message : "Settings save failed")
    } finally {
      setSaving(false)
    }
  }

  const changeSidebar = async (direction: number) => {
    if (busy()) return
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

  const changeDetailLayout = async () => {
    if (busy()) return
    setSaving(true)
    setError("")
    try {
      await props.onChange({ ...props.config, detailLayout: props.config.detailLayout === "centered" ? "wide" : "centered" })
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save settings")
    } finally {
      setSaving(false)
    }
  }

  const changeIconStyle = async () => {
    if (busy()) return
    setSaving(true)
    setError("")
    try {
      await props.onChange({ ...props.config, iconStyle: props.config.iconStyle === "nerd" ? "unicode" : "nerd" })
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
    if (busy()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
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
      return void toggleBoolean("showScrollbars")
    if (selected() === "hide-documents-tab" && (event.name === "left" || event.name === "right" || enter))
      return void toggleBoolean("hideDocumentsTab")
    if (selected() === "compact-header" && (event.name === "left" || event.name === "right" || enter))
      return void toggleBoolean("compactHeader")
    if (selected() === "status-bar-hints" && (event.name === "left" || event.name === "right" || enter))
      return void toggleBoolean("showStatusBarHints")
    if (selected() === "about-sidebar" && (event.name === "left" || event.name === "right" || enter))
      return void changeSidebar(event.name === "left" ? -1 : 1)
    if (selected() === "detail-layout" && (event.name === "left" || event.name === "right" || enter))
      return void changeDetailLayout()
    if (selected() === "icon-style" && (event.name === "left" || event.name === "right" || enter))
      void changeIconStyle()
  })

  const settingRow = (setting: Setting, title: string, description: string, value: string) => {
    const active = () => selected() === setting
    return (
      <box
        height={rowHeight()}
        flexShrink={0}
        flexDirection="row"
        alignItems="flex-start"
        backgroundColor={active() ? colors.panelHover : colors.panel}
        paddingLeft={1}
        paddingRight={1}
      >
        <text width={2} fg={colors.blue}>{active() ? "›" : " "}</text>
        <box flexGrow={1} minWidth={0} flexDirection="column">
          <text width="100%" height={1} wrapMode="none" fg={colors.text} attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}>{title}</text>
          <text width="100%" height={1} wrapMode="none" fg={colors.muted}>{description}</text>
        </box>
        <text width={split() ? 24 : Math.min(24, Math.max(12, Math.floor((dimensions().width - 10) * 0.35)))} flexShrink={0} fg={active() ? colors.blue : colors.muted}>‹ {value} ›</text>
      </box>
    )
  }

  const detail = () => {
    if (selected() === "theme") return {
      title: "Theme",
      description: "Choose the color theme used throughout opengh. Moving through the theme list previews each theme.",
    }
    if (selected() === "hide-documents-tab") return {
      title: "Hide documents tab",
      description: "Hide the document tab strip on Overview. Documents remain visible, and Tab still cycles between them.",
    }
    if (selected() === "compact-header") return {
      title: "Compact header",
      description: "Use one header row instead of five, with tabs on the left and the repository name on the right.",
    }
    if (selected() === "scrollbars") return {
      title: "Scrollbars",
      description: "Show vertical scrollbars only when content exceeds the viewport.",
    }
    if (selected() === "icon-style") return {
      title: "Icon style",
      description: "Standard Unicode works with ordinary terminal fonts. Nerd Font uses GitHub-style glyphs and requires a Nerd Font selected in your terminal. This setting cannot change or detect the terminal font.",
    }
    if (selected() === "detail-layout") return {
      title: "Detail layout",
      description: "Centered keeps a bounded reading column. Wide uses the available terminal width. Applies to issue and commit details.",
    }
    if (selected() === "status-bar-hints") return {
      title: "Status bar hints",
      description: "Show keyboard shortcuts in the status bar on every page. Loading messages stay visible when hints are off.",
    }
    return {
      title: "About sidebar",
      description: "Control repository metadata visibility. Auto hides the sidebar when the terminal is narrower than 100 columns.",
    }
  }

  return (
    <Popup width={100} height={popupHeight()} zIndex={200} placement="center">
      <Show
        when={screen() === "settings"}
        fallback={(
          <ThemePicker
            current={props.config.theme}
            saving={busy()}
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
              <Show when={busy()}><text fg={colors.muted}>Saving…</text></Show>
            </box>
            <box height={1} flexShrink={0} />
            <text fg={colors.muted}>Appearance</text>
            <box height={1} flexShrink={0} />
            {settingRow("theme", "Theme", "Interface color theme", props.config.theme)}
            {settingRow("scrollbars", "Scrollbars", "Lists and documents", scrollbarValue())}
            {settingRow("about-sidebar", "About sidebar", "Repository metadata", props.config.aboutSidebar)}
            {settingRow("detail-layout", "Detail layout", "Detail page width", props.config.detailLayout)}
            {settingRow("status-bar-hints", "Status bar hints", "Keyboard shortcuts", props.config.showStatusBarHints ? "on" : "off")}
            {settingRow("icon-style", "Icon style", "Terminal symbols", props.config.iconStyle === "nerd" ? "Nerd Font" : "Unicode")}
            {settingRow("compact-header", "Compact header", "More room for content", props.config.compactHeader ? "on" : "off")}
            {settingRow("hide-documents-tab", "Hide documents tab", "Overview document tabs", props.config.hideDocumentsTab ? "on" : "off")}
            <box flexGrow={1} minHeight={0} />
            <Show when={props.loadError || error()}>
              {(message) => <text fg={colors.red} wrapMode="word">{message()}</text>}
            </Show>
          </box>
          <Show when={split()}>
            <box
              position="relative"
              top={-1}
              width="42%"
              height={popupHeight()}
              minWidth={0}
              flexDirection="column"
              paddingTop={1}
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={colors.panelHover}
            >
              <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
                <text fg={colors.blue} attributes={TextAttributes.BOLD}>{detail().title}</text>
                <Show when={busy()}><text fg={colors.muted}>Saving…</text></Show>
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
