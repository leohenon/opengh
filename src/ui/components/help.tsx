import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, For, type JSX } from "solid-js";
import { parseKey, type KeyAction } from "../../keybindings";
import { useKeyActions, useKeybindings } from "../keybindings";
import type { Page } from "../../navigation";
import { useTheme } from "../theme";
import { Popup } from "./popup";

type ShortcutEntry = { actions: KeyAction[]; description: string };
// Paging keys everyone expects (PgUp/PgDn, Space) only add noise next to the letter bindings.
const obviousKey = (key: string) => ["pageup", "pagedown", "space"].includes(parseKey(key).name);
const entry = (action: KeyAction | KeyAction[], description: string): ShortcutEntry => ({ actions: typeof action === "string" ? [action] : action, description });

const navigationShortcuts: ShortcutEntry[] = [
  entry(["navigation.up", "navigation.down"], "move / scroll"),
  entry(["navigation.halfPageUp", "navigation.halfPageDown"], "half-page up / down"),
  entry(["navigation.pageUp", "navigation.pageDown"], "page up / down"),
  entry(["navigation.first", "navigation.last"], "jump to top / bottom"),
];
const searchShortcuts: ShortcutEntry[] = [
  entry("search.start", "search current page / pane"),
  entry(["search.next", "search.previous"], "next / previous search match"),
];
const applicationShortcuts: ShortcutEntry[] = [
  entry("global.help", "toggle help"),
  entry("global.switchRepository", "switch repository"),
  entry("global.settings", "settings"),
  entry("global.reloadConfig", "reload configuration"),
  entry(["global.quit", "global.interrupt"], "quit"),
];

function Shortcut(props: { keys: string; keyWidth: number; children: JSX.Element }) {
  const { colors } = useTheme();

  const rows = () => Math.max(1, Math.ceil(Bun.stringWidth(props.keys) / Math.max(1, props.keyWidth - 2)));
  return (
    <box height={rows()} flexShrink={0} flexDirection="row" gap={2}>
      <text width={Math.max(1, props.keyWidth - 2)} height={rows()} flexShrink={0} wrapMode="char" fg={colors.text}>
        {props.keys}
      </text>
      <text height={1} flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" fg={colors.muted}>
        {props.children}
      </text>
    </box>
  );
}

