import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { ScrollBoxRenderable, TextareaRenderable, TextRenderable } from "@opentui/core";
import { createSignal, Show } from "solid-js";
import { defaultConfig } from "../src/config";
import type { IssueActionResult, Paginated } from "../src/models";
import type {
  IssueActionState,
  IssueDetailState,
  ResourceState,
} from "../src/repository-state";
import { App } from "../src/ui/app";
import { StatusBar } from "../src/ui/components/status-bar";
import { IssueActionDialog, IssueActionsMenu } from "../src/ui/components/issue-actions";
import { KeybindingsProvider, replaceEditorText } from "../src/ui/keybindings";
import { IssueAssigneesPicker } from "../src/ui/components/issue-assignees-picker";
import { clickControl } from "./fixtures/mouse";
import {
  githubDataFixture,
  pullContextFixture,
  issueCommentsFixture,
  issueDetailFixture,
  repositoryOperationsFixture,
} from "./fixtures/github-data";

test("PR action menu reveals selection in a short viewport and after resize before opening a dialog", async () => {
  const selected: string[] = [];
  const view = await testRender(() => <KeybindingsProvider>
    <IssueActionsMenu number={42} parent="pull" state="open"
      permissions={{ close: true, assignees: true }} merge={{ reason: "Blocked" }}
      onReview={() => selected.push("review")} onMerge={() => selected.push("merge")}
      onSelect={kind => selected.push(kind)} onClose={() => {}} />
  </KeybindingsProvider>, { width: 80, height: 8 });
  try {
    await view.flush();
    expect(view.captureCharFrame()).toContain("PR #42 · Actions");
    expect(view.captureCharFrame()).toContain("› Review…");
    expect(view.captureCharFrame()).not.toContain("Close PR…");
    view.mockInput.pressArrow("down"); await view.flush();
    expect(view.captureCharFrame()).toContain("› Merge…");
    view.mockInput.pressEnter(); await view.flush();
    await clickControl(view, "issue-menu-merge");
    expect(selected).toEqual([]);
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("down"); await view.flush();
    expect(view.captureCharFrame()).toContain("› Close PR…");
    expect(selected).toEqual([]);
    view.resize(80, 24); await view.flush();
    expect(view.captureCharFrame()).toContain("› Close PR…");
    const scroll = view.renderer.root.findDescendantById("issue-actions-scroll") as ScrollBoxRenderable;
    expect(scroll.height).toBeLessThan(8);
    view.resize(80, 7); await view.flush();
    expect(view.captureCharFrame()).toContain("PR #42 · Actions");
    expect(view.captureCharFrame()).toContain("› Close PR…");
    view.resize(80, 6); await view.flush();
    view.mockInput.pressArrow("up");
    view.mockInput.pressEnter(); await view.flush();
    expect(selected).toEqual([]);
    view.resize(80, 8); await view.flush();
    expect(view.captureCharFrame()).toContain("› Close PR…");
    view.mockInput.pressEnter(); await view.flush();
    // The menu only requests the dialog; submission remains its separate confirmation flow.
    expect(selected).toEqual(["close"]);
    await clickControl(view, "issue-menu-assignees");
    expect(selected).toEqual(["close", "assignees"]);
  } finally { view.renderer.destroy(); }
});

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
  const hint = "ctrl+s submit · ctrl+p preview · ctrl+o expand · ctrl+g editor · ctrl+d clear · esc keep draft";
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
    expect(view.captureCharFrame()).toContain("**Draft** qrs?h1l,");
    for (const label of ["Add comment", "Markdown supported", "Cancel", "Discard", "Write", "Preview"])
      expect(view.captureCharFrame()).not.toContain(label);
    expect(view.renderer.root.findDescendantById("issue-action-discard")).toBeUndefined();
    expect(view.renderer.root.findDescendantById("issue-action-back")).toBeUndefined();
    const submit = view.renderer.root.findDescendantById("issue-action-submit") as TextRenderable;
    expect(view.renderer.root.findDescendantById("issue-action-preview")).toBeUndefined();
    const idleBackground = submit.bg;
    await view.mockMouse.moveTo(submit.x, submit.y);
    await view.flush();
    expect(submit.bg).not.toEqual(idleBackground);
    expect(submitted).toEqual([]);
    await view.mockMouse.moveTo(submit.x - 1, submit.y);
    await view.flush();
    expect(submit.bg).toEqual(idleBackground);
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
    await view.mockMouse.click(0, 0); await view.flush();
    await settle();
    expect(view.renderer.root.findDescendantById("issue-action-submit")).toBeUndefined();
    expect(action().body).toBe("**Draft** qrs?h1l,\n");
    view.mockInput.pressKey("c");
    await settle();
    expect(view.captureCharFrame()).toContain("**Draft** qrs?h1l,");
    view.mockInput.pressKey("d", { ctrl: true });
    await settle();
    expect(action().body).toBe("");
    await view.mockInput.typeText("**Draft** qrs?h1l,");
    view.mockInput.pressEnter();
    await settle();
    view.mockInput.pressKey("p", { ctrl: true });
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
    view.mockInput.pressKey("p", { ctrl: true });
    await settle();
    await clickControl(view, "issue-action-submit");
    view.mockInput.pressKey("s", { ctrl: true });
    await settle();
    expect(submitted).toEqual([]);
    expect(view.captureCharFrame()).toContain(`Post comment to #${number}?`);
    expect(statusLine()).toBe("enter confirm · esc back");
    expect(view.captureCharFrame().split("enter confirm · esc back")).toHaveLength(2);
    setConfig((current) => ({ ...current, showStatusBarHints: false }));
    await settle();
    expect(view.captureCharFrame()).not.toContain("enter confirm · esc back");
    expect(statusLine()).not.toContain("enter confirm");
    await view.mockMouse.click(0, 0); await view.flush();
    await settle();
    expect(view.captureCharFrame()).not.toContain(
      `Post comment to #${number}?`,
    );
    expect(action().body).toBe("**Draft** qrs?h1l,\n");
    await view.mockInput.typeText("still focused");
    await settle();
    expect(action().body).toContain("still focused");
    setAction((current) => ({ ...current, body: "**Draft** qrs?h1l,\n" }));
    setConfig((current) => ({ ...current, showStatusBarHints: true }));
    view.mockInput.pressKey("s", { ctrl: true });
    await settle();
    await clickControl(view, "issue-action-confirm");
    view.mockInput.pressEnter();
    view.mockInput.pressKey("s", { ctrl: true });
    await settle();
    // Confirmation closes the composer while the mutation runs in the background.
    expect(view.renderer.root.findDescendantById("issue-action-submit")).toBeUndefined();
    expect(action().operation.status).toBe("loading");
    view.mockInput.pressKey("c");
    view.mockInput.pressKey("a");
    view.mockInput.pressKey("s", { ctrl: true });
    await settle();
    expect(view.renderer.root.findDescendantById("issue-action-submit")).toBeUndefined();
    expect(view.captureCharFrame()).not.toContain(`Post comment to #${number}?`);
    // Other navigation remains available without editing or resubmitting the draft.
    view.mockInput.pressKey(","); await settle();
    expect(view.captureCharFrame()).toContain("Settings");
    view.mockInput.pressEscape(); await settle();
    expect(view.captureCharFrame()).not.toContain("Settings");
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
    expect(statusLine()).toBe("enter open · ↑/↓ select · esc close");
    expect(view.captureCharFrame()).toContain("Mark as duplicate");
    await view.mockMouse.click(0, 0);
    await settle();
    expect(view.captureCharFrame()).not.toContain("Close issue…");
    view.mockInput.pressKey("a");
    await settle();
    expect(view.captureCharFrame()).not.toContain("Add comment");
    expect(view.captureCharFrame()).not.toContain("Open on GitHub");
    view.mockInput.pressEnter();
    await settle();
    expect(view.captureCharFrame()).toContain(`Close issue · #${number}`);
    expect(view.captureCharFrame()).not.toContain("Reopen issue");
    expect(statusLine()).toContain("enter select");
    expect(view.captureCharFrame()).not.toContain("Preview");
    view.mockInput.pressArrow("down"); await settle();
    expect(view.captureCharFrame()).toContain("› Not planned…");
    view.mockInput.pressEnter(); await settle();
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
    expect(statusLine()).toContain("Closing issue");
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

