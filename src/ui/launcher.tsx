import { TextAttributes } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import { normalizeRepository } from "../repository-name";
import { LoadingText } from "./components/loading-text";
import { Popup } from "./components/popup";
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
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={colors.canvas}
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={Math.min(72, Math.max(42, dimensions().width - 8))}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={colors.red}
        backgroundColor={colors.panel}
        padding={2}
        gap={1}
        title=" Could not load repository "
      >
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          {props.repository}
        </text>
        <text fg={colors.red} wrapMode="word">
          {props.message}
        </text>
        <box height={1} />
        <text fg={colors.muted}>r retry · q quit</text>
      </box>
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
  const [value, setValue] = createSignal("");
  const [error, setError] = createSignal(props.error ?? "");
  const [selected, setSelected] = createSignal(0);
  const recentCount = () => Math.min(5, props.recent.length);

  const open = (candidate: string) => {
    const repository = normalizeRepository(candidate);
    if (!repository) return setError("Enter a repository as owner/name");
    setError("");
    props.onOpen(repository);
  };

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") return quit();
    if ((event.name === "escape" || event.name === "esc") && !value())
      return quit();
    if (event.name === "up" && recentCount())
      return setSelected((index) => Math.max(0, index - 1));
    if (event.name === "down" && recentCount())
      return setSelected((index) => Math.min(recentCount() - 1, index + 1));
    const index = Number(event.name) - 1;
    if (!value() && index >= 0 && index < recentCount())
      open(props.recent[index]);
  });

  const height = () => Math.min(20, 7 + recentCount() + (error() ? 1 : 0));

  return (
    <Popup width={64} height={height()} zIndex={100} placement="center">
      <box flexGrow={1} minHeight={0} flexDirection="column" gap={1} paddingBottom={1}>
        <box flexShrink={0} paddingLeft={4} paddingRight={4}>
          <box height={1} flexDirection="row" justifyContent="space-between">
            <text fg={colors.text} attributes={TextAttributes.BOLD}>Open a GitHub repository</text>
            <text fg={colors.muted}>esc</text>
          </box>
          <box height={2} flexShrink={0} paddingTop={1}>
            <input
              width="100%"
              focused
              value={value()}
              placeholder="owner/repository or GitHub URL"
              placeholderColor={colors.muted}
              focusedBackgroundColor={colors.panel}
              textColor={colors.text}
              cursorColor={colors.blue}
              onInput={setValue}
              onKeyDown={(event) => {
                if (event.name === "return") {
                  const recent = props.recent[selected()];
                  open(value() || recent || "");
                }
              }}
            />
          </box>
          <Show when={error()}>
            {(message) => <text height={1} fg={colors.red}>× {message()}</text>}
          </Show>
        </box>
        <Show when={recentCount() > 0}>
          <box flexDirection="column">
            <box height={1} paddingLeft={4}>
              <text fg={colors.text} attributes={TextAttributes.BOLD}>Recent repositories</text>
            </box>
            <For each={props.recent.slice(0, 5)}>
              {(repository, index) => {
                const [owner, ...nameParts] = repository.split("/");
                const name = nameParts.join("/");
                const active = () => selected() === index();
                return (
                  <box
                    height={1}
                    flexShrink={0}
                    flexDirection="row"
                    paddingLeft={3}
                    paddingRight={3}
                    backgroundColor={active() ? colors.panelHover : colors.panel}
                  >
                    <text width={2} fg={colors.blue}>{active() ? "›" : " "}</text>
                    <text width={2} fg={colors.muted}>{index() + 1}</text>
                    <text fg={colors.muted}>{owner} / </text>
                    <text fg={colors.blue} attributes={TextAttributes.BOLD}>{name}</text>
                  </box>
                );
              }}
            </For>
          </box>
        </Show>
      </box>
    </Popup>
  );
}
