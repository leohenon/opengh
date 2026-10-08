import { TextAttributes } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import { normalizeRepository } from "../repository-name";

const colors = {
  canvas: "#0d1117",
  panel: "#161b22",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  blue: "#58a6ff",
  red: "#f85149",
  green: "#3fb950",
};

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
        <text fg={colors.muted}>
          Finding the repository for this directory…
        </text>
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
        <text fg={colors.muted}>Loading repository data…</text>
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
  const dimensions = useTerminalDimensions();
  const renderer = useRenderer();
  const quit = () => props.onQuit ? props.onQuit() : renderer.destroy();
  const [value, setValue] = createSignal("");
  const [error, setError] = createSignal(props.error ?? "");

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
    const index = Number(event.name) - 1;
    if (!value() && index >= 0 && index < props.recent.length)
      open(props.recent[index]);
  });

  const width = () => Math.min(72, Math.max(42, dimensions().width - 8));
  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={colors.canvas}
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={width()}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={colors.border}
        backgroundColor={colors.panel}
        padding={2}
        gap={1}
        title=" openGH "
      >
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          Open a GitHub repository
        </text>
        <box
          height={3}
          border
          borderColor={colors.blue}
          paddingLeft={1}
          paddingRight={1}
          alignItems="center"
        >
          <input
            width="100%"
            focused
            value={value()}
            placeholder="owner/repository"
            textColor={colors.text}
            cursorColor={colors.blue}
            onInput={setValue}
            onKeyDown={(event) => {
              if (event.name === "return") open(value());
            }}
          />
        </box>
        <Show when={error()}>
          {(message) => <text fg={colors.red}>{message()}</text>}
        </Show>
        <Show
          when={props.recent.length > 0}
          fallback={
            <text fg={colors.muted}>No recently opened repositories</text>
          }
        >
          <box flexDirection="column" gap={1} paddingTop={1}>
            <text fg={colors.text} attributes={TextAttributes.BOLD}>
              Recent repositories
            </text>
            <For each={props.recent}>
              {(repository, index) => (
                <text fg={colors.blue}>
                  {index() + 1} {repository}
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
    </box>
  );
}