test("assignee suggestions filter locally, preserve selection, retry and save independently of comments", async () => {
  const [action, setAction] = createSignal<IssueActionState>({ body: "Comment draft", reason: "completed", operation: { status: "idle" } });
  const submitted: string[] = [];
  const [users, setUsers] = createSignal<ResourceState<Paginated<string>>>({ status: "ready", value: { items: ["john", "jane", "kate"], page: 1, hasMore: true } });
  let candidateCalls = 0;
  let finishSave: (() => void) | undefined;
  let fail = true;
  const view = await testRender(() => <App
    data={githubDataFixture} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: true }}
    issueDetail={{ number: issueDetailFixture.number,
      resource: { status: "ready", value: { ...issueDetailFixture, state: "closed", permissions: {
        comment: false, close: false, reopen: false, duplicate: false, assignees: true,
      } } }, comments: { status: "ready", value: { items: [], page: 1, hasMore: false } }, references: { status: "ready", value: [] } }}
    onLoadIssue={async () => {}}
    getIssueAction={() => action()}
    assignableUsers={users()}
    onLoadAssignableUsers={async () => {
      candidateCalls++;
      setUsers(candidateCalls === 1 ? { status: "error", phase: "pagination", message: "Candidates failed", value: users().value }
        : { status: "ready", value: { items: ["john", "jane", "kate", "zoe"], page: 2, hasMore: false } });
    }}
    onPrepareIssueAction={() => setAction((draft) => ({ ...draft, selectedAssignees: [...issueDetailFixture.assignees], operation: { status: "idle" } }))}
    onIssueDraftChange={(_number, draft) => setAction((current) => ({ ...current, ...draft }))}
    onSubmitIssueAction={async (_number, kind) => {
      submitted.push(kind);
      if (fail) {
        setAction((draft) => ({ ...draft, operation: { status: "error", message: "Save failed. GitHub did not confirm the requested assignees. Check GitHub before retrying." } }));
        throw new Error("Save failed");
      }
      setAction((draft) => ({ ...draft, operation: { status: "loading" } }));
      await new Promise<void>((resolve) => { finishSave = resolve; });
      return {};
    }}
  />, { width: 110, height: 34 });
  const settle = async () => { await view.flush(); await Bun.sleep(40); await view.flush(); };
  try {
    view.mockInput.pressKey("3"); view.mockInput.pressEnter(); await settle();
    expect(view.captureCharFrame()).toContain("a actions");
    view.mockInput.pressKey("a"); await settle();
    expect(view.captureCharFrame()).not.toContain("Edit issue…");
    expect(view.captureCharFrame()).not.toContain("Edit labels…");
    expect(view.captureCharFrame()).toContain("Edit assignees…");
    expect(view.captureCharFrame()).not.toContain("Reopen issue…");
    view.mockInput.pressEnter(); await settle();
    expect(view.captureCharFrame()).toMatch(/@max +✓ selected/);
    expect(view.captureCharFrame()).toMatch(/@jane +✓ selected/);
    await view.mockInput.typeText("@jo"); await settle();
    expect(view.captureCharFrame()).toContain("@john");
    expect(view.captureCharFrame()).not.toMatch(/@john +✓ selected/);
    expect(view.captureCharFrame()).not.toContain("@kate");
    expect(view.captureCharFrame()).not.toContain("@max");
    expect(action().selectedAssignees).toEqual(["max", "jane"]);
    await clickControl(view, "assignee-row-0"); await settle();
    expect(action().selectedAssignees).toEqual(["max", "jane", "john"]);
    expect(view.captureCharFrame()).toContain("@jo");
    view.mockInput.pressEnter(); await settle();
    expect(action().selectedAssignees).toEqual(["max", "jane"]);
    await view.mockInput.typeText("zz"); await settle();
    expect(view.captureCharFrame()).toContain("No matching users");
    view.mockInput.pressEnter(); await settle();
    expect(view.captureCharFrame()).toContain("Candidates failed");
    expect(view.captureCharFrame()).toContain("Retry loading users");
    view.mockInput.pressEnter(); await settle();
    expect(candidateCalls).toBe(2);
    expect(view.captureCharFrame()).not.toContain("Retry loading users");
    await clickControl(view, "assignees-save"); await settle();
    expect(submitted).toEqual([]);
    await clickControl(view, "assignees-confirm"); await settle();
    expect(view.captureCharFrame()).toContain("Save failed");
    expect(view.captureCharFrame().replace(/\s+/g, " ")).toContain("GitHub before retrying.");
    expect(action().selectedAssignees).toEqual(["max", "jane"]);
    expect(action().body).toBe("Comment draft");
    expect(view.renderer.root.findDescendantById("assignees-save")).toBeUndefined();
    fail = false;
    // Failed background saves report a toast; retry by reopening the picker.
    view.mockInput.pressKey("a"); await settle();
    view.mockInput.pressEnter(); await settle();
    expect(action().selectedAssignees).toEqual(["max", "jane"]);
    await clickControl(view, "assignees-save"); await settle();
    await clickControl(view, "assignees-confirm"); await settle();
    // Saving feedback lives in the status bar, which delays its loading indicator.
    await Bun.sleep(220); await view.flush();
    expect(view.captureCharFrame()).toContain("Saving assignees");
    expect(view.renderer.root.findDescendantById("assignees-save")).toBeUndefined();
    expect(view.renderer.root.findDescendantById("assignees-confirm")).toBeUndefined();
    expect(view.captureCharFrame()).not.toContain(`Assignees · #${issueDetailFixture.number}`);
    expect(action().operation.status).toBe("loading");
    view.mockInput.pressKey("a");
    view.mockInput.pressKey("s", { ctrl: true });
    view.mockInput.pressEnter(); await settle();
    expect(view.renderer.root.findDescendantById("assignees-save")).toBeUndefined();
    view.mockInput.pressKey(","); await settle();
    expect(view.captureCharFrame()).toContain("Settings");
    view.mockInput.pressEscape(); await settle();
    expect(view.captureCharFrame()).not.toContain("Settings");
    expect(submitted).toEqual(["assignees", "assignees"]);
    expect(action().selectedAssignees).toEqual(["max", "jane"]);
    expect(action().body).toBe("Comment draft");
    expect(finishSave).toBeDefined();
    finishSave!(); await settle();
    expect(view.captureCharFrame()).toContain("Issue assignees updated");
    expect(action().body).toBe("Comment draft");
  } finally { view.renderer.destroy(); }
});

