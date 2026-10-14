import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, For, type JSX } from "solid-js";
import type { Page } from "../../navigation";
import { useTheme } from "../theme";
import { Popup } from "./popup";

type ShortcutEntry = { keys: string; description: string };

const commonShortcuts: ShortcutEntry[] = [
  { keys: "j/k, ↑/↓", description: "move / scroll" },
  { keys: "u/d", description: "half-page up / down" },
  { keys: "g/G", description: "jump to top / bottom" },
  { keys: "r", description: "refresh / retry" },
  { keys: "s", description: "switch repository" },
  { keys: ",", description: "settings" },
  { keys: "?", description: "toggle help" },
  { keys: "q / C-c", description: "quit" },
];

function Shortcut(props: { keys: string; keyWidth: number; children: JSX.Element }) {
  const { colors } = useTheme();

  return (
    <box height={1} flexShrink={0} flexDirection="row">
      <text width={props.keyWidth} height={1} flexShrink={0} wrapMode="none" fg={colors.text}>
        {props.keys}
      </text>
      <text height={1} flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" fg={colors.muted}>
        {props.children}
      </text>
    </box>
  );
}

export function Help(props: {
  view: Page | "commit" | "issue";
  tabCount: number;
  hasDocumentTabs?: boolean;
  hasMoreFiles?: boolean;
  hasMoreComments?: boolean;
  hasReferences?: boolean;
  command?: string;
}) {
  const { colors } = useTheme();
  const dimensions = useTerminalDimensions();
  const compact = () => dimensions().width < 64;
  const keyWidth = () => compact() ? 14 : 20;
  const viewShortcuts = createMemo<ShortcutEntry[]>(() => {
    switch (props.view) {
      case "overview":
        return [
          ...(props.hasDocumentTabs ? [{ keys: "Tab / ⇧Tab", description: "switch documents" }] : []),
          { keys: "o", description: "open repo on GitHub" },
          { keys: "y", description: "copy repo URL" },
        ];
      case "commits":
        return [
          { keys: "Enter", description: "open commit" },
          { keys: "Tab", description: "choose branch" },
          { keys: "o", description: "open on GitHub" },
          { keys: "y", description: "copy commit SHA" },
        ];
      case "commit":
        return [
          { keys: "Esc", description: "back to commits" },
          { keys: "o", description: "open on GitHub" },
          { keys: "y", description: "copy commit SHA" },
          ...(props.hasMoreFiles ? [{ keys: "Enter", description: "load more files" }] : []),
        ];
      case "issues":
        return [
          { keys: "Enter", description: "open issue" },
          { keys: "Tab", description: "toggle open/closed" },
          { keys: "o", description: "open on GitHub" },
          { keys: "y", description: "copy issue URL" },
        ];
      case "issue":
        return [
          { keys: "Esc", description: "back to issues" },
          { keys: "o", description: "open on GitHub" },
          { keys: "y", description: "copy issue URL" },
          ...(props.hasReferences ? [{ keys: "p", description: "open references" }] : []),
          ...(props.hasMoreComments ? [{ keys: "Enter", description: "load more comments" }] : []),
        ];
      case "pulls":
        return [{ keys: "Tab", description: "toggle open/closed" }];
      case "actions":
        return [];
    }
  });
  const shortcuts = createMemo(() => {
    const tabs = `1–${props.tabCount}, h/l, ←/→`;
    const entries = [...(props.command ? [{ keys: "x", description: props.command }] : []), ...viewShortcuts(), { keys: tabs, description: "switch tabs" }, ...commonShortcuts];
    const order = ["Enter", "Tab", "Tab / ⇧Tab", "Esc", tabs, "j/k, ↑/↓", "u/d", "g/G", "o", "y", "x", "p", "r", "s", ",", "?", "q / C-c"];
    return order.flatMap((keys) => entries.filter((shortcut) => shortcut.keys === keys));
  });
  const height = () => shortcuts().length + 4;

  return (
    <Popup width={64} height={height()} zIndex={200} placement="center">
      <box
        flexGrow={1}
        minHeight={0}
        flexDirection="column"
        paddingLeft={compact() ? 2 : 4}
        paddingRight={compact() ? 2 : 4}
        paddingBottom={1}
      >
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            Help
          </text>
          <text fg={colors.muted}>esc</text>
        </box>

        <box height={1} flexShrink={0} />
        <box flexShrink={0} flexDirection="column">
          <For each={shortcuts()}>
            {(shortcut) => <Shortcut keys={shortcut.keys} keyWidth={keyWidth()}>{shortcut.description}</Shortcut>}
          </For>
        </box>
      </box>
    </Popup>
  );
}
