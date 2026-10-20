import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { defaultConfig } from "../src/config";
import type { IssueActionResult } from "../src/models";
import type {
  IssueActionState,
  IssueDetailState,
} from "../src/repository-state";
import { App } from "../src/ui/app";
import {
  githubDataFixture,
  issueCommentsFixture,
  issueDetailFixture,
  repositoryOperationsFixture,
} from "./fixtures/github-data";

test("issue action overlays isolate input and confirm comments, closing, reopening, and duplicates", async () => {
  const number = issueDetailFixture.number;
  const empty: IssueActionState = {
    body: "",
    reason: "completed",
    operation: { status: "idle" },
  };
  const [action, setAction] = createSignal(empty);
  const [config, setConfig] = createSignal({
    ...defaultConfig,
    showStatusBarHints: false,
    showScrollbars: false,
  });
  const hint = "tab preview · ctrl+s submit · ctrl+d discard · esc keep draft";
  const [detail, setDetail] = createSignal<IssueDetailState>({
    number,
    resource: { status: "ready", value: issueDetailFixture },
    comments: {
      status: "ready",
      value: { items: issueCommentsFixture, page: 1, hasMore: false },
    },
    references: { status: "ready", value: [] },
  });
  let quit = 0;
  let refresh = 0;
  const submitted: string[] = [];
  let complete!: (result: IssueActionResult) => void;
  const pending = new Promise<IssueActionResult>((resolve) => {
    complete = resolve;
  });
  let completeClose!: () => void;
  const closing = new Promise<void>((resolve) => {
    completeClose = resolve;
  });
  const view = await testRender(
    () => (
      <App
        data={githubDataFixture}
        operations={repositoryOperationsFixture}
        config={config()}
        issueDetail={detail()}
        onLoadIssue={async () => {}}
        onQuit={() => quit++}
        onRefresh={() => refresh++}
        getIssueAction={() => action()}
        onPrepareIssueAction={(_number, kind) =>
          setAction((current) =>
            current.retry === kind
              ? current
              : { ...current, retry: undefined, operation: { status: "idle" } },
          )
        }
        onIssueDraftChange={(_number, draft) =>
          setAction((current) => ({ ...current, ...draft }))
        }
        onDiscardIssueDraft={() => setAction(empty)}
        onSubmitIssueAction={async (_number, kind) => {
          submitted.push(kind);
          setAction((current) => ({
            ...current,
            operation: { status: "loading" },
          }));
          if (kind === "close") await closing;
          const duplicateOf =
            kind === "duplicate"
              ? Number(action().duplicateTarget?.replace(/^#/, ""))
              : undefined;
          const result: IssueActionResult =
            kind === "comment"
              ? await pending
              : {
                  issue: {
                    ...detail().resource.value!,
                    state: kind === "reopen" ? "open" : "closed",
                    stateReason:
                      kind === "duplicate"
                        ? "duplicate"
                        : kind === "close"
                          ? action().reason
                          : undefined,
                  },
                  ...(duplicateOf ? { duplicateOf } : {}),
                };
          setDetail((current) => ({
            ...current,
            resource: {
              status: "ready",
              value: result.issue ?? {
                ...current.resource.value!,
                commentCount: current.resource.value!.commentCount + 1,
              },
            },
            comments: result.comment
              ? {
                  status: "ready",
                  value: {
                    ...current.comments.value!,
                    items: [...current.comments.value!.items, result.comment],
                  },
                }
              : current.comments,
          }));
          setAction(empty);
          return result;
        }}
      />
    ),
    { width: 100, height: 32 },
  );
  const settle = async () => {
    await view.flush();
    await Bun.sleep(40);
    await view.flush();
  };
  const statusLine = () => view.captureCharFrame().split("\n")[31]!.trim();
  try {
    await settle();
    view.mockInput.pressKey("3");
    view.mockInput.pressEnter();
    await settle();
    view.mockInput.pressKey("c");
    await settle();
    await view.mockInput.typeText("**Draft** qrs?h1l,");
    view.mockInput.pressEnter();
    await settle();
    expect(action().body).toBe("**Draft** qrs?h1l,\n");
    const lines = view.captureCharFrame().split("\n");
    const tabRow = lines.findIndex(
      (line) => line.includes("Write") && line.includes("Preview"),
    );
    expect(tabRow).toBeGreaterThan(-1);
    const tabColumn = lines[tabRow]!.indexOf("Write");
    expect(lines[tabRow + 1]!.slice(tabColumn, tabColumn + 82).trim()).toBe("");
    expect(lines[tabRow + 2]).toContain("**Draft** qrs?h1l,");
    for (const label of [
      "Add comment",
      "Markdown supported",
      "Cancel",
      "Discard draft",
      "Post comment",
    ])
      expect(view.captureCharFrame()).not.toContain(label);
    expect(
      lines[tabRow - 1]!.slice(tabColumn).trimStart().startsWith(`#${number}`),
    ).toBe(true);
    expect(view.captureCharFrame()).not.toContain("ctrl+s submit");
    expect(view.captureCharFrame()).not.toContain(hint);
    setConfig((current) => ({ ...current, showStatusBarHints: true }));
    await settle();
    expect(statusLine()).toBe(hint);
    expect(statusLine()).toContain("ctrl+s submit");
    expect(view.captureCharFrame()).not.toContain("ctrl+enter");
    expect(view.captureCharFrame().split(hint)).toHaveLength(2);
    expect(submitted).toEqual([]);
    expect(quit).toBe(0);
    expect(refresh).toBe(0);
    view.mockInput.pressEscape();
    await settle();
    view.mockInput.pressKey("c");
    await settle();
    expect(view.captureCharFrame()).toContain("**Draft** qrs?h1l,");
    view.mockInput.pressTab();
    await settle();
    expect(view.captureCharFrame()).toContain("Draft");
    expect(action().body).toBe("**Draft** qrs?h1l,\n");
    const draft = action().body;
    setAction((current) => ({
      ...current,
      body: Array.from(
        { length: 40 },
        (_, index) => `Preview line ${index}`,
      ).join("\n\n"),
    }));
    await settle();
    const previewScroll = view.renderer.root.findDescendantById(
      "issue-comment-preview-scroll",
    ) as ScrollBoxRenderable;
    expect(previewScroll.scrollHeight).toBeGreaterThan(
      previewScroll.viewport.height,
    );
    expect(previewScroll.verticalScrollBar.visible).toBe(false);
    setConfig((current) => ({ ...current, showScrollbars: true }));
    await settle();
    expect(previewScroll.verticalScrollBar.visible).toBe(true);
    setConfig((current) => ({ ...current, showScrollbars: false }));
    await settle();
    expect(previewScroll.verticalScrollBar.visible).toBe(false);
    setAction((current) => ({ ...current, body: draft }));
    view.mockInput.pressTab();
    await settle();
    view.mockInput.pressKey("s", { ctrl: true });
    view.mockInput.pressKey("s", { ctrl: true });
    await settle();
    expect(submitted).toEqual([]);
    expect(view.captureCharFrame()).toContain(`Post comment to #${number}?`);
    expect(statusLine()).not.toContain("enter confirm");
    expect(view.captureCharFrame().split("enter confirm · esc back")).toHaveLength(2);
    setConfig((current) => ({ ...current, showStatusBarHints: false }));
    await settle();
    expect(view.captureCharFrame()).toContain("enter confirm · esc back");
    expect(statusLine()).not.toContain("enter confirm");
    view.mockInput.pressEscape();
    await settle();
    expect(view.captureCharFrame()).not.toContain(
      `Post comment to #${number}?`,
    );
    expect(action().body).toBe("**Draft** qrs?h1l,\n");
    setConfig((current) => ({ ...current, showStatusBarHints: true }));
    view.mockInput.pressKey("s", { ctrl: true });
    await settle();
    view.mockInput.pressEnter();
    view.mockInput.pressEnter();
    view.mockInput.pressKey("s", { ctrl: true });
    view.mockInput.pressEscape();
    view.mockInput.pressKey("q");
    await settle();
    expect(submitted).toEqual(["comment"]);
    expect(quit).toBe(0);
    expect(action().body).toBe("**Draft** qrs?h1l,\n");
    complete({
      comment: {
        ...issueCommentsFixture[0]!,
        id: 9999,
        body: "Posted from the composer",
        createdAt: "2026-07-01T00:00:00Z",
      },
    });
    await settle();
    expect(action().body).toBe("");
    expect(view.captureCharFrame()).toContain("Posted from the composer");
    expect(view.captureCharFrame()).toContain("Comment posted");
    setAction({
      ...empty,
      retry: "reopen",
      operation: { status: "error", message: "Reopening failed earlier" },
    });

    view.mockInput.pressKey("a");
    await settle();
    expect(view.captureCharFrame()).toContain("Close issue");
    expect(statusLine()).toBe("↑/↓ select · enter open · esc close");
    expect(view.captureCharFrame()).toContain("Mark as duplicate");
    expect(view.captureCharFrame()).not.toContain("Add comment");
    expect(view.captureCharFrame()).not.toContain("Open on GitHub");
    view.mockInput.pressEnter();
    await settle();
    expect(view.captureCharFrame()).toContain(`Close issue · #${number}`);
    expect(view.captureCharFrame()).not.toContain("Reopen issue");
    expect(statusLine()).toContain("tab change reason");
    expect(view.captureCharFrame()).not.toContain("Preview");
    view.mockInput.pressTab();
    expect(action().reason).toBe("not_planned");
    view.mockInput.pressTab();
    expect(action().reason).toBe("completed");
    view.mockInput.pressTab();
    expect(action().reason).toBe("not_planned");
    view.mockInput.pressArrow("left");
    view.mockInput.pressArrow("right");
    expect(action().reason).toBe("not_planned");
    view.mockInput.pressKey("s", { ctrl: true });
    await settle();
    expect(detail().resource.value?.state).toBe("open");
    expect(view.captureCharFrame()).toContain(`Close issue #${number}?`);
    view.mockInput.pressEnter();
    await view.flush();
    await Bun.sleep(220);
    await settle();
    expect(statusLine()).toContain("Closing issue…");
    expect(statusLine()).not.toContain("Reopening");
    completeClose();
    await settle();
    expect(detail().resource.value?.state).toBe("closed");
    view.mockInput.pressKey("a");
    await settle();
    expect(view.captureCharFrame()).toContain("Reopen issue");
    expect(view.captureCharFrame()).not.toContain("Mark as duplicate");
    view.mockInput.pressEnter();
    await settle();
    view.mockInput.pressKey("s", { ctrl: true });
    await settle();
    expect(view.captureCharFrame()).toContain(`Reopen issue #${number}?`);
    expect(detail().resource.value?.state).toBe("closed");
    view.mockInput.pressEnter();
    await settle();
    expect(detail().resource.value?.state).toBe("open");
    expect(submitted).toEqual(["comment", "close", "reopen"]);

    view.mockInput.pressKey("a");
    await settle();
    view.mockInput.pressKey("j");
    view.mockInput.pressEnter();
    await settle();
    expect(view.captureCharFrame()).not.toContain("Duplicate of issue");
    expect(view.captureCharFrame()).not.toContain("Closes this issue as a duplicate.");
    await view.mockInput.typeText(`#${number}`);
    view.mockInput.pressKey("s", { ctrl: true });
    await settle();
    expect(view.captureCharFrame()).toContain("duplicate of itself");
    expect(submitted).toEqual(["comment", "close", "reopen"]);
    for (let index = 0; index < String(number).length + 1; index++)
      view.mockInput.pressBackspace();
    await view.mockInput.typeText("#123");
    expect(action().duplicateTarget).toBe("#123");
    view.mockInput.pressEnter();
    await settle();
    expect(view.captureCharFrame()).toContain(
      `Close #${number} as a duplicate of #123?`,
    );
    expect(detail().resource.value?.state).toBe("open");
    view.mockInput.pressEnter();
    await settle();
    expect(detail().resource.value).toMatchObject({
      state: "closed",
      stateReason: "duplicate",
    });
    expect(submitted).toEqual(["comment", "close", "reopen", "duplicate"]);
    expect(view.captureCharFrame()).toContain("Issue marked as duplicate");
    view.mockInput.pressKey("c");
    await settle();
    expect(view.captureCharFrame()).not.toContain("Add comment");
    expect(view.captureCharFrame()).toContain("ctrl+s submit");
    await view.mockInput.typeText("Temporary text");
    view.mockInput.pressKey("d", { ctrl: true });
    await settle();
    expect(action().body).toBe("");
    expect(view.captureCharFrame()).not.toContain("Discard this draft");
  } finally {
    view.renderer.destroy();
  }
});

test("issue shortcuts and hints hide actions without viewer permission", async () => {
  const [permissions, setPermissions] = createSignal({ comment: true, close: false, reopen: false, duplicate: false });
  const selected: string[] = [];
  const view = await testRender(() => <App
    data={githubDataFixture}
    operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: true }}
    issueDetail={{
      number: issueDetailFixture.number,
      resource: { status: "ready", value: { ...issueDetailFixture, permissions: permissions() } },
      comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
      references: { status: "ready", value: [] },
    }}
    onLoadIssue={async () => {}}
    onPrepareIssueAction={(_number, kind) => selected.push(kind)}
    onSubmitIssueAction={async () => ({})}
  />, { width: 100, height: 32 });
  const settle = async () => { await view.flush(); await Bun.sleep(40); await view.flush(); };
  try {
    view.mockInput.pressKey("3");
    view.mockInput.pressEnter();
    await settle();
    expect(view.captureCharFrame()).toContain("c comment");
    expect(view.captureCharFrame()).not.toContain("a actions");
    view.mockInput.pressKey("a");
    await settle();
    expect(view.captureCharFrame()).not.toContain("Close issue…");
    view.mockInput.pressKey("c");
    await settle();
    expect(selected).toEqual(["comment"]);
    view.mockInput.pressEscape();
    setPermissions({ comment: false, close: true, reopen: false, duplicate: false });
    await settle();
    expect(view.captureCharFrame()).not.toContain("c comment");
    view.mockInput.pressKey("c");
    view.mockInput.pressKey("a");
    await settle();
    expect(selected).toEqual(["comment"]);
    expect(view.captureCharFrame()).toContain("Close issue…");
    expect(view.captureCharFrame()).not.toContain("Mark as duplicate…");
  } finally {
    view.renderer.destroy();
  }
});
