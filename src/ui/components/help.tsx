import { TextAttributes } from "@opentui/core"
import { colors } from "../theme"

export function Help() {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <box
        width={54}
        border
        borderStyle="rounded"
        borderColor={colors.blue}
        backgroundColor={colors.panel}
        flexDirection="column"
        padding={2}
        gap={1}
        title=" Keyboard shortcuts "
      >
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          Navigation
        </text>
        <text fg={colors.muted}>1–4/5 / h l / ← → switch tabs</text>
        <text fg={colors.muted}>j k / ↑ ↓ move selection</text>
        <text fg={colors.muted}>g / G jump to top / bottom</text>
        <text fg={colors.muted}>u / d move half a page</text>
        <text fg={colors.muted}>Tab branch / open-closed view</text>
        <text fg={colors.muted}>r refresh live data</text>
        <text fg={colors.muted}>? toggle this help</text>
        <text fg={colors.muted}>q / Ctrl-C quit</text>
        <text fg={colors.blue}>Press ? or Esc to return</text>
      </box>
    </box>
  );
}