export function Help(props: {
  onClose: () => void;
  standalone?: boolean;
  view: Page | "run" | "commit" | "issue" | "pull" | "diff";
  hasDocumentTabs?: boolean;
  hasMoreFiles?: boolean;
  hasMoreComments?: boolean;
  hasReferences?: boolean;
  canComment?: boolean;
  hasIssueActions?: boolean;
  command?: string;
}) {
  const { colors } = useTheme();
  const dimensions = useTerminalDimensions();
  const keys = useKeybindings();
  const compact = () => dimensions().width < 64;
  let scroll: ScrollBoxRenderable | undefined;
  useKeyActions({
    "navigation.up": () => scroll?.scrollBy(-1),
    "navigation.down": () => scroll?.scrollBy(1),
    "navigation.halfPageUp": () => scroll?.scrollBy(-Math.max(1, Math.floor((scroll.viewport.height ?? 1) / 2))),
    "navigation.halfPageDown": () => scroll?.scrollBy(Math.max(1, Math.floor((scroll.viewport.height ?? 1) / 2))),
    "navigation.pageUp": () => scroll?.scrollBy(-scroll.viewport.height),
    "navigation.pageDown": () => scroll?.scrollBy(scroll.viewport.height),
    "navigation.first": () => scroll?.scrollTo(0),
    "navigation.last": () => scroll?.scrollTo(scroll.scrollHeight),
  }, { priority: 110 });

  const viewShortcuts = createMemo<ShortcutEntry[]>(() => {
    switch (props.view) {
      case "overview":
        return [
          ...(props.hasDocumentTabs ? [entry(["overview.nextDocument", "overview.previousDocument"], "switch documents")] : []),
          entry("overview.toggleSidebar", "show / hide About sidebar"),
          entry("item.open", "open repo on GitHub"),
          entry("item.copy", "copy repo URL"),
        ];
      case "commits":
        return [
          entry("navigation.activate", "open commit"),
          entry("commits.chooseBranch", "choose branch"),
          entry("item.diff", "view diff"),
          entry("item.open", "open on GitHub"),
          entry("item.copy", "copy commit SHA"),
        ];
      case "commit":
        return [
          entry("navigation.back", "back to commits"),
          ...(props.hasMoreFiles ? [entry("navigation.activate", "load more files")] : []),
          ...(props.hasReferences ? [entry("detail.references", "open references")] : []),
          entry("item.diff", "view diff"),
          entry("item.open", "open on GitHub"),
          entry("item.copy", "copy commit SHA"),
        ];
      case "issues":
        return [
          entry("navigation.activate", "open issue"),
          entry("work.toggleState", "toggle open/closed"),
          entry("item.open", "open on GitHub"),
          entry("item.copy", "copy issue URL"),
        ];
      case "issue":
        return [
          entry("navigation.back", "back to issues"),
          entry("detail.toggleTimeline", "collapse / expand timeline"),
          ...(props.hasMoreComments ? [entry("navigation.activate", "load more comments")] : []),
          ...(props.canComment ? [entry("issue.comment", "add comment")] : []),
          ...(props.hasIssueActions ? [entry("issue.actions", "issue actions")] : []),
          entry("item.open", "open on GitHub"),
          entry("item.copy", "copy issue URL"),
          ...(props.hasReferences ? [entry("detail.references", "open references")] : []),
        ];
      case "pulls":
        return [
          entry("navigation.activate", "open pull request"),
          entry("work.toggleState", "toggle open/closed"),
          entry("item.diff", "view diff"),
          entry("item.open", "open on GitHub"),
          entry("item.copy", "copy pull request URL"),
        ];
      case "pull":
        return [
          entry("navigation.back", "back to pull requests"),
          entry("detail.toggleTimeline", "collapse / expand timeline"),
          ...(props.hasMoreComments ? [entry("navigation.activate", "load more comments")] : []),
          ...(props.canComment ? [entry("issue.comment", "add comment")] : []),
          ...(props.hasIssueActions ? [entry("issue.actions", "PR actions")] : []),
          entry("item.diff", "view diff"),
          entry("item.open", "open on GitHub"),
          entry("item.copy", "copy pull request URL"),
          ...(props.hasReferences ? [entry("detail.references", "open references")] : []),
        ];
      case "actions":
        return [
          entry("navigation.activate", "open workflow run"),
          entry("item.open", "open on GitHub"),
          entry("item.copy", "copy run URL"),
        ];
      case "run":
        return [
          entry("navigation.back", "back to workflow runs"),
          entry("navigation.activate", "load more jobs"),
          entry("item.open", "open on GitHub"),
          entry("item.copy", "copy run URL"),
        ];
      case "diff":
        return [];
    }
  });
  const shortcuts = createMemo(() => {
    const pageEntries = viewShortcuts();
    const primaryActions: KeyAction[] = ["navigation.back", "navigation.activate", "issue.comment", "issue.actions"];
    const primary = pageEntries.filter((item) => item.actions.some((action) => primaryActions.includes(action)));
    const external = pageEntries.filter((item) => item.actions.includes("item.open") || item.actions.includes("item.copy"));
    const options = pageEntries.filter((item) => !primary.includes(item) && !external.includes(item));
    // Stable sections across every page: primary actions, navigation/options,
    // external actions, then app controls. Numbered tab keys are in the header.
    const appShortcuts = [
      ...(props.standalone ? [entry("global.openFullApp", "open full app")] : []),
      ...applicationShortcuts,
    ];
    const entries = props.view === "diff" ? [
      entry("navigation.back", "close diff; return to origin"),
      entry(["diff.previousFile", "diff.nextFile"], "previous / next file"),
      entry("navigation.activate", "error → file list"),
      entry(["navigation.up", "navigation.down", "navigation.halfPageUp", "navigation.halfPageDown", "navigation.pageUp", "navigation.pageDown", "navigation.first", "navigation.last"], "scroll diff (j/k, u/d, f/b, Space, g/G)"),
      entry(["diff.panLeft", "diff.panRight"], "pan diff horizontally"),
      ...searchShortcuts,
      entry(["diff.previousHunk", "diff.nextHunk"], "previous / next hunk"),
      entry("diff.toggleFiles", "toggle file sidebar"),
      entry("diff.filterFiles", "filter file paths in the status bar; Esc clears"),
      entry("diff.toggleLayout", "toggle split / unified"),
      entry("diff.toggleWrap", "toggle line wrapping"),
      entry("diff.toggleComments", "collapse / expand review comments"),
      entry("view.refresh", "refresh / retry"),
      entry("item.open", "open diff on GitHub"),
      entry("diff.openViewer", "open diff in external viewer"),
      ...appShortcuts.filter((item) => !item.actions.includes("global.settings")),
    ] : [
      ...primary,
      ...navigationShortcuts,
      ...searchShortcuts,
      ...(!props.standalone ? [entry(["navigation.previousTab", "navigation.nextTab"], "switch tabs")] : []),
      ...options,
      ...(props.command ? [entry("command.clone", props.command)] : []),
      entry("view.refresh", "refresh / retry"),
      ...external,
      ...appShortcuts,
    ];
    return [
      ...entries.flatMap(({ actions, description }) => {
        const label = [...new Set(actions.map((action) => keys.key(action, true, obviousKey)).filter(Boolean))].join(" / ");
        return label ? [{ keys: label, description }] : [];
      }),
      { keys: "Right-click", description: "open context menu" },
    ];
  });
  const padding = () => dimensions().width < 20 ? 0 : compact() ? 2 : 4;
  const width = () => Math.max(1, Math.min(100, dimensions().width - 2,
    Math.max(64, ...shortcuts().map((item) => Bun.stringWidth(item.keys) + Bun.stringWidth(item.description) + padding() * 2 + 3))));
  const keyWidth = () => Math.min(
    Math.max(1, Math.floor((width() - padding() * 2) * 0.55)),
    Math.max(1, ...shortcuts().map((item) => Bun.stringWidth(item.keys) + 2)),
  );
  const height = () => Math.max(1, Math.min(
    shortcuts().reduce((rows, item) => rows + Math.max(1, Math.ceil(Bun.stringWidth(item.keys) / Math.max(1, keyWidth() - 2))), 4),
    dimensions().height - 2,
  ));

  return (
    <Popup width={width()} height={height()} zIndex={200} placement="center" onClose={props.onClose}>
      <box
        flexGrow={1}
        minHeight={0}
        flexDirection="column"
        paddingLeft={padding()}
        paddingRight={padding()}
        paddingBottom={1}
      >
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            Help
          </text>
        </box>

        <box height={1} flexShrink={0} />
        <scrollbox ref={(value) => { scroll = value }} focusable={false} flexGrow={1} minHeight={0} scrollY scrollX={false} scrollbarOptions={{ visible: false }}>
          <For each={shortcuts()}>
            {(shortcut) => <Shortcut keys={shortcut.keys} keyWidth={keyWidth()}>{shortcut.description}</Shortcut>}
          </For>
        </scrollbox>
      </box>
    </Popup>
  );
}
