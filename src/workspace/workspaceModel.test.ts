import { describe, expect, it } from "vitest";

import {
  activeWorkspaceTab,
  createInitialWorkspaceState,
  createWorkspaceTab,
  dateFilterBoundary,
  parseWorkspaceState,
  workspaceReducer,
} from "./workspaceModel";

describe("Stage 7 workspace model", () => {
  it("falls back cleanly for corrupt data and migrates schema v1", () => {
    expect(activeWorkspaceTab(parseWorkspaceState("not-json")).mode).toBe("browse");
    expect(activeWorkspaceTab(parseWorkspaceState(JSON.stringify({ version: 0 }))).mode)
      .toBe("browse");
    const legacy = createInitialWorkspaceState();
    expect(parseWorkspaceState(JSON.stringify({ ...legacy, version: 1 })).version).toBe(3);
  });

  it("keeps virtual locations typed and persists explicit favorites", () => {
    let state = createInitialWorkspaceState();
    state = workspaceReducer(state, { type: "add-favorite", path: "D:\\Photos" });
    state = workspaceReducer(state, { type: "add-favorite", path: "d:\\photos" });
    state = workspaceReducer(state, {
      type: "update-active",
      patch: { virtualLocation: "this-pc" },
    });
    expect(state.favorites).toEqual(["D:\\Photos"]);
    expect(activeWorkspaceTab(state).virtualLocation).toBe("this-pc");
    state = workspaceReducer(state, { type: "remove-favorite", path: "D:\\PHOTOS" });
    expect(state.favorites).toEqual([]);
  });

  it("keeps independent tab state and chooses a neighbor when closing", () => {
    let state = createInitialWorkspaceState("D:\\Muller");
    const tab = createWorkspaceTab("pictures", "D:\\Pictures", "album");
    state = workspaceReducer(state, { type: "add-tab", tab });
    state = workspaceReducer(state, {
      type: "update-active",
      patch: { filter: { extensions: ["png"], date: null } },
    });
    state = workspaceReducer(state, { type: "activate-tab", id: "browse-1" });
    expect(activeWorkspaceTab(state).filter.extensions).toEqual([]);
    state = workspaceReducer(state, { type: "close-tab", id: "browse-1" });
    expect(state.tabs.some((item) => item.id === "browse-1")).toBe(false);
    expect(state.tabs.some((item) => item.id === state.activeTabId)).toBe(true);
  });

  it("removes legacy Home tabs and migrates the removed Filmstrip view", () => {
    const home = { ...createWorkspaceTab("home", "D:\\Muller"), mode: "home", title: "Home" };
    const browse = {
      ...createWorkspaceTab("browse", "D:\\Pictures"),
      presentation: "cubes-row",
    };
    let state = parseWorkspaceState(JSON.stringify({
      ...createInitialWorkspaceState(),
      tabs: [browse, home],
      activeTabId: "browse",
    }));
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.presentation).toBe("cubes-grid");

    state = workspaceReducer(state, { type: "move-tab", id: "browse", delta: -1 });
    expect(state.tabs.map((tab) => tab.id)).toEqual(["browse"]);
  });

  it("sanitizes persisted bounds, duplicate ids, extensions, and dates", () => {
    const raw = JSON.stringify({
      ...createInitialWorkspaceState(),
      paneRatio: 2,
      previewWidth: 2,
      inspectorWidth: 900,
      tabs: [
        {
          ...createWorkspaceTab("same", "D:\\A"),
          filter: {
            extensions: ["PNG", "png", "../../bad"],
            date: { mode: "before", year: 2026, month: 2, day: 99 },
          },
        },
        createWorkspaceTab("same", "D:\\B"),
      ],
      activeTabId: "missing",
    });
    const state = parseWorkspaceState(raw);
    expect(state.paneRatio).toBe(25);
    expect(state.previewWidth).toBe(240);
    expect(state.inspectorWidth).toBe(420);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.filter.extensions).toEqual(["png"]);
    expect(state.tabs[0]?.filter.date?.day).toBe(28);
  });

  it("serializes before as end-of-day and after as start-of-day local time", () => {
    const before = dateFilterBoundary({ mode: "before", year: 2026, month: 7, day: 23 });
    const after = dateFilterBoundary({ mode: "after", year: 2026, month: 7, day: 23 });
    expect(before - after).toBe(86_399_999);
  });
});
