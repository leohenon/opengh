import { TextAttributes } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/solid";
import { createSignal } from "solid-js";
import { normalizeRepository } from "../repository-name";
import { LoadingText } from "./components/loading-text";
import { Popup } from "./components/popup";
import { SearchablePicker } from "./components/searchable-picker";
import { colors } from "./theme";

export function ResolvingRepository() {
  const dimensions = useTerminalDimensions();
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
          ◉ openGH
        </text>
        <LoadingText
          text="Finding repository…"
          color={colors.muted}
        />
      </box>
    </box>
  );
}

export function LoadingRepository(props: { repository: string }) {
  const dimensions = useTerminalDimensions();
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
  onQuit?: () => void;
}) {
  const dimensions = useTerminalDimensions();
  const renderer = useRenderer();
  const quit = () => props.onQuit ? props.onQuit() : renderer.destroy();

  useKeyboard((event) => {
    if (event.name === "r") return props.onRetry();
    if ((event.ctrl && event.name === "c") || event.name === "q") quit();
  });

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={colors.canvas}>
      <Popup width={64} height={9} placement="center">
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
          <text fg={colors.muted}>r retry · q quit</text>
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
  const quit = () => props.onQuit ? props.onQuit() : renderer.destroy();
  const [error, setError] = createSignal(props.error ?? "");
  const recent = () => props.recent.slice(0, 5);

  const open = (candidate: string) => {
    const repository = normalizeRepository(candidate);
    if (!repository) return setError("Enter owner/repository or a GitHub URL");
    setError("");
    props.onOpen(repository);
  };

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") quit();
  });

  const height = () => Math.min(20, 7 + recent().length + (error() ? 1 : 0));

  return (
    <SearchablePicker
      title="Open a GitHub repository"
      placeholder="owner/repository or GitHub URL"
      items={recent()}
      itemKey={(repository) => repository}
      match={(repository, query) => {
        if (!query) return 0;
        const index = repository.toLowerCase().indexOf(query.toLowerCase());
        return index < 0 ? undefined : index;
      }}
      height={height()}
      placement="center"
      listTitle={recent().length ? "Recent repositories" : undefined}
      empty={recent().length ? "No matching repositories" : undefined}
      numbered
      error={error()}
      onQueryChange={() => setError("")}
      onSelect={open}
      onSubmit={(query, selected) => open(query || selected || "")}
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