test("issue shortcuts and hints hide actions without viewer permission", async () => {
  const [permissions, setPermissions] = createSignal({ comment: true, close: false, reopen: false, duplicate: false, assignees: false });
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
    setPermissions({ comment: false, close: true, reopen: false, duplicate: false, assignees: false });
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

test("assignee picker limits selection and requires confirmation before saving", async () => {
  const logins = Array.from({ length: 11 }, (_, index) => `user${index}`);
  const [action, setAction] = createSignal<IssueActionState>({ body: "", reason: "completed", operation: { status: "idle" }, selectedAssignees: logins.slice(0, 10) });
  let saves = 0;
  let closes = 0;
  const view = await testRender(() => <IssueAssigneesPicker number={42} state={action()}
    users={{ status: "ready", value: { items: logins, page: 1, hasMore: false } }}
    onChange={(selectedAssignees) => setAction((current) => ({ ...current, selectedAssignees }))}
    onLoadMore={() => {}} onSubmit={() => { saves++; }} onHintChange={() => {}} onClose={() => { closes++; }} />,
    { width: 80, height: 30 });
  const settle = async () => { await view.flush(); await Bun.sleep(40); await view.flush(); };
  try {
    await view.mockInput.typeText("user10"); await settle();
    const row = view.renderer.root.findDescendantById("assignee-row-0")!;
    await view.mockMouse.pressDown(row.x, row.y);
    view.mockInput.pressBackspace(); await settle();
    await view.mockMouse.release(row.x, row.y); await settle();
    expect(action().selectedAssignees).toHaveLength(10);
    await view.mockInput.typeText("0"); await settle();
    view.mockInput.pressEnter(); await settle();
    expect(action().selectedAssignees).toHaveLength(10);
    expect(view.captureCharFrame()).toContain("Maximum 10 assignees.");
    setAction((current) => ({ ...current, selectedAssignees: logins.slice(1) }));
    view.mockInput.pressEnter(); await settle();
    expect(action().selectedAssignees).toHaveLength(9);
    expect(view.captureCharFrame()).not.toContain("Maximum 10 assignees.");
    view.mockInput.pressEnter(); await settle();
    expect(action().selectedAssignees).toHaveLength(10);
    view.mockInput.pressKey("s", { ctrl: true }); await settle();
    expect(saves).toBe(0);
    expect(view.captureCharFrame()).toContain("Save assignees for #42?");
    view.mockInput.pressKey("s", { ctrl: true }); await settle();
    expect(saves).toBe(0);
    view.mockInput.pressEscape(); await settle();
    expect(closes).toBe(0);
    expect(action().selectedAssignees).toHaveLength(10);
    expect(view.renderer.root.findDescendantById("assignees-confirm")).toBeUndefined();
    await clickControl(view, "assignees-save");
    expect(saves).toBe(0);
    await clickControl(view, "assignees-confirm");
    expect(saves).toBe(1);
    expect(action().selectedAssignees).toHaveLength(10);
    setAction((current) => ({ ...current, selectedAssignees: [] }));
    view.mockInput.pressKey("s", { ctrl: true }); await settle();
    expect(view.captureCharFrame()).toContain("Remove all assignees from #42?");
    expect(saves).toBe(1);
    view.mockInput.pressEnter(); await settle();
    expect(saves).toBe(2);
  } finally { view.renderer.destroy(); }
});

test("PR actions route close, reopen and assignees to PR drafts and hide state actions when merged", async () => {
  const summary = githubDataFixture.pulls.open.value!.items[0]!;
  const [state, setState] = createSignal<"open" | "closed">("open");
  const [merged, setMerged] = createSignal(false);
  const [action, setAction] = createSignal<IssueActionState>({ body: "", reason: "completed", operation: { status: "idle" } });
  const submitted: string[] = [];
  const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: true }}
    pullDetail={{ number: summary.number, resource: { status: "ready", value: {
      ...summary, state: state(), merged: merged(), url: `${githubDataFixture.repo.url}/pull/${summary.number}`, body: "PR body",
      updatedAt: summary.createdAt, baseBranch: "main", headBranch: "feature", additions: 0, deletions: 0,
      changedFiles: 0, commitCount: 0, commentCount: 0, labels: [], assignees: ["jane"], reviewers: [], mergeable: null,
      permissions: { comment: true, close: true, reopen: true, assignees: true },
    } }, comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
      commits: { status: "ready", value: [] }, context: { status: "ready", value: pullContextFixture }, references: { status: "ready", value: [] } }}
    getIssueAction={(_number, parent) => parent === "pull" ? action() : { body: "Issue draft", reason: "completed", operation: { status: "idle" } }}
    assignableUsers={{ status: "ready", value: { items: ["jane", "john"], page: 1, hasMore: false } }}
    onPrepareIssueAction={(_number, kind, parent) => {
      expect(parent).toBe("pull");
      if (kind === "assignees") setAction((draft) => ({ ...draft, selectedAssignees: ["jane"] }));
    }}
    onIssueDraftChange={(_number, draft, parent) => { expect(parent).toBe("pull"); setAction((current) => ({ ...current, ...draft })); }}
    onSubmitIssueAction={async (number, kind, parent) => {
      expect(number).toBe(summary.number); expect(parent).toBe("pull"); submitted.push(kind);
      if (kind === "close") setState("closed");
      if (kind === "reopen") setState("open");
      return {};
    }} />, { width: 110, height: 34 });
  const settle = async () => { await Bun.sleep(40); await view.flush(); };
  try {
    view.mockInput.pressKey("4"); view.mockInput.pressEnter(); await settle();
    expect(view.captureCharFrame()).toContain("a actions");
    for (const verb of ["Close", "Reopen"]) {
      view.mockInput.pressKey("a"); await settle();
      expect(view.captureCharFrame()).toContain(`${verb} PR…`);
      expect(view.captureCharFrame()).not.toContain("Mark as duplicate");
      await clickControl(view, `issue-menu-${verb === "Close" ? "close" : "reopen"}`); await settle();
      expect(view.captureCharFrame()).not.toContain("Not planned");
      await clickControl(view, "issue-action-submit");
      expect(view.captureCharFrame()).toContain(`${verb} PR #${summary.number}?`);
      await clickControl(view, "issue-action-confirm"); await settle();
    }
    setMerged(true); setState("closed");
    await view.mockMouse.click(1, 10, 2); await settle();
    expect(view.captureCharFrame()).toContain("Actions…");
    await clickControl(view, "context-menu-row-4"); await settle();
    expect(view.captureCharFrame()).not.toContain("Reopen PR");
    expect(view.captureCharFrame()).toContain("Edit assignees…");
    view.mockInput.pressEnter(); await settle();
    expect(view.captureCharFrame()).toMatch(/@jane +✓ selected/);
    await clickControl(view, "assignee-row-1");
    expect(action().selectedAssignees).toEqual(["jane", "john"]);
    await clickControl(view, "assignees-save"); await settle();
    expect(submitted).toEqual(["close", "reopen"]);
    await clickControl(view, "assignees-confirm"); await settle();
    expect(submitted).toEqual(["close", "reopen", "assignees"]);
  } finally { view.renderer.destroy(); }
});

