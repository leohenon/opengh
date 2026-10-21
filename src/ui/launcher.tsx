import { TextAttributes } from "@opentui/core";
import {
  useRenderer,
  useTerminalDimensions,
} from "@opentui/solid";
import { createSignal } from "solid-js";
import { normalizeRepository } from "../repository-name";
import { LoadingText } from "./components/loading-text";
import { Popup } from "./components/popup";
import { SearchablePicker } from "./components/searchable-picker";
import { useKeyActions, useKeybindings } from "./keybindings";
import { useTheme } from "./theme";

export function ResolvingRepository() {
  const dimensions = useTerminalDimensions();
  const { colors } = useTheme();
  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={colors.canvas}
      alignItems="center"
      justifyContent="center"
    >
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          ◉ opengh
        </text>
        <LoadingText
          text="Finding repository…"
          color={colors.muted}
        />
      </box>
    </box>
  );
}

export function LoadingRepository(props: { repository: string; onSwitchRepository?: () => void }) {
  const dimensions = useTerminalDimensions();
  const { colors } = useTheme();
  useKeyActions({
    "global.switchRepository": () => {
      if (!props.onSwitchRepository) return false;
      props.onSwitchRepository();
    },
  });
  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={colors.canvas}
      alignItems="center"
      justifyContent="center"
    >
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          {props.repository}
        </text>
        <LoadingText text="Loading…" color={colors.muted} />
      </box>
    </box>
  );
}

export function RepositoryLoadError(props: {
  repository: string;
  message: string;
  onRetry: () => void;
  onSwitchRepository?: () => void;
  onQuit?: () => void;
}) {
  const dimensions = useTerminalDimensions();
  const renderer = useRenderer();
  const { colors } = useTheme();
  const quit = () => props.onQuit ? props.onQuit() : renderer.destroy();

  const keys = useKeybindings();
  useKeyActions({
    "view.refresh": () => props.onRetry(),
    "global.switchRepository": () => {
      if (!props.onSwitchRepository) return false;
      props.onSwitchRepository();
    },
    "global.quit": quit,
  });

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={colors.canvas}>
      <Popup width={64} height={13} placement="center">
        <box
          flexGrow={1}
          minHeight={0}
          flexDirection="column"
          paddingLeft={4}
          paddingRight={4}
          paddingBottom={1}
          gap={1}
        >
          <text fg={colors.text} attributes={TextAttributes.BOLD}>Repository unavailable</text>
          <text fg={colors.text}>{props.repository}</text>
          <text flexGrow={1} minHeight={0} fg={colors.red} wrapMode="word">{props.message}</text>
          <text fg={colors.muted}>{keys.hints(["view.refresh", "retry"], ...(props.onSwitchRepository ? [["global.switchRepository", "switch repo"] as const] : []), ["global.quit", "quit"])}</text>
        </box>
      </Popup>
    </box>
  );
}

export function RepositoryPicker(props: {
  recent: string[];
  error?: string;
  onOpen: (repository: string) => void;
  onQuit?: () => void;
}) {
  const renderer = useRenderer();
  const { colors } = useTheme();
  const quit = () => props.onQuit ? props.onQuit() : renderer.destroy();
  const [error, setError] = createSignal(props.error ?? "");
  const dimensions = useTerminalDimensions();
  const recent = () => props.recent;

  const open = (candidate: string) => {
    const repository = normalizeRepository(candidate);
    if (!repository) return setError("Enter owner/repository or a GitHub URL");
    setError("");
    props.onOpen(repository);
  };

  const errorLines = () => error() ? 1 + Math.ceil((error().length + 2) / Math.max(1, Math.min(80, dimensions().width - 2) - 8)) : 0;
  const height = () => 7 + Math.min(20, recent().length) + errorLines();

  return (
    <SearchablePicker
      title="Open a GitHub repository"
      placeholder="Search recent repositories, owner/repository or GitHub URL"
      items={recent()}
      itemKey={(repository) => repository}
      match={(repository, query) => {
        if (!query) return 0;
        const index = repository.toLowerCase().indexOf(query.toLowerCase());
        return index < 0 ? undefined : index;
      }}
      height={height()}
      width={80}
      placement="center"
      listTitle={recent().length ? "Recent repositories" : undefined}
      empty={recent().length ? "No matching repositories" : undefined}
      error={error()}
      onQueryChange={() => setError("")}
      onSelect={open}
      onSubmit={(query, selected) => open(normalizeRepository(query) ?? selected ?? query)}
      onClose={quit}
    >
      {(repository) => {
        const [owner, ...nameParts] = repository.split("/");
        return (
          <>
            <text fg={colors.muted}>{owner} / </text>
            <text fg={colors.blue} attributes={TextAttributes.BOLD}>{nameParts.join("/")}</text>
          </>
        );
      }}
    </SearchablePicker>
  );
}
