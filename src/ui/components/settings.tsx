import { CliRenderEvents, RGBA, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { Config } from "../../config"
import { mouseClick, mouseHover } from "../mouse"
import { useTheme } from "../theme"
import { Action } from "./action"
import { Popup } from "./popup"
import { ThemePicker } from "./theme-picker"
import { useKeyActions, useKeybindings } from "../keybindings"
import { createRenderedSearch } from "../rendered-search"
import { useSearchTarget } from "../search-context"

type Setting = "theme" | "color-mode" | "reduced-motion" | "markdown-style" | "scrollbars" | "detail-layout" | "details-placement" | "status-bar-hints" | "icon-style" | "compact-header" | "hide-documents-tab" | "tab-counts"

const sectionOrder = ["Appearance", "Layout", "Usability"] as const
type Section = typeof sectionOrder[number]
const sectionSettings: Record<Section, readonly Setting[]> = {
  Appearance: ["theme", "color-mode", "markdown-style"],
  Layout: ["compact-header", "tab-counts", "hide-documents-tab", "detail-layout", "details-placement"],
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
  "detail-layout": { title: "Detail width", description: "Detail page width", value: (config) => config.detailLayout },
  "details-placement": { title: "Details placement", description: "Issue and PR metadata", value: (config) => config.detailsPlacement },
  "icon-style": { title: "Icon style", description: "Terminal symbols", value: (config) => config.iconStyle === "nerd" ? "Nerd Font" : config.iconStyle === "none" ? "None" : "Unicode" },
  "status-bar-hints": { title: "Shortcut hints", description: "Keyboard shortcuts", value: (config) => config.showStatusBarHints ? "on" : "off" },
  scrollbars: { title: "Scrollbars", description: "Lists and documents", value: (config) => config.showScrollbars ? "on" : "off" },
  "reduced-motion": { title: "Reduced motion", description: "Static loading indicators", value: (config) => config.reducedMotion ? "on" : "off" },
}
const colorModeValues = ["system", "dark", "light"] as const

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
  const keys = useKeybindings()
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
  createEffect(() => props.onHintChange?.(busy() ? "Updating settings…" : screen() === "themes"
    ? keys.hints(["picker.accept", "confirm"], [["picker.up", "picker.down"], "select"], ["dialog.close", "back"])
    : keys.hints(["navigation.activate", selected() === "theme" ? "open" : "change"], [["navigation.up", "navigation.down"], "select"], [["settings.previousValue", "settings.nextValue"], "change"], ["search.start", "search"], ["dialog.close", "close"])))
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
  const searchRows = new Map<Setting, ReturnType<typeof createRenderedSearch>>()
  const matchingRows = new Map<Setting, string>()
  useSearchTarget({
    scope: "settings",
    id: () => "settings",
    active: () => screen() === "settings" && !busy(),
    position: () => settingOrder.indexOf(selected()),
    selection: selected,
    search(query) {
      matchingRows.clear()
      return settingOrder.flatMap((setting, index) => {
        const matches = searchRows.get(setting)?.search(query) ?? []
        if (!matches.length) return []
        matchingRows.set(setting, matches[0]!.id)
        return [{ id: setting, position: index, reveal() { setSelected(setting); revealSetting() } }]
      })
    },
    highlight(id) {
      for (const [setting, first] of matchingRows) searchRows.get(setting)?.highlight(setting === id ? first : undefined)
    },
    clear() { for (const row of searchRows.values()) row.clear() },
    snapshot() {
      const setting = selected()
      const top = settingsScroll?.scrollTop ?? 0
      return () => {
        setSelected(setting)
        if (settingsScroll && !settingsScroll.isDestroyed) settingsScroll.scrollTo(top)
      }
    },
  })
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

  const changeDetailsPlacement = async () => {
    if (busy()) return
    setSaving(true)
    setError("")
    try {
      await props.onChange({ ...props.config, detailsPlacement: props.config.detailsPlacement === "inline" ? "auto" : "inline" })
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
      await props.onChange({ ...props.config, iconStyle: props.config.iconStyle === "unicode" ? "nerd" : props.config.iconStyle === "nerd" ? "none" : "unicode" })
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
  const closeThemes = () => {
    theme.preview()
    setScreen("settings")
  }
  const requestClose = () => {
    if (busy()) return
    if (screen() === "themes") closeThemes()
    else props.onClose()
  }

  const changeSetting = (setting: Setting, direction: number) => {
    if (busy()) return
    setSelected(setting)
    revealSetting()
    switch (setting) {
      case "theme": openThemes(); break
      case "color-mode": void changeColorMode(direction); break
      case "reduced-motion": void toggleBoolean("reducedMotion"); break
      case "markdown-style": void changeMarkdownStyle(); break
      case "scrollbars": void toggleBoolean("showScrollbars"); break
      case "tab-counts": void toggleBoolean("showTabCounts"); break
      case "hide-documents-tab": void toggleBoolean("hideDocumentsTab"); break
      case "compact-header": void toggleBoolean("compactHeader"); break
      case "status-bar-hints": void toggleBoolean("showStatusBarHints"); break
      case "detail-layout": void changeDetailLayout(); break
      case "details-placement": void changeDetailsPlacement(); break
      case "icon-style": void changeIconStyle(); break
    }
  }
  useKeyActions({}, { when: () => screen() === "settings" && busy(), priority: 200, modal: true })
  useKeyActions({
    "dialog.close": requestClose,
    "navigation.up": () => moveSetting(-1),
    "navigation.down": () => moveSetting(1),
    "settings.previousValue": () => changeSetting(selected(), -1),
    "settings.nextValue": () => changeSetting(selected(), 1),
    "navigation.activate": () => changeSetting(selected(), 1),
  }, { when: () => screen() === "settings" && !busy(), priority: 100, modal: true })

  const settingRow = (setting: Setting) => {
    const definition = settingDefinitions[setting]
    const active = () => selected() === setting
    const hover = mouseHover(() => !busy(), () => setting)
    onCleanup(() => { searchRows.get(setting)?.dispose(); searchRows.delete(setting) })
    return (
      <box
        id={`setting-${setting}`}
        ref={(row) => searchRows.set(setting, createRenderedSearch(row, {
          exclude: (node) => node === row.getChildren()[0]
            || node.id === `setting-${setting}-previous` || node.id === `setting-${setting}-next`,
          get matchBackground() { return RGBA.fromHex(colors.searchMatchBg) },
          get matchForeground() { return RGBA.fromHex(colors.searchMatchFg) },
          get activeBackground() { return RGBA.fromHex(colors.searchCurrentMatchBg) },
          get activeForeground() { return RGBA.fromHex(colors.searchCurrentMatchFg) },
        }))}
        {...mouseClick(() => changeSetting(setting, 1), () => !busy(), () => setting, hover)}
        height={rowHeight()}
        flexShrink={0}
        flexDirection="row"
        alignItems="flex-start"
        backgroundColor={active() || hover.hovered() ? colors.panelHover : colors.panel}
        paddingLeft={1}
        paddingRight={1}
      >
        <text width={2} fg={colors.blue}>{active() ? "›" : " "}</text>
        <box flexGrow={1} minWidth={0} flexDirection="column">
          <text width="100%" height={1} wrapMode="none" fg={colors.text} attributes={active() ? TextAttributes.BOLD : TextAttributes.NONE}>{definition.title}</text>
          <text width="100%" height={1} wrapMode="none" fg={colors.muted}>{definition.description}</text>
        </box>
        <box width={split() ? 24 : Math.min(24, Math.max(12, Math.floor((dimensions().width - 10) * 0.35)))} height={1} flexShrink={0} flexDirection="row">
          <Action id={`setting-${setting}-previous`} onActivate={() => changeSetting(setting, -1)} disabled={busy()} fg={active() ? colors.blue : colors.muted}>‹</Action>
          <text minWidth={0} flexShrink={1} wrapMode="none" fg={active() ? colors.blue : colors.muted}> {definition.value(props.config)} </text>
          <Action id={`setting-${setting}-next`} onActivate={() => changeSetting(setting, 1)} disabled={busy()} fg={active() ? colors.blue : colors.muted}>›</Action>
        </box>
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
      description: "Replace animated loading dots with a static indicator, including running workflows. Loading messages and live data updates remain enabled.",
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
      description: "Show the document tab strip on Overview. When off, documents remain visible." + (keys.key("overview.nextDocument") ? ` Use ${keys.key("overview.nextDocument")} to cycle between them.` : ""),
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
    if (selected() === "details-placement") return {
      title: "Details placement",
      description: "Auto puts issue and PR metadata in a sidebar on wide terminals and inline on narrow ones. Inline always places details below the title. Overview is not affected. --inline output always uses inline details.",
    }
    return {
      title: "Shortcut hints",
      description: "Show keyboard shortcuts in the status bar on every page. Loading messages stay visible when hints are off.",
    }
  }

  return (
    <Popup width={100} height={popupHeight()} fullscreen={!split()} zIndex={200} placement="center" onClose={requestClose}>
      <Show
        when={screen() === "settings"}
        fallback={(
          <ThemePicker
            current={props.config.theme}
            saving={busy()}
            onPreview={theme.preview}
            onCancel={closeThemes}
            onSelect={async (name) => {
              setSaving(true)
              try {
                await props.onChange({ ...props.config, theme: name })
                closeThemes()
              } finally {
                setSaving(false)
              }
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
            <scrollbox ref={(value) => { settingsScroll = value }} focusable={false} flexGrow={1} minHeight={0} scrollY scrollX={false} scrollbarOptions={{ visible: false }}>
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