test("comment editor preserves its cursor indicator and draft across expansion and preview", async () => {
  const [state, setState] = createSignal<IssueActionState>({
    body: "First line\nSecond line", reason: "completed", operation: { status: "idle" },
  });
  const [hint, setHint] = createSignal("");
  const [showHints, setShowHints] = createSignal(true);
  const [expanded, setExpanded] = createSignal(false);
  const [open, setOpen] = createSignal(true);
  const view = await testRender(() => <KeybindingsProvider><box width="100%" height="100%" flexDirection="column">
    <box flexGrow={1} />
    <StatusBar hint={showHints() ? hint() : undefined} zIndex={showHints() ? 350 : 0} />
    <Show when={open()}><IssueActionDialog number={42} kind="comment" state={state()} showScrollbar={false} showStatusBarHints={showHints()}
      expanded={expanded()} onExpandedChange={setExpanded}
      repositoryUrl="https://github.com/owner/repo"
      onBodyChange={(body) => setState((value) => ({ ...value, body }))}
      onReasonChange={() => {}} onDuplicateTargetChange={() => {}} onSubmit={() => {}}
      onDiscard={() => {}} onClose={() => setOpen(false)} onHintChange={(value) => setHint(value ?? "")} /></Show>
  </box></KeybindingsProvider>, { width: 100, height: 32 });
  try {
    await view.flush();
    const writer = view.renderer.root.findDescendantById("issue-comment-writer") as TextareaRenderable;
    expect(hint()).toStartWith("ctrl+s submit · ctrl+p preview · ctrl+o expand");
    expect(hint()).not.toContain("ctrl+l");
    expect(view.renderer.root.findDescendantById("issue-comment-lines")).toBeUndefined();
    expect(view.renderer.root.findDescendantById("issue-action-line-numbers")).toBeUndefined();
    expect(view.renderer.root.findDescendantById("issue-action-preview")).toBeUndefined();
    const compactWidth = writer.width;
    view.mockInput.pressKey("o", { ctrl: true });
    await view.flush();
    expect(writer.width).toBeGreaterThan(compactWidth);
    const expandedFrame = view.captureCharFrame();
    expect(expandedFrame.split("ctrl+s submit")).toHaveLength(2);
    expect(expandedFrame.split("\n")[31]).toContain("ctrl+p preview");
    const hintedHeight = writer.height;
    setShowHints(false);
    await view.flush();
    expect(writer.height).toBe(hintedHeight + 1);
    expect(view.captureCharFrame()).not.toContain("ctrl+s submit");
    setShowHints(true);
    await view.flush();
    expect(writer.height).toBe(hintedHeight);
    expect(view.renderer.root.findDescendantById("issue-comment-writer")).toBe(writer);
    view.mockInput.pressKey("o", { ctrl: true });
    await view.flush();
    expect(writer.width).toBe(compactWidth);
    writer.setCursor(1, 3);
    await view.flush();
    expect(view.captureCharFrame()).toContain("Ln 2, Col 4");
    expect(writer.logicalCursor).toMatchObject({ row: 1, col: 3 });
    expect(writer.plainText).toBe(state().body);
    view.mockInput.pressKey("p", { ctrl: true });
    await view.flush();
    expect(view.renderer.root.findDescendantById("issue-comment-preview-scroll")).toBeDefined();
    expect(hint()).toContain("ctrl+p write");
    expect(hint()).not.toContain("ctrl+l");
    view.mockInput.pressKey("p", { ctrl: true });
    await view.flush();
    expect(writer.plainText).toBe(state().body);
    expect(view.captureCharFrame()).toContain("Ln 2, Col 4");
    const beforeExternalEdit = writer.plainText;
    replaceEditorText(writer, "# Edited externally");
    await view.flush();
    expect(state().body).toBe("# Edited externally");
    view.mockInput.pressKey("z", { ctrl: true });
    await view.flush();
    expect(state().body).toBe(beforeExternalEdit);

    view.mockInput.pressKey("o", { ctrl: true });
    await view.flush();
    const expandedWidth = writer.width;
    expect(hint()).toContain("esc keep draft");
    view.mockInput.pressEscape();
    await Bun.sleep(40);
    await view.flush();
    expect(view.renderer.root.findDescendantById("issue-comment-writer")).toBeUndefined();
    expect(expanded()).toBe(true);
    setOpen(true);
    await view.flush();
    const reopened = view.renderer.root.findDescendantById("issue-comment-writer") as TextareaRenderable;
    expect(reopened.width).toBe(expandedWidth);
    expect(reopened.plainText).toBe(beforeExternalEdit);
    view.mockInput.pressKey("o", { ctrl: true });
    await view.flush();
    expect(reopened.width).toBe(compactWidth);
    view.mockInput.pressEscape();
    await Bun.sleep(40);
    await view.flush();
    setOpen(true);
    await view.flush();
    expect((view.renderer.root.findDescendantById("issue-comment-writer") as TextareaRenderable).width).toBe(compactWidth);
  } finally {
    view.renderer.destroy();
  }
});


