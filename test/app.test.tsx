import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { RGBA } from "@opentui/core";
import { createSignal } from "solid-js";
import { App } from "../src/ui/app";
import { defaultConfig, type Config } from "../src/config";
import { appColors, resolveTheme } from "../src/theme";
import type { ResourceState } from "../src/repository-state";
import { ThemeProvider, useTheme } from "../src/ui/theme";
import {
  commitDetailFixture,
  githubDataFixture,
  repositoryOperationsFixture,
} from "./fixtures/github-data";

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
    { width: 120, height: 32, useThread: false },
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

describe("openGH TUI", () => {
  test("status bar hints can be disabled on every page without disabling shortcuts or loading feedback", async () => {
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
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);
    view.renderer.copyToClipboardOSC52 = (value) => { copied = value; return true; };
    const statusLine = () => view.captureCharFrame().split("\n")[31]!.trim();
    await view.flush();
    expect(statusLine()).toBe("");
    setConfig({ ...defaultConfig, showStatusBarHints: true });
    await view.flush();
    expect(statusLine()).toBe("o GitHub · y URL · ? help");

    view.mockInput.pressKey(",");
    for (let i = 0; i < 3; i++) view.mockInput.pressKey("j");
    view.mockInput.pressEnter();
    await view.flush();
    expect(view.captureCharFrame()).toContain("Status bar hints");
    expect(config().showStatusBarHints).toBe(false);
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
    expect(statusLine()).toContain("Refreshing…");

    setOperations(repositoryOperationsFixture);
    setConfig({ ...defaultConfig, showStatusBarHints: true });
    await view.flush();
    expect(statusLine()).toBe("esc back · o GitHub · y SHA · ? help");
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
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);
    await view.flush();
    const initialFrame = view.captureCharFrame();
    expect(initialFrame).toContain("anomalyco/opentui");
    expect(initialFrame).toContain("README");
    expect(initialFrame).toContain("About");
    expect(initialFrame).not.toContain("Loading…");

    await Bun.sleep(210);
    await view.flush();
    const loadingFrame = view.captureCharFrame();
    expect(loadingFrame).toContain("Loading…");
    expect(loadingFrame.match(/Loading…/g)).toHaveLength(1);
  });

  test("renders an empty README as loaded content", async () => {
    const data = withDocumentResources({ "README.md": { status: "ready", value: "" } });
    const view = await testRender(
      () => <App data={data} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);

    await Bun.sleep(210);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("Loading…");
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
    expect(view.captureCharFrame()).toContain("Open (4)");
    expect(view.captureCharFrame()).toContain("Closed (1)");
    expect(view.captureCharFrame()).toContain("#412 ·");
    expect(view.captureCharFrame()).toContain("ScrollBox loses focus");

    view.mockInput.pressKey("j");
    await view.flush();
    expect(view.captureCharFrame()).toContain(
      "Add support for accessible color themes",
    );

    view.mockInput.pressKey("4");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Pull requests");
    expect(view.captureCharFrame()).toContain("#421 ·");

    view.mockInput.pressKey("5");
    await view.flush();
    expect(view.captureCharFrame()).toContain("4 workflow runs");
  });

  test("PR rows distinguish purple merges from red unmerged closures", async () => {
    const data = structuredClone(githubDataFixture);
    const merged = data.pulls.closed.value!.items[0]!;
    data.pulls.closed.value!.items = [
      { ...merged, title: "Merged PR", merged: true },
      { ...merged, number: 403, title: "Closed PR", merged: false },
    ];
    const view = await testRender(() => <App data={data} operations={repositoryOperationsFixture} />,
      { width: 100, height: 26, useThread: false });
    active.push(view);
    const colors = appColors(resolveTheme("github"));
    const iconColor = (icon: string) => view.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes(icon))?.fg;
    await view.flush();
    view.mockInput.pressKey("4");
    await view.flush();
    expect(iconColor("⑂")).toEqual(RGBA.fromHex(colors.openState));
    view.mockInput.pressTab();
    for (const width of [100, 32]) {
      view.resize(width, 26);
      await view.flush();
      expect(view.captureCharFrame()).toContain("Merged PR");
      expect(view.captureCharFrame()).toContain("Closed PR");
      expect(iconColor("⑃")).toEqual(RGBA.fromHex(colors.purple));
      expect(iconColor("×")).toEqual(RGBA.fromHex(colors.red));
    }
    view.mockInput.pressKey("3");
    view.mockInput.pressTab();
    await view.flush();
    expect(iconColor("✓")).toEqual(RGBA.fromHex(colors.closedState));
  });

  test("hides Actions only after an empty result resolves", async () => {
    const emptyRuns = {
      status: "ready" as const,
      value: { items: [], page: 1, hasMore: false },
    };
    const data = { ...githubDataFixture, runs: emptyRuns };
    const view = await testRender(
      () => (
        <App
          data={data}
          operations={repositoryOperationsFixture}
          onQuit={() => {}}
        />
      ),
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("Actions");

    const loadingView = await testRender(
      () => (
        <App
          data={{
            ...githubDataFixture,
            runs: { status: "loading", phase: "load" },
          }}
          operations={repositoryOperationsFixture}
          onQuit={() => {}}
        />
      ),
      { width: 120, height: 32, useThread: false },
    );
    active.push(loadingView);
    await loadingView.flush();
    expect(loadingView.captureCharFrame()).toContain("Actions");
  });

  test("loads more commits and workflow runs near list ends", async () => {
    const initial = structuredClone(githubDataFixture);
    if (!initial.commits.value || !initial.runs.value)
      throw new Error("Expected loaded fixtures");
    initial.commits.value.hasMore = true;
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
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressKey("2");
    view.mockInput.pressKey("j");
    await view.flush();
    expect(commitLoads).toBe(1);
    expect(view.captureCharFrame()).toContain("5 commits");

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
      { width: 100, height: 20, useThread: false },
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
    expect(
      frame.split("\n").findIndex((row) => row.includes("commit row 12")),
    ).toBe(selectedRow);
    expect(frame).toContain("Refreshing…");
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
    ), { width: 100, height: 20, useThread: false })
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
      documents: { status: "ready" as const, value: githubDataFixture.documents.value!.filter((document) => document.path !== "SECURITY.md") },
    };
    const view = await testRender(
      () => <App data={data} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);
    await view.flush();

    const frame = view.captureCharFrame();
    expect(frame).toContain("README");
    expect(frame).toContain("Code of conduct");
    expect(frame).toContain("Contributing");
    expect(frame).not.toContain("Security");
    expect(frame).toContain("MIT license");
  });

  test("uses a plain README heading when no other documents exist", async () => {
    const data = {
      ...githubDataFixture,
      documents: { status: "ready" as const, value: githubDataFixture.documents.value!.filter((document) => document.path === "README.md") },
    };
    const view = await testRender(
      () => <App data={data} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 76, height: 24, useThread: false },
    );
    active.push(view);
    await view.flush();

    const frame = view.captureCharFrame();
    expect(frame).toContain("README");
    expect(frame).not.toContain("Contributing");
    expect(frame).not.toContain("Security");
    expect(frame).not.toContain("‹ README ›");
  });

  test("cycles overview documents in both directions", async () => {
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
          operations={repositoryOperationsFixture}
          onRetryResource={(resource) => (retry = resource.kind === "document" ? resource.id : resource.kind)}
        />
      ),
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressTab();
    await view.flush();
    await Bun.sleep(30); // Markdown parsing completes asynchronously after rendering starts.
    await view.flush();
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
    ), { width: 120, height: 32, useThread: false })
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
      { width: 120, height: 32, useThread: false },
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
      { width: 120, height: 32, useThread: false },
    )
    active.push(view)
    await view.flush()
    view.mockInput.pressKey("2")
    await view.flush()

    const commits = view.captureCharFrame()
    expect(commits).toContain(" main ▾")
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
  })

  test("opens the branch picker and toggles work states", async () => {
    const { view, branch, setCanSwitchBranch } = await setup();
    view.mockInput.pressKey("2");
    view.mockInput.pressTab();
    await view.flush();
    const branchFrame = view.captureCharFrame();
    expect(branchFrame).toContain("Switch branch");
    const currentBranchRow = branchFrame.split("\n").find((row) => row.includes("✓ current"));
    expect(currentBranchRow).toContain("›");
    await view.mockInput.typeText("nxt");
    setCanSwitchBranch(false);
    view.mockInput.pressEnter();
    await view.flush();
    expect(branch()).toBe("");
    expect(view.captureCharFrame()).toContain("Repository is busy");
    expect(view.captureCharFrame()).toContain("Switch branch");

    setCanSwitchBranch(true);
    view.mockInput.pressEnter();
    await view.flush();
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
    const [config, setConfig] = createSignal<Config>({ showScrollbars: false, theme: "github", aboutSidebar: "auto", showStatusBarHints: true });
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
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressKey(",");
    await view.flush();
    const settings = view.captureCharFrame();
    expect(settings).toContain("Settings");
    expect(settings).toContain("Theme");
    expect(settings).toContain("github");
    expect(settings).toContain("Scrollbars");
    expect(settings).toContain("‹ off ›");
    expect(settings).toContain("Choose the color theme");
    expect(settings).not.toContain("change · enter toggle");

    view.mockInput.pressArrow("down");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Show vertical scrollbars");
    view.mockInput.pressArrow("right");
    await Bun.sleep(0);
    await view.flush();
    expect(saves).toBe(1);
    expect(config()).toEqual({ showScrollbars: true, theme: "github", aboutSidebar: "auto", showStatusBarHints: true });
    expect(view.captureCharFrame()).toContain("‹ on ›");

    view.mockInput.pressArrow("down");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Auto hides the sidebar")
    view.mockInput.pressArrow("right");
    await Bun.sleep(0);
    await view.flush();
    expect(saves).toBe(2);
    expect(config().aboutSidebar).toBe("show");
    expect(view.captureCharFrame()).toContain("‹ show ›");

    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("Show vertical scrollbars");
  });

  test("previews and saves a theme from settings", async () => {
    const [config, setConfig] = createSignal<Config>({ showScrollbars: false, theme: "github", aboutSidebar: "auto", showStatusBarHints: true });
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
        <ThemeProvider name={config().theme}>
          <ThemedApp />
        </ThemeProvider>
      ),
      { width: 120, height: 32, useThread: false },
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
  });

  test("restores the configured theme when preview is cancelled", async () => {
    const config: Config = { showScrollbars: false, theme: "github", aboutSidebar: "auto", showStatusBarHints: true };
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
      { width: 120, height: 32, useThread: false },
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

    view.mockInput.pressEscape();
    await Bun.sleep(30);
    await view.flush();
    expect(canvas()).toBe(resolveTheme("github").background);
    expect(view.captureCharFrame()).toContain("‹ github ›");
  });

  test("keeps settings open and reports persistence failures", async () => {
    const view = await testRender(
      () => (
        <App
          data={githubDataFixture}
          operations={repositoryOperationsFixture}
          config={{ showScrollbars: false, theme: "github", aboutSidebar: "auto", showStatusBarHints: true }}
          onConfigChange={async () => { throw new Error("Config directory is read-only") }}
        />
      ),
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);
    await view.flush();

    view.mockInput.pressKey(",");
    view.mockInput.pressArrow("down");
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
      { width: 120, height: 32, useThread: false },
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
      { width: 120, height: 32, useThread: false },
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
    ), { width: 100, height: 28, useThread: false });
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
      expect(frame).toContain("q / C-c");
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
    expect(view.captureCharFrame()).toContain("Commit 7ca91d2");
  });

  test("opens help and invokes global actions", async () => {
    const { view, quit, refresh } = await setup();
    view.mockInput.pressKey("?");
    await view.flush();
    const help = view.captureCharFrame();
    expect(help).toContain("Help");
    expect(help).toContain("u/d");
    expect(help).toContain("half-page up / down");
    expect(help).toContain("Tab");
    expect(help).toContain("switch documents");
    expect(help).toContain("settings");
    expect(help).not.toContain("Navigation");
    expect(help).not.toContain("Current view");
    expect(help).not.toContain("Application");
    expect(help).toContain("q / C-c");
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
      { width: 120, height: 32, useThread: false },
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
      () => <App data={data} operations={repositoryOperationsFixture} onQuit={() => {}} />,
      { width: 120, height: 32, useThread: false },
    );
    active.push(view);
    await view.flush();

    const frame = view.captureCharFrame();
    expect(frame).toContain("cloud.example.com/path");
    expect(frame).not.toContain("https://cloud.example.com");
    expect(frame).toContain("Language");
    expect(frame).not.toContain("REPOSITORY");
    expect(frame).toContain("★ 35k stars");
    expect(frame).toContain("⑂ 2.7k forks");
    expect(frame).toContain("◉ 166 watching");
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
      { width: 76, height: 24, useThread: false },
    );
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("About");
    expect(view.captureCharFrame()).toContain("README");
    expect(view.captureCharFrame()).toContain("Contributing");

    view.resize(50, 24);
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("About");
    expect(view.captureCharFrame()).toContain("‹ README ›");
  });

  test("respects explicit About sidebar visibility", async () => {
    const [config, setConfig] = createSignal<Config>({
      showScrollbars: false,
      theme: "github",
      aboutSidebar: "show",
      showStatusBarHints: true,
    });
    const view = await testRender(
      () => <App data={githubDataFixture} operations={repositoryOperationsFixture} config={config()} />,
      { width: 76, height: 24, useThread: false },
    );
    active.push(view);
    await view.flush();
    expect(view.captureCharFrame()).toContain("About");

    view.resize(120, 24);
    setConfig((current) => ({ ...current, aboutSidebar: "hide" }));
    await view.flush();
    expect(view.captureCharFrame()).not.toContain("About");
  });
});
