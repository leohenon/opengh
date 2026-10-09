import { TextAttributes } from "@opentui/core";
import type { JSX } from "solid-js";
import { useTheme } from "../theme";
import { Popup } from "./popup";

function Shortcut(props: { keys: string; children: JSX.Element }) {
  const { colors } = useTheme();

  return (
    <box height={1} flexShrink={0} flexDirection="row">
      <text width={20} fg={colors.text}>
        {props.keys}
      </text>
      <text fg={colors.muted}>{props.children}</text>
    </box>
  );
}

export function Help() {
  const { colors } = useTheme();

  return (
    <Popup width={64} height={16} zIndex={200}>
      <box
        flexGrow={1}
        minHeight={0}
        flexDirection="column"
        paddingLeft={4}
        paddingRight={4}
        paddingBottom={1}
      >
        <box
          height={1}
          flexShrink={0}
          flexDirection="row"
          justifyContent="space-between"
        >
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            Help
          </text>
          <text fg={colors.muted}>esc</text>
        </box>

        <box height={1} flexShrink={0} />
        <Shortcut keys="1–5, h/l, ←/→">switch tabs</Shortcut>
        <Shortcut keys="j/k, ↑/↓">move / scroll</Shortcut>
        <Shortcut keys="u/d">half-page up / down</Shortcut>
        <Shortcut keys="g/G">jump to top / bottom</Shortcut>
        <Shortcut keys="Tab / ⇧Tab">cycle view options</Shortcut>

        <box height={1} flexShrink={0} />
        <Shortcut keys="r">refresh</Shortcut>
        <Shortcut keys=",">settings</Shortcut>
        <Shortcut keys="?">toggle help</Shortcut>
        <Shortcut keys="q / Ctrl-C">quit</Shortcut>
      </box>
    </Popup>
  );
}