test("closing issues selects a reason before editing and preserves it through clear and confirmation", async () => {
  const [state, setState] = createSignal<IssueActionState>({ body: "", reason: "completed", operation: { status: "idle" } });
  const [open, setOpen] = createSignal(true);
  const [parent, setParent] = createSignal<"issue" | "pull">("issue");
  const submissions: Array<{ body: string; reason: string }> = [];
  let reasonChanges = 0;
  let closes = 0;
  const view = await testRender(() => <KeybindingsProvider><Show when={open()}>
    <IssueActionDialog number={42} kind="close" parent={parent()} state={state()} showScrollbar={false}
      repositoryUrl="https://github.com/owner/repo"
      onBodyChange={body => setState(current => ({ ...current, body }))}
      onReasonChange={reason => { reasonChanges++; setState(current => ({ ...current, reason })); }}
      onDuplicateTargetChange={() => {}}
      onSubmit={() => { submissions.push({ body: state().body, reason: state().reason }); setOpen(false); }}
      onDiscard={() => setState({ body: "", reason: "completed", operation: { status: "idle" } })}
      onClose={() => { closes++; setOpen(false); }} onHintChange={() => {}} />
  </Show></KeybindingsProvider>, { width: 100, height: 32 });
  const escape = async () => { view.mockInput.pressEscape(); await Bun.sleep(40); await view.flush(); };
  try {
    await view.flush();
    expect(view.renderer.root.findDescendantById("issue-close-reason-menu")).toBeDefined();
    expect(view.renderer.root.findDescendantById("issue-comment-writer")).toBeUndefined();
    view.mockInput.pressEnter(); await view.flush();
    expect(submissions).toEqual([]);
    const editor = view.renderer.root.findDescendantById("issue-comment-writer") as TextareaRenderable;
    await view.mockInput.typeText("Closing explanation"); await view.flush();
    await escape();
    expect(closes).toBe(0);
    expect(state().body).toBe("Closing explanation");
    expect(view.renderer.root.findDescendantById("issue-close-reason-menu")).toBeDefined();
    view.mockInput.pressArrow("down"); view.mockInput.pressEnter(); await view.flush();
    expect(state().reason).toBe("not_planned");
    expect(view.captureCharFrame()).toContain("Close issue · #42 · Not planned");
    expect(view.renderer.root.findDescendantById("issue-comment-writer") === editor).toBe(true);
    expect(editor.plainText).toBe("Closing explanation");
    view.mockInput.pressKey("d", { ctrl: true }); await view.flush();
    expect(state().body).toBe("");
    expect(state().reason).toBe("not_planned");
    view.mockInput.pressKey("z", { ctrl: true }); await view.flush();
    expect(state().body).toBe("Closing explanation");
    expect(state().reason).toBe("not_planned");
    view.mockInput.pressKey(".", { ctrl: true }); await view.flush();
    expect(state().body).toBe("");
    expect(view.renderer.root.findDescendantById("issue-action-confirm")).toBeUndefined();
    view.mockInput.pressKey("s", { ctrl: true }); await view.flush();
    expect(submissions).toEqual([]);
    expect(view.captureCharFrame()).toContain("Close issue #42?");
    expect(view.captureCharFrame()).toContain("Reason: Not planned");
    view.mockInput.pressEnter(); await view.flush();
    expect(submissions).toEqual([{ body: "", reason: "not_planned" }]);

    // A posted comment must never be sent again or have its pending close reason changed.
    setState({ body: "", reason: "not_planned", retry: "close", operation: { status: "error", message: "Closing failed" } });
    setOpen(true); await view.flush();
    expect(view.renderer.root.findDescendantById("issue-close-reason-menu")).toBeUndefined();
    expect(view.captureCharFrame()).toContain("Comment posted.");
    expect(reasonChanges).toBe(2);
    await escape();
    expect(closes).toBe(1);
    expect(state().reason).toBe("not_planned");

    setParent("pull");
    setState({ body: "", reason: "completed", operation: { status: "idle" } });
    setOpen(true); await view.flush();
    expect(view.renderer.root.findDescendantById("issue-close-reason-menu")).toBeUndefined();
    expect(view.captureCharFrame()).toContain("Close PR · #42");
  } finally { view.renderer.destroy(); }
});
