import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { App } from "../src/app";
import {
  githubDataFixture,
  repositoryOperationsFixture,
} from "./fixtures/github-data";

const active: Array<{ renderer: { destroy(): void; isDestroyed: boolean } }> =
  [];
afterEach(() => {
  for (const setup of active.splice(0))
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
});

async function setup() {
  let quit = 0;
  let refresh = 0;
  let branch = "";
  const view = await testRender(
    () => (
      <App
        data={githubDataFixture}
        operations={repositoryOperationsFixture}
        onQuit={() => quit++}
        onRefresh={() => refresh++}
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
  };
}

describe("openGH TUI", () => {
  test("renders repository metadata while the README loads", async () => {
    const data = {
      ...githubDataFixture,
      readme: { status: "loading" as const, phase: "load" as const },
    };
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
    const frame = view.captureCharFrame();
    expect(frame).toContain("anomalyco/opentui");
    expect(frame).toContain("About");
    expect(frame).toContain("Loading README");
  });

  test("switches screens and moves the selection", async () => {
    const { view } = await setup();
    view.mockInput.pressKey("2");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Commits (4)");
    expect(view.captureCharFrame()).toContain("7ca91d2");
    expect(view.captureCharFrame()).not.toContain("7ca91d200000");

    view.mockInput.pressKey("3");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Open (4)");
    expect(view.captureCharFrame()).toContain("Closed (1)");
    expect(view.captureCharFrame()).toContain("OPENED");
    expect(view.captureCharFrame()).toContain("ScrollBox loses focus");

    view.mockInput.pressKey("j");
    await view.flush();
    expect(view.captureCharFrame()).toContain(
      "Add support for accessible color themes",
    );

    view.mockInput.pressKey("4");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Pull requests");

    view.mockInput.pressKey("5");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Workflow runs (4)");
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
    expect(view.captureCharFrame()).toContain("Commits (5)");

    view.mockInput.pressKey("5");
    view.mockInput.pressKey("j");
    await view.flush();
    expect(runLoads).toBe(1);
    expect(view.captureCharFrame()).toContain("Workflow runs (5)");
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
    await view.flush();
    const frame = view.captureCharFrame();
    expect(
      frame.split("\n").findIndex((row) => row.includes("commit row 12")),
    ).toBe(selectedRow);
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
    expect(frame.split("\n").filter((row) => row.includes("Issues  Open")).length).toBe(1)
    expect(frame.split("▌").length - 1).toBe(1)
    expect(frame).toContain("issue row 24")
  })

  test("opens the branch picker and toggles work states", async () => {
    const { view, branch } = await setup();
    view.mockInput.pressTab();
    await view.flush();
    expect(view.captureCharFrame()).toContain("Switch branch");
    await view.mockInput.typeText("nxt");
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
    view.mockInput.pressKey("r");
    await view.flush();
    expect(retry).toBe("issues");
    expect(refresh).toBe(0);
  });

  test("opens help and invokes global actions", async () => {
    const { view, quit, refresh } = await setup();
    view.mockInput.pressKey("?");
    await view.flush();
    expect(view.captureCharFrame()).toContain("Keyboard shortcuts");
    view.mockInput.pressKey("?");
    view.mockInput.pressKey("r");
    view.mockInput.pressKey("q");
    await view.flush();
    expect(refresh()).toBe(1);
    expect(quit()).toBe(1);
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
    expect(view.captureCharFrame()).toContain("About");
  });
});
