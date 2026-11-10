import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { CliRenderEvents, RGBA, ScrollBoxRenderable, TextAttributes, type Renderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { App } from "../src/ui/app";
import { Header } from "../src/ui/components/header";
import { defaultConfig, type Config } from "../src/config";
import { appColors, resolveTheme } from "../src/theme";
import { issueIcons, nerdIcons, pullRequestIcons, repositoryIcons, workflowIcons } from "../src/ui/icons";
import type { CommitDetailState, RepositoryData, ResourceState } from "../src/repository-state";
import type { DetailTarget, InitialNavigation, NavigationState, Page } from "../src/navigation";
import { ThemeProvider, useTheme } from "../src/ui/theme";
import {
  commitDetailFixture,
  githubDataFixture,
  issueDetailFixture,
  pullContextFixture,
  repositoryOperationsFixture,
} from "./fixtures/github-data";
import { workflowJobFixture, workflowRunFixture } from "./fixtures/workflow-run";
import { clickControl } from "./fixtures/mouse";

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> =
  [];
afterEach(() => {
  for (const setup of active.splice(0))
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
});

function withDocumentResources(resources: Record<string, ResourceState<string>>) {
  return {
    ...githubDataFixture,
    documents: {
      status: "ready" as const,
      value: githubDataFixture.documents.value!.map((document) => ({
        ...document, resource: resources[document.path] ?? document.resource,
      })),
    },
  };
}

async function setup() {
  let quit = 0;
  let refresh = 0;
  let branch = "";
  const [canSwitchBranch, setCanSwitchBranch] = createSignal(true);
  const view = await testRender(
    () => (
      <App
        data={githubDataFixture}
        operations={repositoryOperationsFixture}
        onQuit={() => quit++}
        onRefresh={() => refresh++}
        canSwitchBranch={canSwitchBranch()}
        onBranchChange={(value) => (branch = value)}
      />
    ),
    { width: 120, height: 32 },
  );
  active.push(view);
  await view.flush();
  return {
    view,
    quit: () => quit,
    refresh: () => refresh,
    branch: () => branch,
    setCanSwitchBranch,
  };
}

describe("opengh TUI", () => {
  test.each(["issue", "pull"] as const)("details placement updates %s pages live without changing Overview", async (kind) => {
    const [config, setConfig] = createSignal<Config>({ ...defaultConfig });
    const comments = { status: "ready" as const, value: { items: [], page: 1, hasMore: false } };
    const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
      config={config()} initialNavigation={{ detail: { kind, number: issueDetailFixture.number } }}
      issueDetail={{ number: issueDetailFixture.number, resource: { status: "ready", value: issueDetailFixture }, comments,
        references: { status: "ready", value: [] } }}
      pullDetail={{ number: issueDetailFixture.number, resource: { status: "ready", value: { ...issueDetailFixture,
        merged: false, draft: false, baseBranch: "main", headBranch: "feature", additions: 1, deletions: 0,
        changedFiles: 1, commitCount: 0, reviewers: [], mergeable: true } }, comments,
        references: { status: "ready", value: [] }, commits: { status: "ready", value: [] },
        context: { status: "ready", value: pullContextFixture } }}
    />, { width: 120, height: 40 });
    active.push(view);
    await view.flush();
    const hasSidebar = () => view.captureCharFrame().split("\n").some(line => line.trimEnd().endsWith("Details"));
    expect(hasSidebar()).toBe(true);
    setConfig({ ...config(), detailsPlacement: "inline" });
    await view.flush();
    expect(hasSidebar()).toBe(false);
    const metadata = view.captureCharFrame().split("\n").find(line => line.includes("Labels"));
    expect(metadata).toContain("Assignees");
    setConfig({ ...config(), detailsPlacement: "auto" });
    await view.flush();
    expect(hasSidebar()).toBe(true);
    view.mockInput.pressKey("1");
    await view.flush();
    const aboutColumn = () => view.captureCharFrame().split("\n").find(line => line.includes("About"))?.indexOf("About");
    const column = aboutColumn();
    expect(column).toBeGreaterThan(60);
    setConfig({ ...config(), detailsPlacement: "inline" });
    await view.flush();
    expect(aboutColumn()).toBe(column);
  });

  test("standalone hides global navigation and expands without losing the requested detail", async () => {
    const failed = { status: "error" as const, phase: "load" as const, message: "Direct target unavailable" };
    const pages: Page[] = [];
    const scopes: string[] = [];
    let expanded = 0;
    let quit = 0;
    const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
      standalone initialNavigation={{ detail: { kind: "issue", number: 234 } }}
      onEnsureResources={(scope) => scopes.push(scope)}
      issueDetail={{ number: 234, resource: failed, comments: failed, references: failed }}
      onPageChange={(page) => pages.push(page)} onOpenFullApp={() => expanded++} onQuit={() => quit++}
    />, { width: 120, height: 32 });
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).toContain("Direct target unavailable");
    expect(view.captureCharFrame()).not.toContain("1 Overview");
    const hasMounted = (id: string, node: Renderable = view.renderer.root): boolean => node.id === id || node.getChildren().some((child) => hasMounted(id, child));
    expect(hasMounted("overview-document-scroll")).toBe(false);
    expect(scopes).toEqual(["detail"]);
    for (const key of ["1", "2", "4", "h", "l"]) view.mockInput.pressKey(key);
    await view.flush();
    expect(pages).toEqual(["issues"]);
    expect(view.captureCharFrame()).toContain("Direct target unavailable");

    view.mockInput.pressKey("o", { ctrl: true });
    await view.flush();
    expect(expanded).toBe(1);
    expect(scopes.at(-1)).toBe("full");
    expect(hasMounted("overview-document-scroll")).toBe(true);
    expect(view.captureCharFrame()).toContain("1 Overview");
    expect(view.captureCharFrame()).toContain("Direct target unavailable");
    view.mockInput.pressKey("2");
    await view.flush();
    expect(pages.at(-1)).toBe("commits");
    view.mockInput.pressKey("q");
    await view.flush();
    expect(quit).toBe(1);
  });

  test("standalone Back ensures the parent list rather than the rest of the app", async () => {
    const scopes: string[] = [];
    const failed = { status: "error" as const, phase: "load" as const, message: "Direct target unavailable" };
    const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
      standalone initialNavigation={{ detail: { kind: "issue", number: 234 } }}
      issueDetail={{ number: 234, resource: failed, comments: failed, references: failed }}
      onEnsureResources={(scope) => scopes.push(scope)}
    />, { width: 120, height: 32 });
    active.push(view);
    await view.flush();
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    expect(scopes).toEqual(["detail", "issues"]);
    expect(view.captureCharFrame()).not.toContain("Direct target unavailable");
    expect(view.captureCharFrame()).not.toContain("1 Overview");
  });

  test.each<[DetailTarget, Page, string]>([
    [{ kind: "issue", number: 9999 }, "issues", "ScrollBox loses focus"],
    [{ kind: "pull", number: 9999 }, "pulls", "retain focused child"],
    [{ kind: "commit", sha: "abcd" }, "commits", "cad92f4"],
    [{ kind: "run", id: 9999 }, "actions", "Publish v0.4.5"],
  ])("opens startup detail %j once, independent of lists and saved Actions preference", async (target, parent, listText) => {
    const [data, setData] = createSignal<RepositoryData>({
      ...githubDataFixture,
      issues: { open: { status: "loading", phase: "load" }, closed: { status: "loading", phase: "load" } },
      pulls: { open: { status: "loading", phase: "load" }, closed: { status: "loading", phase: "load" } },
      runs: { status: "loading", phase: "load" },
    });
    const failed = { status: "error" as const, phase: "load" as const, message: "Direct target unavailable" };
    const loaded: DetailTarget[] = [];
    const pages: Page[] = [];
    const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture}
      initialPage="actions" initialNavigation={{ detail: target }} onPageChange={(page) => pages.push(page)}
      commitDetail={{ sha: "abcd", resource: failed }} onLoadCommit={async (sha) => { loaded.push({ kind: "commit", sha }); }}
      issueDetail={{ number: 9999, resource: failed, comments: failed, references: failed }}
      onLoadIssue={async (number) => { loaded.push({ kind: "issue", number }); }}
      pullDetail={{ number: 9999, resource: failed, comments: failed, references: failed, commits: failed, context: failed }}
      onLoadPull={async (number) => { loaded.push({ kind: "pull", number }); }}
      runDetail={{ id: 9999, resource: failed, jobs: failed }} onLoadRun={async (id) => { loaded.push({ kind: "run", id }); }}
    />, { width: 120, height: 32 });
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).toContain("Direct target unavailable");
    expect(loaded).toEqual([target]);
    expect(pages).toEqual([parent]);

    setData(structuredClone(githubDataFixture));
    await view.flush();
    expect(view.captureCharFrame()).toContain("Direct target unavailable");
    expect(loaded).toEqual([target]);
    expect(pages).toEqual([parent]);

    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    expect(view.captureCharFrame()).toContain(listText);
    expect(loaded).toEqual([target]);
  });

  test("explicit Actions page remains accessible even without runs", async () => {
    const data: RepositoryData = { ...githubDataFixture, runs: { status: "ready", value: { items: [], page: 1, hasMore: false } } };
    const pages: Page[] = [];
    const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture}
      initialPage="issues" initialNavigation={{ page: "actions" }} onPageChange={(page) => pages.push(page)} />,
    { width: 120, height: 32 });
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).toContain("No workflow runs");
    expect(pages).toEqual(["actions"]);
  });

  test("page actions remain keyboard-only without toolbar clutter or duplicate pending operations", async () => {
    const [detail, setDetail] = createSignal<CommitDetailState>();
    const copies: string[] = [];
    const opened: Array<string | number | undefined> = [];
    let loads = 0;
    let more = 0;
    let refreshes = 0;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
      config={{ ...defaultConfig, compactHeader: true, showStatusBarHints: false }} commitDetail={detail()}
      onCopyToClipboard={async (value) => { copies.push(value); return true; }}
      onOpenInBrowser={async (target) => { opened.push(target); }}
      onRefresh={() => { refreshes++; }}
      onLoadCommit={async (sha) => { loads++; setDetail({ sha, resource: { status: "ready", value: {
        ...commitDetailFixture, sha, files: { ...commitDetailFixture.files, hasMore: true },
      } } }); }}
      onLoadMoreCommitFiles={async () => {
        if (detail()?.resource.status === "loading") return; // Match the session in-flight guard.
        more++;
        setDetail((current) => ({ ...current!, resource: { status: "loading", phase: "pagination", value: current!.resource.value } }));
        await pending;
        setDetail((current) => ({ ...current!, resource: { status: "ready", value: commitDetailFixture } }));
      }}
    />, { width: 36, height: 28 });
    active.push(view);
    await view.flush();
    view.mockInput.pressKey("2");
    view.mockInput.pressKey("j");
    await view.flush();
    const sha = githubDataFixture.commits.value!.items[1]!.sha;
    expect(view.renderer.root.findDescendantById("page-actions")).toBeUndefined();
    view.mockInput.pressKey("y");
    await view.flush();
    expect(copies).toEqual([sha]);
    view.mockInput.pressKey("o");
    await view.flush();
    expect(opened).toEqual([sha]);
    view.mockInput.pressEnter();
    await view.flush();
    view.mockInput.pressEnter();
    await view.flush();
    view.mockInput.pressEnter();
    await view.flush();
    view.mockInput.pressKey("r");
    await view.flush();
    expect(more).toBe(1);
    expect(loads).toBe(1);
    finish();
    await view.flush();
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    view.mockInput.pressKey("r");
    await view.flush();
    expect(refreshes).toBe(1);
    view.mockInput.pressKey(",");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Settings");
    await view.mockMouse.click(0, 0); await view.flush();
    expect(view.captureCharFrame()).toContain("Settings");
    view.resize(120, 40);
    await view.flush();
    await view.mockMouse.click(0, 0); await view.flush();
    expect(view.captureCharFrame()).not.toContain("Settings");
    expect(view.captureCharFrame()).toContain("4 of 4 commits");
    view.mockInput.pressKey("y");
    await view.flush();
    expect(copies).toEqual([sha, sha]);
    expect(refreshes).toBe(1);
  });

  test("mouse navigation selects documents and work filters, retains documents, and uses compact arrows", async () => {
    const [config, setConfig] = createSignal({ ...defaultConfig, compactHeader: false });
    const documents = githubDataFixture.documents.value!.map((document, index) => ({ ...document,
      resource: index === 0 ? { status: "ready" as const, value: Array.from({ length: 60 }, (_, i) => `Paragraph ${i}`).join("\n\n") } : document.resource,
    }));
    const view = await testRender(() => <App config={config()} operations={repositoryOperationsFixture}
      data={{ ...githubDataFixture, documents: { status: "ready", value: documents } }} />,
      { width: 140, height: 32 });
    active.push(view);
    const click = async (label: string, offset = 0) => {
      const lines = view.captureCharFrame().split("\n");
      const row = lines.findIndex((line) => line.includes(label));
      expect(row).toBeGreaterThan(-1);
      await view.mockMouse.click(lines[row]!.indexOf(label), row + offset);
      await view.flush();
    };
    await view.flush();
    view.mockInput.pressKey("G");
    await view.flush();
    const scroll = view.renderer.root.findDescendantById("overview-document-scroll") as ScrollBoxRenderable;
    expect(scroll.scrollTop).toBeGreaterThan(0);
    view.mockInput.pressTab();
    await view.flush();
    expect(scroll.scrollTop).toBe(0);
    await click("README");
    expect(view.captureCharFrame()).toContain("Paragraph 0");
    await click("Contributing");
    expect(view.captureCharFrame()).toContain("Thanks for helping");
    view.mockInput.pressKey("?");
    await view.flush();
    await click("2 Commits"); // The backdrop consumes this click instead of switching pages.
    expect(view.captureCharFrame()).toContain("Thanks for helping");
    await click("2 Commits");
    expect(view.captureCharFrame()).toContain("4 of 4 commits");
    await click("3 Issues");
    await click("Closed (");
    const closedIssue = githubDataFixture.issues.closed.value!.items[0]!.title;
    expect(view.captureCharFrame()).toContain(closedIssue);
    await click("Closed (");
    expect(view.captureCharFrame()).toContain(closedIssue);
    await click("Open (");
    expect(view.captureCharFrame()).toContain(githubDataFixture.issues.open.value!.items[0]!.title);
    await click("4 Pull requests");
    await click("Closed (");
    expect(view.captureCharFrame()).toContain(githubDataFixture.pulls.closed.value!.items[0]!.title);
    await click("1 Overview");
    expect(view.captureCharFrame()).toContain("Thanks for helping");
    setConfig((current) => ({ ...current, compactHeader: true }));
    view.resize(44, 32);
    await view.flush();
    const docRow = view.captureCharFrame().split("\n").findIndex((line) => line.includes("Contributing"));
    let line = view.captureCharFrame().split("\n")[docRow]!;
    await view.mockMouse.click(line.indexOf("‹"), docRow);
    await view.flush();
    expect(view.captureCharFrame()).toContain("Be respectful and welcoming.");
    line = view.captureCharFrame().split("\n")[docRow]!;
    await view.mockMouse.click(line.indexOf("›"), docRow);
    await view.flush();
    expect(view.captureCharFrame()).toContain("Thanks for helping");
  });

  test("clicks open the correct commit, issue, pull request, and run while preserving selection and popup shielding", async () => {
    const opened: Array<{ kind: string; id: string | number }> = [];
    const view = await testRender(() => (
      <App data={githubDataFixture} operations={repositoryOperationsFixture}
        onLoadCommit={async (id) => { opened.push({ kind: "commit", id }); }}
        onLoadIssue={async (id) => { opened.push({ kind: "issue", id }); }}
        onLoadPull={async (id) => { opened.push({ kind: "pull", id }); }}
        onLoadRun={async (id) => { opened.push({ kind: "run", id }); }}
      />
    ), { width: 120, height: 32 });
    active.push(view);
    const commit = githubDataFixture.commits.value!.items[1]!;
    const issue = githubDataFixture.issues.open.value!.items[1]!;
    const pull = githubDataFixture.pulls.open.value!.items[1]!;
    const run = githubDataFixture.runs.value!.items[1]!;
    for (const entry of [
      { key: "2", kind: "commit", id: commit.sha, label: commit.message, detail: "commit-detail-scroll" },
      { key: "3", kind: "issue", id: issue.number, label: issue.title, detail: "issue-detail-scroll" },
      { key: "4", kind: "pull", id: pull.number, label: pull.title, detail: "pull-detail-scroll" },
      { key: "5", kind: "run", id: run.id, label: run.title, detail: "run-detail-scroll" },
    ]) {
      view.mockInput.pressKey(entry.key);
      await view.flush();
      const lines = view.captureCharFrame().split("\n");
      const row = lines.findIndex((line) => line.includes(entry.label));
      expect(row).toBeGreaterThan(-1);
      const x = lines[row]!.indexOf(entry.label) + 2;
      const before = opened.length;
      view.mockInput.pressKey("?");
      await view.flush();
      await view.mockMouse.click(x, row); // Dismissing help must not also open the row beneath it.
      await view.flush();
      expect(opened).toHaveLength(before);
      expect(view.captureCharFrame()).not.toContain("Help");

      await view.mockMouse.pressDown(x, row);
      await view.flush();
      expect(opened).toHaveLength(before);
      await view.mockMouse.release(x, row);
      await view.flush();
      expect(opened).toHaveLength(before + 1);
      expect(opened.at(-1)).toEqual({ kind: entry.kind, id: entry.id });
      expect(view.renderer.root.findDescendantById(entry.detail)).toBeDefined();
      view.mockInput.pressEscape();
      await Bun.sleep(30);
      await view.flush();
      expect(view.captureCharFrame().split("\n").find((line) => line.includes(entry.label))).toContain("▌");
    }
  });

  test("regular pages wheel-scroll under the pointer without stealing keyboard focus or scrolling behind help", async () => {
    const body = Array.from({ length: 60 }, (_, index) => `Paragraph ${index}`).join("\n\n");
    const pull = githubDataFixture.pulls.open.value!.items[0]!;
    const view = await testRender(() => (
      <App
        config={{ ...defaultConfig, showScrollbars: false }}
        data={{ ...githubDataFixture, documents: { status: "ready", value: [{
          ...githubDataFixture.documents.value![0]!, resource: { status: "ready", value: body },
        }] } }}
        operations={repositoryOperationsFixture}
        commitDetail={{ sha: commitDetailFixture.sha, resource: { status: "ready", value: {
          ...commitDetailFixture, fullMessage: `Commit title\n\n${body}`,
        } } }}
        issueDetail={{ number: issueDetailFixture.number,
          resource: { status: "ready", value: { ...issueDetailFixture, body } },
          comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
          references: { status: "ready", value: [] },
        }}
        pullDetail={{ number: pull.number, resource: { status: "ready", value: {
          ...pull, body, url: `${githubDataFixture.repo.url}/pull/${pull.number}`,
          updatedAt: issueDetailFixture.updatedAt, baseBranch: "main", headBranch: "feature",
          additions: 1, deletions: 0, changedFiles: 1, commitCount: 0, commentCount: 0,
          labels: [], assignees: [], reviewers: [], mergeable: true,
        } }, comments: { status: "ready", value: { items: [], page: 1, hasMore: false } },
          references: { status: "ready", value: [] }, commits: { status: "ready", value: [] },
          context: { status: "ready", value: pullContextFixture },
        }}
        runDetail={{ id: workflowRunFixture.id, resource: { status: "ready", value: workflowRunFixture },
          jobs: { status: "ready", value: { items: Array.from({ length: 30 }, (_, id) => ({ ...workflowJobFixture, id })), page: 1, hasMore: false } },
        }}
      />
    ), { width: 120, height: 28 });
    active.push(view);
    await view.flush();

    for (const [key, id] of [
      ["1", "overview-document-scroll"], ["2", "commit-detail-scroll"],
      ["3", "issue-detail-scroll"], ["4", "pull-detail-scroll"], ["5", "run-detail-scroll"],
    ] as const) {
      view.mockInput.pressKey(key);
      await view.flush();
      if (key !== "1") { view.mockInput.pressEnter(); await view.flush(); }
      const scroll = view.renderer.root.findDescendantById(id) as ScrollBoxRenderable;
      expect(scroll).toBeInstanceOf(ScrollBoxRenderable);
      const x = scroll.viewport.x + 2;
      const y = scroll.viewport.y + 2;
      const before = scroll.scrollTop;
      await view.mockMouse.scroll(x, y, "down");
      await view.flush();
      expect(scroll.scrollTop).toBeGreaterThan(before);
      await view.mockMouse.click(x, y);
      expect(view.renderer.currentFocusedRenderable).toBeNull();
      const afterWheel = scroll.scrollTop;
      view.mockInput.pressArrow("down");
      await view.flush();
      expect(scroll.scrollTop).toBe(afterWheel + 1);
      await view.mockMouse.scroll(x, y, "up");
      await view.flush();
      expect(scroll.scrollTop).toBeLessThan(afterWheel + 1);

      view.mockInput.pressKey("?");
      await view.flush();
      const covered = scroll.scrollTop;
      await view.mockMouse.scroll(x, y, "down");
      await view.flush();
      expect(scroll.scrollTop).toBe(covered);
      await view.mockMouse.click(0, 0);
      await view.flush();
    }
  });

  test("shows loaded versus total commits for the selected branch without changing the tab", async () => {
    const commits = Array.from({ length: 30 }, (_, index) => ({
      ...githubDataFixture.commits.value!.items[0]!, sha: `commit-${index}`,
    }));
    const [data, setData] = createSignal<RepositoryData>({
      ...githubDataFixture,
      commits: { status: "ready", value: { items: commits, page: 1, hasMore: true } },
      commitCount: { status: "loading", phase: "load" },
    });
    const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture} />,
      { width: 120, height: 32 });
    active.push(view);
    view.mockInput.pressKey("2");
    await view.flush();
    expect(view.captureCharFrame()).toContain("30 of … commits");
    setData((current) => ({ ...current, commitCount: { status: "ready", value: 1284 } }));
    await view.flush();
    expect(view.captureCharFrame()).toContain("30 of 1,284 commits");
    const header = view.captureCharFrame().split("\n").slice(0, 5).join("\n");
    expect(header).toContain("2 Commits");
    expect(header).not.toContain("2 Commits (");
    setData((current) => ({ ...current, commits: { status: "ready", value: {
      items: [...commits, ...commits.map((commit) => ({ ...commit, sha: `${commit.sha}-next` }))], page: 2, hasMore: true,
    } } }));
    await view.flush();
    expect(view.captureCharFrame()).toContain("60 of 1,284 commits");
    setData((current) => ({ ...current, currentBranch: "feature/next",
      commits: { status: "ready", value: { items: [commits[0]!], page: 1, hasMore: false } },
      commitCount: { status: "ready", value: 1 },
    }));
    await view.flush();
    expect(view.captureCharFrame()).toContain("1 of 1 commit");
    expect(view.captureCharFrame()).toContain("feature/next");
    setData((current) => ({ ...current, commits: { status: "ready", value: { items: [], page: 1, hasMore: false } },
      commitCount: { status: "ready", value: 0 },
    }));
    await view.flush();
    expect(view.captureCharFrame()).toContain("0 of 0 commits");
    setData((current) => ({ ...current, commitCount: { status: "error", phase: "load", message: "Offline" } }));
    await view.flush();
    expect(view.captureCharFrame()).toContain("0 commits");
    expect(view.captureCharFrame()).not.toContain("of 0 commits");
    setData((current) => ({ ...current, commitCount: { status: "error", phase: "load", message: "Offline", value: 0 } }));
    await view.flush();
    expect(view.captureCharFrame()).toContain("0 of 0 commits");
  });

  test("tab shortcuts switch between numbers and icons without disabling navigation", async () => {
    const [config, setConfig] = createSignal({ ...defaultConfig });
    const view = await testRender(() => <App data={githubDataFixture} operations={repositoryOperationsFixture}
      config={config()} />, { width: 180, height: 32 });
    active.push(view);
    const header = () => view.captureCharFrame().split("\n")[3]!;
    await view.flush();
    expect(header()).toContain("1 Overview");
    expect(header()).not.toContain(nerdIcons.navigation.overview);
    setConfig((current) => ({ ...current, showTabShortcuts: false }));
    await view.flush();
    expect(header()).toContain(`${nerdIcons.navigation.overview} Overview`);
    expect(header()).not.toContain("1 Overview");
    view.mockInput.pressKey("3");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Open (61)");
    setConfig((current) => ({ ...current, iconStyle: "unicode" }));
    await view.flush();
    expect(header()).toContain("≡ Overview");
    setConfig((current) => ({ ...current, iconStyle: "none" }));
    await view.flush();
    expect(header()).toContain("Overview");
    expect(header()).not.toContain("≡");
    expect(header()).not.toContain("1 Overview");
    setConfig((current) => ({ ...current, iconStyle: "nerd" }));
    view.resize(76, 32);
    await view.flush();
    expect(header()).not.toContain(nerdIcons.navigation.overview);
  });

  test("shows stable open totals in work tabs across loading, state filters, and compact mode", async () => {
    const [data, setData] = createSignal<RepositoryData>({
      ...githubDataFixture, workCounts: { status: "loading", phase: "load" },
      issues: { ...githubDataFixture.issues, closed: { status: "loading", phase: "load" } },
    });
    const [config, setConfig] = createSignal({ ...defaultConfig });
    const view = await testRender(() => (
      <App data={data} operations={repositoryOperationsFixture} config={config()} />
    ), { width: 140, height: 32 });
    active.push(view);
    const header = () => view.captureCharFrame().split("\n").slice(0, config().compactHeader ? 1 : 5).join("\n");
    await view.flush();
    expect(header()).toContain("Issues (.  )");
    expect(header()).toContain("Pull requests (.  )");
    view.mockInput.pressKey("3");
    await view.flush();
    const frame = view.captureCharFrame();
    expect(frame).toContain("Open (.  )");
    const closed = frame.match(/Closed \(([. ]{3})\)/)?.[0];
    expect(closed).toBeDefined();
    const first = header();
    const pullsColumn = first.indexOf("Pull requests");
    await Bun.sleep(420);
    await view.flush();
    expect(header()).not.toBe(first);
    expect(header().indexOf("Pull requests")).toBe(pullsColumn);
    expect(view.captureCharFrame()).toContain("Open (.. )");
    setConfig({ ...defaultConfig, reducedMotion: true });
    await view.flush();
    expect(header()).toContain("Issues (...)");
    expect(view.captureCharFrame()).toContain("Open (...)");
    expect(view.captureCharFrame()).toContain("Closed (...)");
    setData((current) => ({ ...current, workCounts: { status: "ready", value: { issues: 2450, pulls: 1200 } } }));
    await view.flush();
    expect(header()).toContain("Issues (2450)");
    expect(header()).toContain("Pull requests (1200)");
    view.mockInput.pressKey("3");
    await view.flush();
    view.mockInput.pressKey("tab");
    await view.flush();
    expect(header()).toContain("Issues (2450)");
    expect(header()).toContain("Pull requests (1200)");
    setConfig({ ...defaultConfig, compactHeader: true });
    setData((current) => ({ ...current, workCounts: {
      status: "loading", phase: "load", value: { issues: 2450, pulls: 1200 },
    } }));
    await view.flush();
    expect(header()).toContain("Issues (2450)");
    expect(header()).toContain("Pull requests (1200)");
    setData((current) => ({ ...current, workCounts: { status: "ready", value: { issues: 0, pulls: 0 } } }));
    await view.flush();
    expect(header()).toContain("Issues (0)");
    expect(header()).toContain("Pull requests (0)");
    setData((current) => ({ ...current, workCounts: { status: "error", phase: "load", message: "Offline" } }));
    await view.flush();
    expect(header()).toContain("Issues (—)");
    expect(header()).toContain("Pull requests (—)");
  });

  test("shortcut hints can be disabled on every page without disabling shortcuts or loading feedback", async () => {
    const [config, setConfig] = createSignal({ ...defaultConfig });
    const [operations, setOperations] = createSignal(repositoryOperationsFixture);
    let copied = "";
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          operations={operations}
          config={config()}
          onConfigChange={async (next) => { setConfig(next); }}
          commitDetail={{ sha: commitDetailFixture.sha, resource: { status: "ready", value: commitDetailFixture } }}
        />
      ),
      { width: 120, height: 32 },
    );
    active.push(view);
    view.renderer.copyToClipboardOSC52 = (value) => { copied = value; return true; };
    const statusLine = () => view.captureCharFrame().split("\n")[31]!.trim();
    await view.flush();
    expect(statusLine()).toBe("");
    setConfig({ ...defaultConfig, showStatusBarHints: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" });
    await view.flush();
    expect(statusLine()).toBe("tab documents · b sidebar · r refresh · o GitHub · y copy URL · / search · ? help");

    view.mockInput.pressKey("?");
    await view.flush();
    expect(statusLine()).toBe("esc close");
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    view.mockInput.pressKey(",");
    await view.flush();
    expect(statusLine()).toBe("enter open · ↑/↓ select · ←/→ change · / search · esc close");
    for (let i = 0; i < 9; i++) view.mockInput.pressArrow("down");
    view.mockInput.pressEnter();
    await view.flush();
    expect(view.captureCharFrame()).toContain("Shortcut hints");
    expect(config().showStatusBarHints).toBe(false);
    expect(statusLine()).toBe("");
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    for (const key of ["1", "2", "3", "4", "5"]) {
      view.mockInput.pressKey(key);
      await view.flush();
      expect(statusLine()).toBe("");
    }

    view.mockInput.pressKey("2");
    view.mockInput.pressEnter();
    view.mockInput.pressKey("y");
    await view.flush();
    expect(copied).toBe(commitDetailFixture.sha);
    expect(statusLine()).toBe("");
    setOperations((value) => ({ ...value, refresh: { status: "loading" } }));
    await Bun.sleep(210);
    await view.flush();
    expect(statusLine()).toContain("Refreshing");

    setOperations(repositoryOperationsFixture);
    setConfig({ ...defaultConfig, showStatusBarHints: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" });
    await view.flush();
    expect(statusLine()).toBe("esc back · D diff · r refresh · o GitHub · y copy SHA · / search · ? help");
  });

  test("About sidebar links open the parent repository internally and description URLs externally", async () => {
    const parentRepository = "upstream/terminal";
    const parentUrl = new URL(`/${parentRepository}`, githubDataFixture.repo.url).href;
    const externalUrl = "https://example.com/docs/";
    const locations: Array<{ repository: string; initial: InitialNavigation; origin: NavigationState; entry?: NavigationState }> = [];
    const external: string[] = [];
    const view = await testRender(() => <App
      data={{ ...githubDataFixture, repo: { ...githubDataFixture.repo,
        parentRepository, description: `Terminal toolkit ${externalUrl}`,
      } }}
      config={defaultConfig}
      operations={repositoryOperationsFixture}
      onOpenLocation={(repository, initial, origin, entry) => { locations.push({ repository, initial, origin, entry }); }}
      onOpenUrl={async (url) => { external.push(url); }}
    />, { width: 120, height: 32 });
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).toContain("Forked from");
    expect(view.captureCharFrame()).toContain(parentRepository);
    expect(view.captureCharFrame()).toContain("example.com/docs");
    const clickLink = async (href: string) => {
      for (let y = 0; y < view.renderer.height; y++) {
        for (let x = 0; x < view.renderer.width; x++) {
          if (view.renderer.getLinkAt(x, y) !== href) continue;
          await view.mockMouse.click(x, y);
          await view.flush();
          return;
        }
      }
      throw new Error(`No painted hyperlink for ${href}`);
    };
    await clickLink(parentUrl);
    expect(locations).toEqual([{
      repository: parentRepository, initial: { page: "overview" },
      origin: expect.objectContaining({ page: "overview" }), entry: undefined,
    }]);
    expect(external).toEqual([]);
    await clickLink(externalUrl);
    expect(external).toEqual([externalUrl]);
    expect(locations).toHaveLength(1);
  });

  test("renders repository metadata while the README loads", async () => {
    const data = withDocumentResources({ "README.md": { status: "loading", phase: "load" } });
    const view = await testRender(
      () => (
        <App
          data={data}
          operations={repositoryOperationsFixture}
          onQuit={() => {}}
        />
      ),
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();
    const initialFrame = view.captureCharFrame();
    expect(initialFrame).toContain("anomalyco/opentui");
    expect(initialFrame).toContain("README");
    expect(initialFrame).toContain("About");
    expect(initialFrame).not.toContain("Loading");

    await Bun.sleep(210);
    await view.flush();
    const loadingFrame = view.captureCharFrame();
    expect(loadingFrame).toContain("Loading");
    expect(loadingFrame.match(/Loading/g)).toHaveLength(1);
  });

  test("renders an empty README as loaded content", async () => {
    const data = withDocumentResources({ "README.md": { status: "ready", value: "" } });
    const view = await testRender(
      () => <App data={data} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 120, height: 32 },
    );
    active.push(view);

    await Bun.sleep(210);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("Loading");
  });

  test("tab highlight follows h/l after a complex README finishes loading", async () => {
    const content = Array.from({ length: 24 }, (_, index) => `## Section ${index}\n\n> A quoted paragraph.\n>\n> - Quoted list item\n\n- [x] Completed item\n- [ ] Pending item\n\n\`\`\`text\nExample ${index}\n\`\`\`\n\n<a name="section-${index}"></a>\n`).join("\n");
    const [data, setData] = createSignal<RepositoryData>({ ...githubDataFixture,
      documents: { status: "loading", phase: "load" }, workCounts: { status: "loading", phase: "load" },
    });
    const view = await testRender(() => <ThemeProvider name={defaultConfig.theme}><App data={data}
      operations={repositoryOperationsFixture} initialPage="commits" config={{ ...defaultConfig, compactHeader: true }} />
    </ThemeProvider>, { width: 170, height: 44 });
    active.push(view);
    await view.flush();
    setData((current) => ({ ...current, documents: { status: "ready", value: [{
      ...githubDataFixture.documents.value![0]!, resource: { status: "ready", value: content },
    }] } }));
    await view.flush();
    setData((current) => ({ ...current, workCounts: githubDataFixture.workCounts }));
    await view.flush();
    for (const [key, label] of [["l", "3 Issues"], ["l", "4 Pull requests"], ["h", "3 Issues"], ["h", "2 Commits"]]) {
      view.mockInput.pressKey(key!);
      await view.flush();
      const highlighted = view.captureSpans().lines[0]!.spans.filter((span) => (span.attributes & TextAttributes.BOLD) && span.text.trim());
      expect(highlighted.some((span) => span.text.startsWith(label!))).toBe(true);
    }
  });

  test("switches screens and moves the selection", async () => {
    const { view } = await setup();
    view.mockInput.pressKey("2");
    await view.flush();
    expect(view.captureCharFrame()).toContain("4 commits");
    expect(view.captureCharFrame()).toContain("7ca91d2");
    expect(view.captureCharFrame()).not.toContain("7ca91d200000");

    view.mockInput.pressKey("3");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Open (61)");
    expect(view.captureCharFrame()).toContain("Closed (1)");
    expect(view.captureCharFrame()).toContain("#412 opened");
    expect(view.captureCharFrame()).toContain("ScrollBox loses focus");

    view.mockInput.pressKey("j");
    await view.flush();
    expect(view.captureCharFrame()).toContain(
      "Add support for accessible color themes",
    );

    view.mockInput.pressKey("4");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Pull requests");
    expect(view.captureCharFrame()).toContain("#421 opened");

    view.mockInput.pressKey("5");
    await view.flush();
    expect(view.captureCharFrame()).toContain("4 workflow runs");
  });

  test("PR rows distinguish purple merges from red unmerged closures", async () => {
    const data = structuredClone(githubDataFixture);
    const merged = data.pulls.closed.value!.items[0]!;
    data.pulls.open.value!.items.push({ ...data.pulls.open.value!.items[0]!, number: 404, title: "Draft PR", draft: true });
    data.pulls.closed.value!.items = [
      { ...merged, title: "Merged PR", merged: true },
      { ...merged, number: 403, title: "Closed PR", merged: false },
    ];
    const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture} config={{ ...defaultConfig, hideDocumentsTab: false, compactHeader: false, iconStyle: "nerd" }} />,
      { width: 100, height: 26 });
    active.push(view);
    const colors = appColors(resolveTheme(defaultConfig.theme));
    const iconColor = (icon: string) => view.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes(icon))?.fg;
    await view.flush();
    view.mockInput.pressKey("4");
    await view.flush();
    expect(iconColor(pullRequestIcons.open)).toEqual(RGBA.fromHex(colors.openState));
    expect(view.captureCharFrame()).toContain("Draft PR");
    expect(iconColor(pullRequestIcons.draft)).toEqual(RGBA.fromHex(colors.muted));
    view.mockInput.pressTab();
    for (const width of [100, 32]) {
      view.resize(width, 26);
      await view.flush();
      expect(view.captureCharFrame()).toContain("Merged PR");
      expect(view.captureCharFrame()).toContain("Closed PR");
      expect(iconColor(pullRequestIcons.merged)).toEqual(RGBA.fromHex(colors.purple));
      expect(iconColor(pullRequestIcons.closed)).toEqual(RGBA.fromHex(colors.red));
    }
    view.mockInput.pressKey("3");
    view.mockInput.pressTab();
    await view.flush();
    expect(iconColor(issueIcons.closed)).toEqual(RGBA.fromHex(colors.closedState));
  });

  test("workflow icons distinguish failures, neutral conclusions, queued runs, and active progress", async () => {
    const colors = appColors(resolveTheme(defaultConfig.theme));
    const completed = ["success", "failure", "timed_out", "cancelled", "skipped", "neutral", "action_required"].map((conclusion, index) => ({
      id: index, name: "CI", title: `${conclusion} run`, status: "completed", conclusion, createdAt: "2026-04-14T09:00:00Z",
    }));
    const pending = ["in_progress", "queued", "waiting"].map((status, index) => ({
      id: 20 + index, name: "CI", title: `${status} run`, status, conclusion: "", createdAt: "2026-04-14T09:00:00Z",
    }));
    const [config, setConfig] = createSignal({ ...defaultConfig });
    const view = await testRender(() => <App data={{ ...githubDataFixture,
      runs: { status: "ready", value: { items: [...completed, ...pending], page: 1, hasMore: false } },
    }} operations={repositoryOperationsFixture} config={config()} />, { width: 120, height: 44 });
    active.push(view);
    await view.flush();
    view.mockInput.pressKey("5");
    await view.flush();
    const icon = (title: string, glyph: string) => view.captureSpans().lines
      .find((line) => line.spans.some((span) => span.text.includes(title)))?.spans.find((span) => span.text.includes(glyph));
    for (const [title, glyph, color] of [
      ["success run", workflowIcons.success, colors.green],
      ["failure run", workflowIcons.failure, colors.red],
      ["timed_out run", workflowIcons.failure, colors.red],
      ["cancelled run", workflowIcons.cancelled, colors.muted],
      ["skipped run", workflowIcons.skipped, colors.muted],
      ["neutral run", workflowIcons.neutral, colors.muted],
      ["action_required run", workflowIcons.attention, colors.yellow],
      ["queued run", workflowIcons.clock, colors.muted],
      ["waiting run", workflowIcons.clock, colors.yellow],
    ]) expect(icon(title!, glyph!)?.fg).toEqual(RGBA.fromHex(color!));
    const dots = () => view.captureSpans().lines
      .find((line) => line.spans.some((span) => span.text.includes("in_progress run")))?.spans
      .find((span) => /\./.test(span.text));
    expect(dots()?.fg).toEqual(RGBA.fromHex(colors.yellow));
    const first = dots()?.text;
    for (let attempt = 0; attempt < 12 && dots()?.text === first; attempt++) {
      await Bun.sleep(40);
      await view.flush();
    }
    expect(dots()?.text).not.toBe(first);
    setConfig((current) => ({ ...current, reducedMotion: true }));
    await view.flush();
    expect(dots()?.text.trim()).toBe("...");
    await Bun.sleep(170);
    await view.flush();
    expect(dots()?.text.trim()).toBe("...");
    expect(view.captureCharFrame()).toContain("in progress");
  });

  test("keeps work tabs visible while loading and when empty, and hides unavailable Actions", async () => {
    const empty = { status: "ready" as const, value: { items: [], page: 1, hasMore: false } };
    const [data, setData] = createSignal<RepositoryData>({
      ...githubDataFixture, runs: { status: "loading", phase: "load" },
    });
    const [operations, setOperations] = createSignal(repositoryOperationsFixture);
    const view = await testRender(() => (
      <App data={data} operations={operations} />
    ), { width: 120, height: 32 });
    active.push(view);
    const header = () => view.captureCharFrame().split("\n").slice(0, 5).join("\n");
    await view.flush();
    expect(header()).toContain("Overview");
    expect(header()).toContain("Commits");
    expect(header()).not.toContain("Actions");
    expect(header()).toContain("3 Issues (61)");
    expect(header()).toContain("4 Pull requests (24)");
    view.mockInput.pressKey("3");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Open (");

    setData((current) => ({ ...current, runs: empty }));
    await view.flush();
    expect(header()).toContain("3 Issues");
    expect(header()).toContain("4 Pull requests");
    expect(header()).not.toContain("Actions");
    view.mockInput.pressKey("3");
    await view.flush();
    setOperations((current) => ({ ...current, refresh: { status: "loading" } }));
    setData((current) => ({ ...current, issues: { open: empty, closed: empty }, pulls: { open: empty, closed: empty } }));
    await view.flush();
    expect(header()).toContain("3 Issues");
    expect(header()).toContain("4 Pull requests");
    setOperations(repositoryOperationsFixture);
    await view.flush();
    expect(header()).toContain("3 Issues (61)");
    expect(header()).toContain("4 Pull requests (24)");
    expect(header()).not.toContain("Actions");
    expect(view.captureCharFrame()).toContain("No open issues");

    setData((current) => ({ ...current, runs: { status: "error", phase: "load", message: "Actions unavailable" } }));
    await view.flush();
    expect(header()).toContain("5 Actions");
    view.mockInput.pressKey("5");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Actions unavailable");
    setData((current) => ({ ...current, runs: empty,
      issues: { open: empty, closed: githubDataFixture.issues.closed },
      pulls: { open: empty, closed: githubDataFixture.pulls.closed },
    }));
    await view.flush();
    expect(header()).toContain("Issues");
    expect(header()).toContain("Pull requests");
    expect(view.captureCharFrame()).toContain("README");
    setData((current) => ({ ...current,
      issues: { open: { status: "ready", value: { items: [], page: 1, hasMore: true } }, closed: empty },
      pulls: { open: empty, closed: empty },
    }));
    await view.flush();
    expect(header()).toContain("Issues"); // A partial page is not proof that a section is empty.
  });

  test("loads more commits and workflow runs near list ends", async () => {
    const initial = structuredClone(githubDataFixture);
    if (!initial.commits.value || !initial.runs.value)
      throw new Error("Expected loaded fixtures");
    initial.commits.value.hasMore = true;
    initial.commitCount = { status: "ready", value: 5 };
    initial.runs.value.hasMore = true;
    const [data, setData] = createSignal(initial);
    let commitLoads = 0;
    let runLoads = 0;
    const view = await testRender(
      () => (
        <App
          data={data}
          operations={repositoryOperationsFixture}
          onLoadMoreCommits={async () => {
            commitLoads++;
            setData((value) => ({
              ...value,
              commits: {
                status: "ready",
                value: {
                  items: [
                    ...value.commits.value!.items,
                    {
                      sha: "next0010000000000000000000000000000000000",
                      message: "next commit page",
                      author: "octocat",
                      date: "2026-04-01T00:00:00Z",
                    },
                  ],
                  page: 2,
                  hasMore: false,
                },
              },
            }));
          }}
          onLoadMoreRuns={async () => {
            runLoads++;
            setData((value) => ({
              ...value,
              runs: {
                status: "ready",
                value: {
                  items: [
                    ...value.runs.value!.items,
                    {
                      id: 9790,
                      name: "CI",
                      title: "next workflow page",
                      status: "completed",
                      conclusion: "success",
                      createdAt: "2026-04-01T00:00:00Z",
                    },
                  ],
                  page: 2,
                  hasMore: false,
                },
              },
            }));
          }}
        />
      ),
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressKey("2");
    view.mockInput.pressKey("j");
    await view.flush();
    expect(commitLoads).toBe(1);
    expect(view.captureCharFrame()).toContain("5 of 5 commits");

    view.mockInput.pressKey("5");
    view.mockInput.pressKey("j");
    await view.flush();
    expect(runLoads).toBe(1);
    expect(view.captureCharFrame()).toContain("5 workflow runs");
  });

  test("keeps the selected row visible when the status bar changes", async () => {
    const data = structuredClone(githubDataFixture);
    data.commits.value!.items = Array.from({ length: 16 }, (_, index) => ({
      sha: `${index.toString(16).padStart(7, "0")}${"a".repeat(33)}`,
      message: `commit row ${index}`,
      author: "octocat",
      date: "2026-04-01T00:00:00Z",
    }));
    const [operations, setOperations] = createSignal(
      structuredClone(repositoryOperationsFixture),
    );
    const view = await testRender(
      () => <App data={data} operations={operations} onQuit={() => {}} />,
      { width: 100, height: 20 },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressKey("2");
    await view.flush();
    for (let index = 0; index < 12; index++) {
      view.mockInput.pressKey("j");
      await view.flush();
    }
    const before = view.captureCharFrame();
    const selectedRow = before
      .split("\n")
      .findIndex((row) => row.includes("commit row 12"));
    expect(selectedRow).toBeGreaterThan(-1);

    setOperations((value) => ({ ...value, refresh: { status: "loading" } }));
    await Bun.sleep(210);
    await view.flush();
    const frame = view.captureCharFrame();
    const retainedRow = frame.split("\n").findIndex((row) => row.includes("commit row 12"));
    expect(retainedRow).toBeGreaterThanOrEqual(0);
    expect(frame.split("\n")[retainedRow]).toContain("▌");
    expect(retainedRow + 1).toBeLessThan(frame.split("\n").findIndex((row) => row.includes("Refreshing")));
    expect(frame).toContain("Refreshing");
  });

  test("keeps one stable list while moving through paginated updates", async () => {
    const data = structuredClone(githubDataFixture)
    data.issues.open.value!.items = Array.from({ length: 12 }, (_, index) => ({
      number: 1000 + index,
      state: "open" as const,
      title: `issue row ${index}`,
      author: "octocat",
      createdAt: "2026-04-01T00:00:00Z",
    }))
    data.issues.open.value!.hasMore = true
    const [current, setCurrent] = createSignal(data)
    let loads = 0
    const view = await testRender(() => (
      <App
        data={current}
        operations={repositoryOperationsFixture}
        onLoadMoreIssues={async () => {
          loads++
          setCurrent((value) => {
            const existing = value.issues.open.value!
            const start = existing.items.length
            return {
              ...value,
              issues: {
                ...value.issues,
                open: {
                  status: "ready",
                  value: {
                    items: [...existing.items, ...Array.from({ length: 8 }, (_, index) => ({
                      number: 1000 + start + index,
                      state: "open" as const,
                      title: `issue row ${start + index}`,
                      author: "octocat",
                      createdAt: "2026-04-01T00:00:00Z",
                    }))],
                    page: existing.page + 1,
                    hasMore: loads < 2,
                  },
                },
              },
            }
          })
        }}
      />
    ), { width: 100, height: 20 })
    active.push(view)
    await view.flush()
    view.mockInput.pressKey("3")
    await view.flush()

    for (let index = 0; index < 24; index++) {
      view.mockInput.pressKey("j")
      await view.flush()
    }

    const frame = view.captureCharFrame()
    expect(loads).toBe(2)
    expect(frame.split("\n").filter((row) => row.includes("Open (")).length).toBe(1)
    expect(frame.split("▌").length - 1).toBe(1)
    expect(frame).toContain("issue row 24")
  })

  test("shows only repository documents that exist", async () => {
    const data = {
      ...githubDataFixture,
      documents: { status: "ready" as const, value: githubDataFixture.documents.value!.filter((document) => document.path !== "SECURITY.md").map((document) => document.path === "README.md"
        ? { ...document, resource: { status: "ready" as const, value: Array.from({ length: 80 }, (_, index) => `Document line ${index}\n`).join("\n") } }
        : document) },
    };
    const view = await testRender(
      () => <App data={data} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();

    const frame = view.captureCharFrame();
    expect(frame).toContain("README");
    expect(frame).toContain("Code of conduct");
    expect(frame).toContain("Contributing");
    expect(frame).not.toContain("Security");
    expect(frame).toContain("MIT license");
    const scroll = view.renderer.root.findDescendantById("overview-document-scroll") as ScrollBoxRenderable;
    scroll.scrollTo(12);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("Contributing");
    view.mockInput.pressTab();
    await view.flush();
    expect(scroll.scrollTop).toBe(0);
    expect(view.captureCharFrame()).toContain("Contributing");
  });

  test("uses a plain README heading when no other documents exist", async () => {
    const data = {
      ...githubDataFixture,
      documents: { status: "ready" as const, value: githubDataFixture.documents.value!.filter((document) => document.path === "README.md") },
    };
    const view = await testRender(
      () => <App data={data} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 76, height: 24 },
    );
    active.push(view);
    await view.flush();

    const frame = view.captureCharFrame();
    expect(frame).toContain("README");
    expect(frame).not.toContain("Contributing");
    expect(frame).not.toContain("Security");
    expect(frame).not.toContain("‹ README ›");
  });

  test("hides document tabs while allowing cycling in both directions", async () => {
    const data = withDocumentResources({
      "CONTRIBUTING.md": {
        status: "error", phase: "load", message: "Contributing unavailable",
        value: githubDataFixture.documents.value!.find((document) => document.path === "CONTRIBUTING.md")!.resource.value,
      },
      "LICENSE": {
        status: "error", phase: "load", message: "License unavailable",
        value: githubDataFixture.documents.value!.find((document) => document.path === "LICENSE")!.resource.value,
      },
    });
    let retry = "";
    const view = await testRender(
      () => (
        <App
          data={data}
          config={{ ...defaultConfig, hideDocumentsTab: true }}
          operations={repositoryOperationsFixture}
          onRetryResource={(resource) => (retry = resource.kind === "document" ? resource.id : resource.kind)}
        />
      ),
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("README");
    expect(view.captureCharFrame()).not.toContain("Code of conduct");

    view.mockInput.pressTab();
    await view.flush();
    // Wait for asynchronous Markdown parsing, including a cold parser worker.
    for (let attempt = 0; attempt < 10 && !view.captureCharFrame().includes("Be respectful and welcoming."); attempt++) {
      await Bun.sleep(20);
      await view.flush();
    }
    expect(view.captureCharFrame()).toContain("Be respectful and welcoming.");
    view.mockInput.pressTab();
    view.mockInput.pressKey("r");
    await view.flush();
    expect(retry).toBe("anomalyco/opentui:CONTRIBUTING.md");

    retry = "";
    for (let i = 0; i < 4; i++) view.mockInput.pressTab({ shift: true });
    view.mockInput.pressKey("r");
    await view.flush();
    expect(retry).toBe("anomalyco/opentui:LICENSE");
  });

  test("continues through PR-only issue pages without defaulting to closed issues", async () => {
    const initial = structuredClone(githubDataFixture)
    // Filtering a full API page of pull requests leaves no issues, but more pages remain.
    initial.issues.open = { status: "ready", value: { items: [], page: 1, hasMore: true } }
    const [data, setData] = createSignal(initial)
    let loads = 0
    const view = await testRender(() => (
      <App
        data={data}
        operations={repositoryOperationsFixture}
        onLoadMoreIssues={async (state) => {
          expect(state).toBe("open")
          loads++
          const previous = data().issues.open.value!
          setData((current) => ({
            ...current,
            issues: { ...current.issues, open: { status: "loading", phase: "pagination", value: previous } },
          }))
          await Promise.resolve()
          setData((current) => ({
            ...current,
            issues: {
              ...current.issues,
              open: {
                status: "ready",
                value: {
                  items: loads === 1 ? [] : githubDataFixture.issues.open.value!.items,
                  page: previous.page + 1,
                  hasMore: loads === 1,
                },
              },
            },
          }))
        }}
      />
    ), { width: 120, height: 32 })
    active.push(view)
    await view.flush()
    expect(loads).toBe(0)

    view.mockInput.pressKey("3")
    await view.flush()
    expect(loads).toBe(2)
    expect(data().issues.open.value?.page).toBe(3)
    expect(view.captureCharFrame()).toContain("ScrollBox loses focus after terminal resize")
    expect(view.captureCharFrame()).not.toContain("Fix terminal redraw after returning from background")
  })

  test("defaults to closed work when open is empty and closed has items", async () => {
    const data = {
      ...githubDataFixture,
      issues: {
        open: { status: "ready" as const, value: { items: [], page: 1, hasMore: false } },
        closed: githubDataFixture.issues.closed,
      },
      pulls: {
        open: { status: "ready" as const, value: { items: [], page: 1, hasMore: false } },
        closed: githubDataFixture.pulls.closed,
      },
    };
    const view = await testRender(
      () => <App data={data} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressKey("3");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Fix terminal redraw after returning from background");
    expect(view.captureCharFrame()).not.toContain("No open issues");

    view.mockInput.pressTab();
    await view.flush();
    expect(view.captureCharFrame()).toContain("No open issues");

    view.mockInput.pressKey("4");
    await view.flush();
    expect(view.captureCharFrame()).toContain("fix: preserve selection after refresh");
  });

  test("shows branch counts only inside the branch picker", async () => {
    const data = structuredClone(githubDataFixture)
    data.branches.value = {
      items: ["main", ...Array.from({ length: 99 }, (_, index) => `branch-${index}`)],
      page: 1,
      hasMore: true,
    }
    const [current, setCurrent] = createSignal(data)
    const view = await testRender(
      () => <App data={current} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 120, height: 32 },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressKey("2")
    await view.flush()

    const commits = view.captureCharFrame()
    expect(commits).toContain(" main ▾")
    expect(commits).not.toContain("100+")
    expect(commits).not.toContain("100 loaded")

    view.mockInput.pressTab()
    await view.flush()
    expect(view.captureCharFrame()).toContain("Switch branch (100 loaded)")

    setCurrent((value) => ({
      ...value,
      branches: {
        status: "ready",
        value: {
          items: [...value.branches.value!.items, ...Array.from({ length: 100 }, (_, index) => `next-${index}`)],
          page: 2,
          hasMore: true,
        },
      },
    }))
    await view.flush()
    expect(view.captureCharFrame()).toContain("Switch branch (200 loaded)")

    setCurrent((value) => ({
      ...value,
      branches: { status: "ready", value: { ...value.branches.value!, hasMore: false } },
    }))
    await view.flush()
    expect(view.captureCharFrame()).toContain("Switch branch (200 branches)")
    await view.mockMouse.click(0, 0)
    await view.flush()
    setCurrent((value) => ({ ...value, branches: { status: "loading", phase: "load" } }))
    await view.flush()
    await clickControl(view, "branch-dropdown")
    expect(view.captureCharFrame()).not.toContain("Switch branch")
  })

  test("branch dropdown retries initial load failures while respecting busy and loading guards", async () => {
    const [current, setCurrent] = createSignal<RepositoryData>({ ...githubDataFixture,
      branches: { status: "error", phase: "load", message: "Branches offline" },
    });
    const [canSwitch, setCanSwitch] = createSignal(false);
    const retries: string[] = [];
    let branch = "";
    const view = await testRender(() => <App data={current} operations={repositoryOperationsFixture}
      canSwitchBranch={canSwitch()} onBranchChange={(value) => { branch = value; }}
      onRetryResource={(resource) => {
        retries.push(resource.kind);
        setCurrent((value) => ({ ...value, branches: { status: "loading", phase: "load" } }));
      }} />, { width: 100, height: 32 });
    active.push(view);
    await view.flush();
    view.mockInput.pressKey("2");
    await clickControl(view, "branch-dropdown");
    expect(retries).toEqual([]);
    setCanSwitch(true);
    await clickControl(view, "branch-dropdown");
    expect(retries).toEqual(["branches"]);
    expect(view.captureCharFrame()).not.toContain("Switch branch");
    await clickControl(view, "branch-dropdown");
    expect(retries).toEqual(["branches"]);
    setCurrent((value) => ({ ...value, branches: githubDataFixture.branches }));
    await clickControl(view, "branch-dropdown");
    expect(view.captureCharFrame()).toContain("Switch branch");
    await clickControl(view, "picker-row-1");
    expect(branch).toBe("next");
    expect(view.captureCharFrame()).not.toContain("Switch branch");
  });

  test("opens the branch picker and toggles work states", async () => {
    const { view, branch, setCanSwitchBranch } = await setup();
    view.mockInput.pressKey("2");
    await view.flush();
    setCanSwitchBranch(false);
    await clickControl(view, "branch-dropdown");
    expect(view.captureCharFrame()).not.toContain("Switch branch");
    setCanSwitchBranch(true);
    await clickControl(view, "branch-dropdown");
    await clickControl(view, "picker-row-0"); // The current branch closes without changing or reloading it.
    expect(branch()).toBe("");
    expect(view.captureCharFrame()).not.toContain("Switch branch");
    await clickControl(view, "branch-dropdown");
    const branchFrame = view.captureCharFrame();
    expect(branchFrame).toContain("Switch branch");
    const currentBranchRow = branchFrame.split("\n").find((row) => row.includes("✓ current"));
    expect(currentBranchRow).toContain("›");
    await view.mockInput.typeText("nxt");
    setCanSwitchBranch(false);
    await view.flush();
    await clickControl(view, "picker-row-0");
    expect(branch()).toBe("");
    expect(view.captureCharFrame()).toContain("Repository is busy");
    expect(view.captureCharFrame()).toContain("Switch branch");

    setCanSwitchBranch(true);
    await clickControl(view, "picker-row-0");
    expect(branch()).toBe("next");

    view.mockInput.pressKey("3");
    view.mockInput.pressTab();
    await view.flush();
    expect(view.captureCharFrame()).toContain(
      "Fix terminal redraw after returning from background",
    );

    view.mockInput.pressKey("4");
    view.mockInput.pressTab();
    await view.flush();
    expect(view.captureCharFrame()).toContain(
      "preserve selection after refresh",
    );
  });

  test("opens settings and applies saved changes immediately", async () => {
    const [config, setConfig] = createSignal<Config>({ showScrollbars: false, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" });
    let saves = 0;
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          operations={repositoryOperationsFixture}
          config={config()}
          onConfigChange={async (next) => {
            saves++;
            setConfig(next);
          }}
        />
      ),
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressKey(",");
    await view.flush();
    const settings = view.captureCharFrame();
    expect(settings).toContain("Settings");
    expect(settings).toContain("Theme");
    expect(settings).toContain("github");
    expect(settings).toContain("Color mode");
    expect(settings).toContain("Appearance");
    expect(settings).toContain("Layout");
    expect(settings).not.toContain("tab / ⇧tab");
    expect(settings).toContain("Scrollbars");
    expect(settings).toContain("Icon style");
    expect(settings).not.toContain("Interface color theme");
    view.resize(76, 32);
    await view.flush();
    expect(view.captureCharFrame()).toContain("Choose the color theme");
    view.resize(40, 12);
    for (let i = 0; i < 8; i++) view.mockInput.pressArrow("down");
    await view.flush();
    const description = view.renderer.root.findDescendantById("settings-description") as ScrollBoxRenderable;
    expect(description.scrollHeight).toBeGreaterThan(description.viewport.height);
    expect(description.scrollTop).toBe(0);
    expect(view.captureCharFrame()).not.toContain("terminal font.");
    view.mockInput.pressKey("\x1b[6~");
    await view.flush();
    expect(description.scrollTop).toBeGreaterThan(0);
    expect(view.captureCharFrame()).toContain("terminal font.");
    view.mockInput.pressKey("\x1b[5~");
    await view.flush();
    expect(description.scrollTop).toBe(0);
    view.mockInput.pressKey("\x1b[6~");
    await view.flush();
    view.mockInput.pressArrow("down");
    await view.flush();
    expect(description.scrollTop).toBe(0);
    for (let i = 0; i < 9; i++) view.mockInput.pressArrow("up");
    view.resize(120, 32);
    await view.flush();
    expect(settings).toContain("Compact header");
    expect(settings).toContain("Choose the color theme");
    expect(settings).not.toContain("change · enter toggle");

    view.mockInput.pressTab();
    await view.flush();
    expect(view.captureCharFrame()).toContain("Choose the color theme");
    for (let i = 0; i < 10; i++) view.mockInput.pressArrow("down");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Usability");
    expect(view.captureCharFrame()).toContain("Show vertical scrollbars");
    view.mockInput.pressArrow("right");
    await Bun.sleep(0);
    await view.flush();
    expect(saves).toBe(1);
    expect(config()).toEqual({ showScrollbars: true, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" });
    expect(view.captureCharFrame()).toContain("‹ on ›");

    for (let i = 0; i < 4; i++) view.mockInput.pressArrow("up");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Detail width");
    expect(view.captureCharFrame()).toContain("Centered limits reading width");
    view.mockInput.pressArrow("right");
    await view.flush();
    expect(config().detailLayout).toBe("wide");
    expect(view.captureCharFrame()).toContain("‹ wide ›");
    view.mockInput.pressArrow("left");
    await view.flush();
    expect(config().detailLayout).toBe("centered");
    expect(saves).toBe(3);

    view.mockInput.pressArrow("down");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Details placement");
    expect(view.captureCharFrame()).toContain("Auto uses a sidebar");
    view.mockInput.pressArrow("right");
    await view.flush();
    expect(config().detailsPlacement).toBe("inline");
    view.mockInput.pressArrow("left");
    await view.flush();
    expect(config().detailsPlacement).toBe("auto");

    view.mockInput.pressArrow("down");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Icon style");
    view.mockInput.pressArrow("right");
    await view.flush();
    expect(config().iconStyle).toBe("nerd");
    expect(view.captureCharFrame()).toContain("‹ Nerd Font ›");
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    expect(view.captureCharFrame()).toContain(repositoryIcons.star);

    view.mockInput.pressKey(",");
    for (let i = 0; i < 8; i++) view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("left");
    await view.flush();
    expect(config().iconStyle).toBe("none");
    expect(view.captureCharFrame()).toContain("‹ None ›");
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain(repositoryIcons.star);
    expect(view.captureCharFrame()).toContain("README");

    view.mockInput.pressKey(",");
    for (let i = 0; i < 8; i++) view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("left");
    await view.flush();
    expect(config().iconStyle).toBe("unicode");
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    expect(view.captureCharFrame()).not.toMatch(/[\uE000-\uF8FF]/);
    expect(view.captureCharFrame()).not.toContain("Show vertical scrollbars");

    view.resize(120, 24);
    view.mockInput.pressKey(",");
    await view.flush();
    for (let i = 0; i < 4; i++) view.mockInput.pressArrow("down");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Tab counts");
    expect(view.captureCharFrame()).toContain("Show open issue and pull request");
    view.mockInput.pressArrow("left");
    await view.flush();
    expect(config().showTabCounts).toBe(false);
    view.mockInput.pressArrow("down");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Document tabs");
    expect(view.captureCharFrame()).not.toContain("Hide documents tab");
    view.mockInput.pressEnter();
    await view.flush();
    expect(config().hideDocumentsTab).toBe(true);
    const documentSetting = view.captureCharFrame().split("\n").find((row) => row.includes("› Document tabs"));
    expect(documentSetting).toContain("‹ off ›");
    view.resize(50, 14);
    await view.flush();
    expect(view.captureCharFrame()).toContain("› Document tabs");
    for (let i = 0; i < 3; i++) view.mockInput.pressArrow("down");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Usability");
    expect(view.captureCharFrame()).toContain("› Icon style");
    for (let i = 0; i < 3; i++) view.mockInput.pressArrow("up");
    await view.flush();
    expect(view.captureCharFrame()).toContain("› Document tabs");
    for (let i = 0; i < 5; i++) view.mockInput.pressArrow("up");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Appearance");
    expect(view.captureCharFrame()).toContain("› Theme");
    view.resize(120, 24);
    await view.flush();
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    const header = view.captureCharFrame().split("\n").slice(0, 5).join("\n");
    expect(header).toContain("3 Issues");
    expect(header).toContain("4 Pull requests");
    expect(header).not.toContain("(61)");
    expect(header).not.toContain("(24)");
  });

  test("follows terminal appearance changes only in system color mode", async () => {
    const [mode, setMode] = createSignal<Config["colorMode"]>("system");
    let canvas = () => "";
    const Sample = () => {
      const theme = useTheme();
      canvas = () => theme.colors.canvas;
      return <text fg={theme.colors.text}>Theme sample</text>;
    };
    const view = await testRender(() => <ThemeProvider name="opengh" mode={mode()}><Sample /></ThemeProvider>, { width: 40, height: 10 });
    active.push(view);
    await view.flush();
    expect(canvas()).toBe(resolveTheme("opengh", "dark").background);
    view.renderer.emit(CliRenderEvents.THEME_MODE, "light");
    await view.flush();
    expect(canvas()).toBe(resolveTheme("opengh", "light").background);
    setMode("dark");
    await view.flush();
    expect(canvas()).toBe(resolveTheme("opengh", "dark").background);
    view.renderer.emit(CliRenderEvents.THEME_MODE, "light");
    await view.flush();
    expect(canvas()).toBe(resolveTheme("opengh", "dark").background);
    setMode("system");
    await view.flush();
    expect(canvas()).toBe(resolveTheme("opengh", "light").background);
  });

  test("previews and saves a theme from settings", async () => {
    const [config, setConfig] = createSignal<Config>({ showScrollbars: false, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" });
    let canvas = () => "";
    const ThemedApp = () => {
      const current = useTheme();
      canvas = () => current.colors.canvas;
      return (
        <App
          data={githubDataFixture}
          operations={repositoryOperationsFixture}
          config={config()}
          onConfigChange={async (next) => { setConfig(next) }}
        />
      );
    };
    const view = await testRender(
      () => (
        <ThemeProvider name={config().theme} mode={config().colorMode}>
          <ThemedApp />
        </ThemeProvider>
      ),
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();
    const githubText = JSON.stringify(view.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("anomalyco"))?.fg)

    view.mockInput.pressKey(",");
    await view.flush();
    view.mockInput.pressEnter();
    await view.flush();
    expect(view.captureCharFrame()).toContain("Themes");
    expect(view.captureCharFrame()).toContain("Search themes");
    await view.mockInput.typeText("nord");
    await view.flush();
    expect(view.captureCharFrame()).toContain("nord");
    expect(canvas()).toBe(resolveTheme("nord").background);
    const nordText = JSON.stringify(view.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("anomalyco"))?.fg)
    expect(nordText).not.toBe(githubText)

    view.mockInput.pressEnter();
    await Bun.sleep(0);
    await view.flush();
    expect(config().theme).toBe("nord");
    expect(canvas()).toBe(resolveTheme("nord").background);
    expect(view.captureCharFrame()).toContain("‹ nord ›");

    for (let i = 0; i < 11; i++) view.mockInput.pressArrow("down");
    view.mockInput.pressEnter();
    await view.flush();
    expect(config().reducedMotion).toBe(true);
    expect(view.captureCharFrame()).toContain("Replace animated loading dots");
    view.mockInput.pressArrow("left");
    await view.flush();
    expect(config().reducedMotion).toBe(false);
    for (let i = 0; i < 9; i++) view.mockInput.pressArrow("up");
    view.mockInput.pressEnter();
    await view.flush();
    expect(config().markdownStyle).toBe("minimal");
    expect(view.captureCharFrame()).toContain("‹ minimal ›");
    view.mockInput.pressArrow("left");
    await view.flush();
    expect(config().markdownStyle).toBe("rich");
    expect(view.captureCharFrame()).toContain("› Markdown style");
    view.mockInput.pressArrow("up");
    view.mockInput.pressArrow("right");
    await view.flush();
    expect(config().colorMode).toBe("dark");
    view.mockInput.pressEnter();
    await view.flush();
    expect(config().colorMode).toBe("light");
    expect(canvas()).toBe(resolveTheme("nord", "light").background);
    view.mockInput.pressArrow("up");
    view.mockInput.pressEnter();
    await view.flush();
    await view.mockInput.typeText("github");
    await view.flush();
    expect(canvas()).toBe(resolveTheme("github", "light").background);
    const searchText = view.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.trim() === "github");
    expect(searchText?.fg).toEqual(RGBA.fromHex(resolveTheme("github", "light").text));
    expect(view.captureCharFrame()).not.toContain("github-light");
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    expect(canvas()).toBe(resolveTheme("nord", "light").background);
  });

  test("restores the configured theme when preview is cancelled", async () => {
    const config: Config = { showScrollbars: false, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" };
    let canvas = () => "";
    const ThemedApp = () => {
      const current = useTheme();
      canvas = () => current.colors.canvas;
      return <App data={githubDataFixture} operations={repositoryOperationsFixture} config={config} />;
    };
    const view = await testRender(
      () => (
        <ThemeProvider name={config.theme}>
          <ThemedApp />
        </ThemeProvider>
      ),
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressKey(",");
    await view.flush();
    view.mockInput.pressArrow("right");
    await view.flush();
    await view.mockInput.typeText("dracula");
    await view.flush();
    expect(canvas()).toBe(resolveTheme("dracula").background);

    await view.mockMouse.click(0, 0);
    await view.flush();
    expect(canvas()).toBe(resolveTheme("github").background);
    expect(view.captureCharFrame()).toContain("‹ github ›");
    await view.mockMouse.click(0, 0);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("Settings");
  });

  test("keeps settings open and reports persistence failures", async () => {
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          operations={repositoryOperationsFixture}
          config={{ showScrollbars: false, theme: "github", colorMode: "system", reducedMotion: false, markdownStyle: "rich", detailLayout: "centered", detailsPlacement: "auto", showStatusBarHints: true, showTabShortcuts: true, showTabCounts: true, hideDocumentsTab: false, compactHeader: false, iconStyle: "unicode" }}
          onConfigChange={async () => { throw new Error("Config directory is read-only") }}
        />
      ),
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressKey(",");
    for (let i = 0; i < 10; i++) view.mockInput.pressArrow("down");
    view.mockInput.pressEnter();
    await Bun.sleep(0);
    await view.flush();

    const settings = view.captureCharFrame();
    expect(settings).toContain("Settings");
    expect(settings).toContain("Config directory is read-only");
    expect(settings).toContain("‹ off ›");
  });

  test("keeps help and branch overlays mutually exclusive", async () => {
    const { view: branchView } = await setup();
    branchView.mockInput.pressKey("2");
    branchView.mockInput.pressTab();
    await branchView.flush();
    expect(branchView.captureCharFrame()).toContain("Switch branch");

    branchView.mockInput.pressKey("?");
    await branchView.flush();
    expect(branchView.captureCharFrame()).toContain("Switch branch");
    expect(branchView.captureCharFrame()).not.toContain("half-page up / down");

    const { view: helpView } = await setup();
    helpView.mockInput.pressKey("2");
    helpView.mockInput.pressKey("?");
    helpView.mockInput.pressTab();
    await helpView.flush();
    expect(helpView.captureCharFrame()).toContain("half-page up / down");
    expect(helpView.captureCharFrame()).not.toContain("Switch branch");

    helpView.mockInput.pressKey("?");
    await helpView.flush();
    expect(helpView.captureCharFrame()).not.toContain("half-page up / down");
  });

  test("retries the active failed resource", async () => {
    const data = {
      ...githubDataFixture,
      issues: {
        ...githubDataFixture.issues,
        open: {
          status: "error" as const,
          phase: "load" as const,
          message: "Issues unavailable",
        },
      },
    };
    let retry = "";
    let refresh = 0;
    const view = await testRender(
      () => (
        <App
          data={data}
          operations={repositoryOperationsFixture}
          onRetryResource={(resource) => (retry = resource.kind)}
          onRefresh={() => refresh++}
        />
      ),
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();
    view.mockInput.pressKey("3");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Issues unavailable");
    expect(view.captureCharFrame()).not.toContain("Refresh failed — open issues");
    view.mockInput.pressKey("r");
    await view.flush();
    expect(retry).toBe("issues");
    expect(refresh).toBe(0);
  });

  test("toasts retained resource failures while keeping stale rows visible", async () => {
    const data = {
      ...githubDataFixture,
      commits: {
        status: "error" as const,
        phase: "load" as const,
        message: "Commits unavailable",
        value: githubDataFixture.commits.value,
      },
    };
    const view = await testRender(
      () => <App data={data} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();
    view.mockInput.pressKey("2");
    await view.flush();

    const frame = view.captureCharFrame();
    expect(frame).toContain("fix: avoid duplicate key events");
    expect(frame).toContain("Refresh failed — commits: Commits");
    expect(frame).toContain("unavailable");
  });

  test("Help shows only shortcuts for the active page and commit detail", async () => {
    const [detail, setDetail] = createSignal({
      sha: commitDetailFixture.sha,
      resource: { status: "ready" as const, value: commitDetailFixture },
    });
    const view = await testRender(() => (
      <App data={githubDataFixture} operations={repositoryOperationsFixture} commitDetail={detail()} />
    ), { width: 100, height: 28 });
    active.push(view);
    await view.flush();
    const cases = [
      ["1", "copy repo URL"],
      ["2", "choose branch"],
      ["3", "toggle open/closed"],
      ["4", "toggle open/closed"],
      ["5", "refresh / retry"],
    ];
    for (const [key, shortcut] of cases) {
      view.mockInput.pressKey(key!);
      view.mockInput.pressKey("?");
      await view.flush();
      const frame = view.captureCharFrame();
      expect(frame).toContain("Help");
      expect(frame).not.toContain("Help ·");
      expect(frame).toContain(shortcut!);
      expect(frame).toContain("half-page up / down");
      expect(frame).toContain("q / ctrl+c");
      if (key !== "1") expect(frame).not.toContain("copy repo URL");
      if (key !== "2") expect(frame).not.toContain("choose branch");
      if (key === "3" || key === "4" || key === "5") expect(frame).not.toContain("copy commit SHA");
      view.mockInput.pressKey("?");
    }
    view.mockInput.pressKey("2");
    view.mockInput.pressEnter();
    view.mockInput.pressKey("?");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Help");
    expect(view.captureCharFrame()).toContain("back to commits");
    expect(view.captureCharFrame()).not.toContain("choose branch");
    expect(view.captureCharFrame()).not.toContain("load more files");
    setDetail({ sha: commitDetailFixture.sha, resource: { status: "ready", value: {
      ...commitDetailFixture, files: { ...commitDetailFixture.files, hasMore: true },
    } } });
    await view.flush();
    expect(view.captureCharFrame()).toContain("load more files");
    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("back to commits");
    expect(view.captureCharFrame()).toContain(commitDetailFixture.message);
  });

  test("opens help and invokes global actions", async () => {
    const { view, quit, refresh } = await setup();
    view.mockInput.pressKey("?");
    await view.flush();
    const help = view.captureCharFrame();
    expect(help).toContain("Help");
    expect(help).toContain("u / d");
    expect(help).toContain("half-page up / down");
    expect(help).toContain("tab");
    expect(help).toContain("switch documents");
    expect(help).toContain("settings");
    expect(help).not.toContain("Navigation");
    expect(help).not.toContain("Current view");
    expect(help).not.toContain("Application");
    expect(help).toContain("q / ctrl+c");
    expect(help).toContain("quit");
    expect(help).toContain("README");
    view.mockInput.pressKey("?");
    view.mockInput.pressKey("r");
    view.mockInput.pressKey("q");
    await view.flush();
    expect(refresh()).toBe(1);
    expect(quit()).toBe(1);
  });

  test("shows transient operation failures as toasts", async () => {
    const [operations, setOperations] = createSignal(structuredClone(repositoryOperationsFixture));
    const view = await testRender(
      () => <App data={githubDataFixture} operations={operations} onQuit={() => {}} />,
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();

    setOperations((value) => ({ ...value, refresh: { status: "error", message: "API unavailable" } }));
    await view.flush();
    expect(view.captureCharFrame()).toContain("Refresh failed");
    expect(view.captureCharFrame()).toContain("API unavailable");
  });

  test("formats About metadata compactly", async () => {
    const data = {
      ...githubDataFixture,
      repo: {
        ...githubDataFixture.repo,
        description: "Qdrant — High-performance vector search. Also available at https://cloud.example.com/path/",
        language: "Rust",
        stars: 35_000,
        forks: 2_700,
        watchers: 166,
        license: "Apache-2.0",
      },
    };
    const view = await testRender(
      () => <App data={data} operations={repositoryOperationsFixture} config={{ ...defaultConfig, hideDocumentsTab: false, compactHeader: false, iconStyle: "nerd" }} onQuit={() => {}} />,
      { width: 120, height: 32 },
    );
    active.push(view);
    await view.flush();

    const frame = view.captureCharFrame();
    expect(frame).toContain("cloud.example.com/path");
    expect(frame).not.toContain("https://cloud.example.com");
    expect(frame).toContain("Language");
    expect(frame).not.toContain("REPOSITORY");
    expect(frame).toContain(`${repositoryIcons.star} 35k stars`);
    expect(frame).toContain(`${repositoryIcons.fork} 2.7k forks`);
    expect(frame).toContain(`${repositoryIcons.watching} 166 watching`);
    expect(frame).toContain("License");
    expect(frame).toContain("Apache-2.0");
  });

  test("adapts to a narrow terminal", async () => {
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          operations={repositoryOperationsFixture}
          onQuit={() => {}}
        />
      ),
      { width: 76, height: 24 },
    );
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("About");
    expect(view.captureCharFrame()).toContain("README");
    expect(view.captureCharFrame()).toContain("Contributing");

    expect(view.captureCharFrame()).not.toContain(nerdIcons.document.readme);
    view.resize(140, 24);
    await view.flush();
    expect(view.captureCharFrame()).toContain(`${nerdIcons.document.readme} README`);
    view.resize(76, 24);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain(nerdIcons.document.readme);
    expect(view.captureCharFrame()).toContain("Contributing");

    view.resize(50, 24);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("About");
    expect(view.captureCharFrame()).toContain("‹ README ›");
  });

  test("b shows or hides the About sidebar over the width-based default", async () => {
    const view = await testRender(
      () => <App data={githubDataFixture} operations={repositoryOperationsFixture} />,
      { width: 76, height: 24 },
    );
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("About");
    view.mockInput.pressKey("b");
    await view.flush();
    expect(view.captureCharFrame()).toContain("About");

    // An explicit choice no longer follows the terminal width.
    view.resize(120, 24);
    view.mockInput.pressKey("b");
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("About");
  });
});


test("compact header uses one row with tabs left and repository right", async () => {
  const [compact, setCompact] = createSignal(false);
  const view = await testRender(() => (
    <box flexDirection="column">
      <Header repo={githubDataFixture.repo} page="overview" tabs={[{ page: "overview", label: "Overview" }]} compact={compact()} />
      <text>Page content</text>
    </box>
  ), { width: 100, height: 12 });
  active.push(view);
  await view.flush();
  expect(view.captureCharFrame().split("\n")[5]).toContain("Page content");
  setCompact(true);
  await view.flush();
  const rows = view.captureCharFrame().split("\n");
  const repositoryName = githubDataFixture.repo.nameWithOwner.split("/").slice(1).join("/");
  expect(rows[0]).toContain(repositoryName);
  expect(rows[0]).not.toContain(githubDataFixture.repo.nameWithOwner);
  expect(rows[0]).toContain("1 Overview");
  expect(rows[0].trimEnd().endsWith(repositoryName)).toBe(true);
  expect(rows[1]).toContain("Page content");
  expect(view.captureCharFrame()).not.toContain("─");
});

test("remembered Actions waits for availability, falls back when absent, and does not override user navigation", async () => {
  for (const outcome of ["available", "empty", "user-navigated", "user-clicked-current"] as const) {
    const [data, setData] = createSignal<RepositoryData>({ ...githubDataFixture, runs: { status: "loading", phase: "load" } });
    const changes: string[] = [];
    const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture}
      initialPage="actions" onPageChange={(page) => changes.push(page)}
    />, { width: 120, height: 32 });
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).toContain("About");
    if (outcome === "user-navigated") {
      view.mockInput.pressKey("3");
      await view.flush();
    }
    if (outcome === "user-clicked-current") {
      const rows = view.captureCharFrame().split("\n");
      const y = rows.findIndex((row) => row.includes("1 Overview"));
      await view.mockMouse.click(rows[y]!.indexOf("1 Overview"), y);
      await view.flush();
    }
    setData((current) => ({ ...current, runs: outcome === "empty"
      ? { status: "ready", value: { items: [], page: 1, hasMore: false } } : githubDataFixture.runs }));
    await view.flush();
    if (outcome === "available") {
      expect(view.captureCharFrame()).toContain("Publish v0.4.5");
    } else if (outcome === "empty" || outcome === "user-clicked-current") {
      expect(view.captureCharFrame()).toContain("About");
      expect(changes).not.toContain("actions");
    } else {
      expect(view.captureCharFrame()).toContain("ScrollBox loses focus");
      expect(changes).not.toContain("actions");
    }
  }
});


test("pagination feedback does not resize the commit viewport or reveal an extra row", async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({
    ...githubDataFixture.commits.value!.items[0]!, sha: String(index).padStart(40, "0"), message: `COMMIT ${index}`,
  }));
  const [data, setData] = createSignal<RepositoryData>({ ...githubDataFixture,
    commits: { status: "ready", value: { items, page: 1, hasMore: true } },
  });
  const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture}
    config={{ ...defaultConfig, showStatusBarHints: false }} initialPage="commits"
  />, { width: 76, height: 41 });
  active.push(view);
  const findList = (node: Renderable): ScrollBoxRenderable | undefined => {
    if (node instanceof ScrollBoxRenderable && node.content.getChildren().length === items.length) return node;
    for (const child of node.getChildren()) {
      const found = findList(child);
      if (found) return found;
    }
  };
  await view.flush();
  for (let index = 0; index < 10; index++) view.mockInput.pressKey("j");
  await view.flush();
  const list = findList(view.renderer.root)!;
  const height = list.viewport.height;
  const scroll = list.scrollTop;
  const visibleRows = () => view.captureCharFrame().split("\n").filter((row) => /COMMIT \d/.test(row));
  const before = visibleRows();
  for (const loading of [true, false, true, false]) {
    setData((current) => ({ ...current, commits: loading
      ? { status: "loading", phase: "pagination", value: current.commits.value }
      : { status: "ready", value: current.commits.value! },
    }));
    // Assert individual frames, not just the final settled layout.
    for (let pass = 0; pass < 2; pass++) {
      await view.renderOnce();
      expect(list.viewport.height).toBe(height);
      expect(list.scrollTop).toBe(scroll);
      expect(visibleRows()).toEqual(before);
    }
  }
});
