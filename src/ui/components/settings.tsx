import { CliRenderEvents, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { Config } from "../../config"
import { useTheme } from "../theme"
import { Popup } from "./popup"
import { ThemePicker } from "./theme-picker"

type Setting = "theme" | "color-mode" | "reduced-motion" | "markdown-style" | "scrollbars" | "about-sidebar" | "detail-layout" | "status-bar-hints" | "icon-style" | "compact-header" | "hide-documents-tab" | "tab-counts"

const sectionOrder = ["Appearance", "Layout", "Usability"] as const
type Section = typeof sectionOrder[number]
const sectionSettings: Record<Section, readonly Setting[]> = {
  Appearance: ["theme", "color-mode", "markdown-style"],
  Layout: ["compact-header", "tab-counts", "hide-documents-tab", "about-sidebar", "detail-layout"],
  Usability: ["icon-style", "status-bar-hints", "scrollbars", "reduced-motion"],
}
const settingOrder = sectionOrder.flatMap((section) => sectionSettings[section])
const settingDefinitions: Record<Setting, { title: string; description: string; value: (config: Config) => string }> = {
  theme: { title: "Theme", description: "Interface color theme", value: (config) => config.theme },
  "color-mode": { title: "Color mode", description: "System, dark, or light", value: (config) => config.colorMode },
  "markdown-style": { title: "Markdown style", description: "Rich or minimal formatting", value: (config) => config.markdownStyle },
  "compact-header": { title: "Compact header", description: "More room for content", value: (config) => config.compactHeader ? "on" : "off" },
  "tab-counts": { title: "Tab counts", description: "Issue and PR totals", value: (config) => config.showTabCounts ? "on" : "off" },
  "hide-documents-tab": { title: "Document tabs", description: "Overview document navigation", value: (config) => config.hideDocumentsTab ? "off" : "on" },
  "about-sidebar": { title: "About sidebar", description: "Repository metadata", value: (config) => config.aboutSidebar },
  "detail-layout": { title: "Detail width", description: "Detail page width", value: (config) => config.detailLayout },
  "icon-style": { title: "Icon style", description: "Terminal symbols", value: (config) => config.iconStyle === "nerd" ? "Nerd Font" : "Unicode" },
  "status-bar-hints": { title: "Status bar hints", description: "Keyboard shortcuts", value: (config) => config.showStatusBarHints ? "on" : "off" },
  scrollbars: { title: "Scrollbars", description: "Lists and documents", value: (config) => config.showScrollbars ? "on" : "off" },
  "reduced-motion": { title: "Reduced motion", description: "Static loading indicators", value: (config) => config.reducedMotion ? "on" : "off" },
}
const colorModeValues = ["system", "dark", "light"] as const
const sidebarValues = ["auto", "show", "hide"] as const

export function Settings(props: {
  config: Config
  saving?: boolean
  loadError?: string
  onChange: (config: Config) => Promise<void>
  onHintChange?: (hint: string | undefined) => void
  onClose: () => void
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const { colors } = theme
  let settingsScroll: ScrollBoxRenderable | undefined
  const [screen, setScreen] = createSignal<"settings" | "themes">("settings")
  const [selected, setSelected] = createSignal<Setting>("theme")
  const [saving, setSaving] = createSignal(false)
  const busy = () => saving() || props.saving === true
  const [error, setError] = createSignal("")
  const rowHeight = () => dimensions().height < 29 ? 2 : 3
  const popupHeight = () => settingOrder.length * rowHeight() + 11 + (sectionOrder.length - 1) * 3
  const split = () => dimensions().width >= 110
  createEffect(() => props.onHintChange?.(screen() === "themes"
    ? "↑/↓ select · enter confirm · esc back"
    : "↑/↓ select · ←/→ change · enter " + (selected() === "theme" ? "open" : "change") + " · esc close"))
  onCleanup(() => props.onHintChange?.(undefined))
  const revealSetting = () => {
    if (selected() === settingOrder[0]) settingsScroll?.scrollTo(0)
    else settingsScroll?.scrollChildIntoView(`setting-${selected()}`)
  }
  createEffect(on(() => [rowHeight(), dimensions().height], () => {
    renderer.once(CliRenderEvents.FRAME, revealSetting)
    renderer.requestRender()
    onCleanup(() => renderer.off(CliRenderEvents.FRAME, revealSetting))
  }))
  const moveSetting = (delta: number) => {
    const current = settingOrder.indexOf(selected())
    setSelected(settingOrder[Math.max(0, Math.min(settingOrder.length - 1, current + delta))]!)
    revealSetting()
  }

  const toggleBoolean = async (key: "reducedMotion" | "showScrollbars" | "showStatusBarHints" | "compactHeader" | "hideDocumentsTab" | "showTabCounts") => {
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

  const changeColorMode = async (direction: number) => {
    if (busy()) return
    const current = colorModeValues.indexOf(props.config.colorMode)
    const next = colorModeValues[(current + direction + colorModeValues.length) % colorModeValues.length]!
    setSaving(true)
    setError("")
    try {
      await props.onChange({ ...props.config, colorMode: next })
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save settings")
    } finally {
      setSaving(false)
    }
  }

  const changeMarkdownStyle = async () => {
    if (busy()) return
    setSaving(true)
    setError("")
    try {
      await props.onChange({ ...props.config, markdownStyle: props.config.markdownStyle === "rich" ? "minimal" : "rich" })
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save settings")
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
    if (selected() === "color-mode" && (event.name === "left" || event.name === "right" || enter))
      return void changeColorMode(event.name === "left" ? -1 : 1)
    if (selected() === "reduced-motion" && (event.name === "left" || event.name === "right" || enter))
      return void toggleBoolean("reducedMotion")
    if (selected() === "markdown-style" && (event.name === "left" || event.name === "right" || enter))
      return void changeMarkdownStyle()
    if (selected() === "scrollbars" && (event.name === "left" || event.name === "right" || enter))
      return void toggleBoolean("showScrollbars")
    if (selected() === "tab-counts" && (event.name === "left" || event.name === "right" || enter))
      return void toggleBoolean("showTabCounts")
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

  const settingRow = (setting: Setting) => {
    const definition = settingDefinitions[setting]
    const active = () => selected() === setting
    return (
      <box
        id={`setting-${setting}`}
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
          <text width="100%" height={1} wrapMode="none" fg={colors.text} attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}>{definition.title}</text>
          <text width="100%" height={1} wrapMode="none" fg={colors.muted}>{definition.description}</text>
        </box>
        <text width={split() ? 24 : Math.min(24, Math.max(12, Math.floor((dimensions().width - 10) * 0.35)))} flexShrink={0} fg={active() ? colors.blue : colors.muted}>‹ {definition.value(props.config)} ›</text>
      </box>
    )
  }

  const detail = () => {
    if (selected() === "theme") return {
      title: "Theme",
      description: "Choose the color theme used throughout opengh. Moving through the theme list previews each theme.",
    }
    if (selected() === "color-mode") return {
      title: "Color mode",
      description: "System follows your terminal's light or dark appearance, falling back to dark if detection is unavailable. Dark and Light override terminal detection for every theme.",
    }
    if (selected() === "reduced-motion") return {
      title: "Reduced motion",
      description: "Replace animated loading glyphs with a static indicator, including running workflows. Loading messages and live data updates remain enabled.",
    }
    if (selected() === "markdown-style") return {
      title: "Markdown style",
      description: "Rich keeps syntax colors, labels on multiline code, and decorative borders. Minimal uses neutral syntax colors, simpler code blocks, and borderless headings, quotes, and tables. Links and diff colors stay distinct.",
    }
    if (selected() === "tab-counts") return {
      title: "Tab counts",
      description: "Show open issue and pull request totals in tabs.",
    }
    if (selected() === "hide-documents-tab") return {
      title: "Document tabs",
      description: "Show the document tab strip on Overview. When off, documents remain visible, and Tab still cycles between them.",
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
      title: "Detail width",
      description: "Centered keeps a bounded reading column. Wide uses the available terminal width. Applies to repository documents and detail pages.",
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
            </box>
            <box height={1} flexShrink={0} />
            <scrollbox ref={(value) => { settingsScroll = value }} flexGrow={1} minHeight={0} scrollY scrollX={false} scrollbarOptions={{ visible: false }}>
              <For each={sectionOrder}>
                {(section, index) => (
                  <box flexDirection="column" flexShrink={0} marginTop={index() === 0 ? 0 : 1}>
                    <text height={1} flexShrink={0} fg={colors.muted}>{section}</text>
                    <box height={1} flexShrink={0} />
                    <For each={sectionSettings[section]}>{(setting) => settingRow(setting)}</For>
                  </box>
                )}
              </For>
            </scrollbox>
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
