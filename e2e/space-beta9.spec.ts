import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

interface Channel { onmessage: (event: unknown) => void; }
interface Task { id: number; root: string; channel: Channel; }
interface MutationRuntime {
  tasks: Task[];
  cancelled: number[];
  recycled: string[];
  deleted: string[];
  failRecycles: boolean;
  partialRecycle: boolean;
  liveChild: boolean;
  publish: (index: number, done?: boolean, oldBytes?: number) => void;
}

async function openMutationSpace(page: Page, options: { liveChild?: boolean } = {}) {
  await page.addInitScript(({ liveChild }) => {
    localStorage.clear();
    localStorage.setItem("muller.preferences.v1", JSON.stringify({ version: 1, locale: "en-US", theme: "platinum", audioEnabled: false, motion: "reduced" }));
    const state: MutationRuntime = {
      tasks: [], cancelled: [], recycled: [], deleted: [], failRecycles: false, partialRecycle: false,
      liveChild: Boolean(liveChild),
      publish(index, done = true, oldBytes) {
        const task = state.tasks[index];
        const isParent = task.root === "D:\\Muller";
        const deletedBytes = state.deleted.includes("Deleted.txt") ? 0 : 900;
        const keptBytes = state.deleted.includes("Keep.txt") ? 0 : 100;
        const entries = isParent
          ? [{ name: "Projects", kind: "directory", bytes: deletedBytes + keptBytes }, { name: "Media", kind: "directory", bytes: 100 }]
          : [{ name: "Deleted.txt", kind: "file", bytes: deletedBytes }, { name: "Keep.txt", kind: "file", bytes: keptBytes }].filter((entry) => entry.bytes > 0);
        const totalBytes = oldBytes ?? entries.reduce((sum, entry) => sum + entry.bytes, 0);
        const root = { path: task.root, name: task.root.split("\\").at(-1), parent: null, kind: "directory", bytes: totalBytes, depth: 0, childCount: entries.length, partial: false, scanning: !done };
        const items = entries.map((entry) => ({ ...entry, path: `${task.root}\\${entry.name}`, parent: task.root, depth: 1, childCount: entry.kind === "directory" ? 2 : 0, modifiedUnixMs: 1_758_345_600_123, partial: false, scanning: false }));
        task.channel.onmessage({ type: "batch", taskId: task.id, items: [...items, root], totalBytes, fileCount: 2, directoryCount: 1 });
        if (done) task.channel.onmessage({ type: "done", taskId: task.id, root, totalBytes, fileCount: 2, directoryCount: 1 });
      },
    };
    const runtime = globalThis as typeof globalThis & { isTauri: boolean; __spaceMutation: MutationRuntime };
    runtime.isTauri = true; runtime.__spaceMutation = state;
    let id = 0;
    let callback = 0;
    const tauri = window as unknown as { __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: string } }; transformCallback: () => number; unregisterCallback: () => void;
      invoke: (command: string, payload: { taskId?: number; sessionId?: number; offset?: number; onEvent?: Channel; expectation?: { path: string }; request?: { path?: string; root?: string } }) => unknown;
    } };
    tauri.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } }, transformCallback: () => ++callback, unregisterCallback: () => undefined,
      invoke(command, payload) {
        if (command === "plugin:window|is_maximized") return false;
        if (command === "get_shell_locations") return [{ id: "profile", label: "Profile", path: "D:\\Muller" }];
        if (["list_logical_drives", "list_directory_extensions", "complete_directory_path"].includes(command)) return [];
        if (command === "start_directory_query") {
          const taskId = ++id;
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId });
            payload.onEvent?.onmessage({ type: "ready", taskId, sessionId: taskId, path: payload.request?.path ?? "D:\\Muller", parent: null, totalEntries: 0 });
          });
          return { taskId };
        }
        if (command === "read_directory_page") return { sessionId: payload.sessionId, offset: payload.offset ?? 0, totalEntries: 0, entries: [] };
        if (command === "start_space_scan") {
          const taskId = ++id;
          const root = payload.request?.root ?? "D:\\Muller";
          const index = state.tasks.length;
          if (payload.onEvent) state.tasks.push({ id: taskId, root, channel: payload.onEvent });
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId, root });
            state.publish(index, !(state.liveChild && root.endsWith("\\Projects") && index === 1));
          });
          return { taskId };
        }
        if (command === "cancel_space_scan") { state.cancelled.push(payload.taskId ?? -1); return { taskId: payload.taskId, cancelled: true }; }
        if (command === "recycle_entry") {
          const path = payload.expectation?.path ?? "";
          state.recycled.push(path);
          if (state.failRecycles || state.partialRecycle && path.endsWith("\\Keep.txt")) return Promise.reject(new Error("Fixture recycle failed"));
          state.deleted.push(path.split("\\").at(-1) ?? "");
          return path;
        }
        return null;
      },
    };
  }, options);
  await page.goto("/");
  await page.getByRole("button", { name: "Space map", exact: true }).click();
  await expect(page.getByRole("region", { name: "Space Sniffer" }).locator("canvas")).toHaveAttribute("data-area-bytes", "1100");
}

async function countTasks(page: Page) {
  return page.evaluate(() => (globalThis as typeof globalThis & { __spaceMutation: MutationRuntime }).__spaceMutation.tasks.length);
}

async function enterChild(page: Page) {
  const region = page.getByRole("region", { name: "Space Sniffer" });
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  await region.getByRole("application", { name: "Folder space map" }).dblclick({ position: { x: 50, y: 50 } });
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller\\Projects");
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "1000");
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
}

for (const returnKey of ["Backspace", "Alt+ArrowLeft"] as const) {
  test(`child recycle invalidates completed ancestor snapshots for ${returnKey}`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await openMutationSpace(page);
    const artifactDirectory = returnKey === "Backspace" ? process.env.MULLER_QA_ARTIFACT_DIR : undefined;
    if (artifactDirectory) {
      await mkdir(artifactDirectory, { recursive: true });
      await page.screenshot({ path: join(artifactDirectory, "space-before-child-delete.png") });
    }
    await enterChild(page);
    const region = page.getByRole("region", { name: "Space Sniffer" });
    const viewport = region.getByRole("application", { name: "Folder space map" });
    await viewport.click({ position: { x: 50, y: 50 } });
    await expect(region.getByRole("heading", { level: 2 })).toHaveText("Deleted.txt");
    page.once("dialog", (dialog) => dialog.accept());
    await viewport.press("Delete");
    await expect.poll(() => countTasks(page)).toBe(3);
    await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "100");
    await expect(region.getByRole("heading", { level: 2 })).toHaveCount(0);
    await viewport.press(returnKey);
    await expect.poll(() => countTasks(page)).toBe(4);
    await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
    await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "200");
    if (artifactDirectory) await page.screenshot({ path: join(artifactDirectory, "space-parent-after-child-delete.png") });
    expect(Number(await region.getAttribute("data-history-retained-nodes"))).toBeLessThanOrEqual(10_000);
    expect(errors).toEqual([]);
  });
}

test("partial recycle refreshes ancestors while rejected and cancelled attempts reuse valid history", async ({ page }) => {
  await openMutationSpace(page);
  await enterChild(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  await viewport.click({ position: { x: 50, y: 50 } });
  page.once("dialog", (dialog) => dialog.dismiss());
  await viewport.press("Delete");
  await expect.poll(() => countTasks(page)).toBe(2);
  await viewport.press("Alt+ArrowLeft");
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "1100");
  expect(await countTasks(page)).toBe(2);
  await viewport.press("Alt+ArrowRight");
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller\\Projects");
  await page.evaluate(() => { (globalThis as typeof globalThis & { __spaceMutation: MutationRuntime }).__spaceMutation.failRecycles = true; });
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 50, y: 50 } });
  page.once("dialog", (dialog) => dialog.accept());
  await viewport.press("Delete");
  await expect(region.getByRole("alert")).toContainText("Fixture recycle failed");
  await viewport.press("Alt+ArrowLeft");
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "1100");
  expect(await countTasks(page)).toBe(2);
  await viewport.press("Alt+ArrowRight");
  await page.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __spaceMutation: MutationRuntime }).__spaceMutation;
    state.failRecycles = false; state.partialRecycle = true;
  });
  await viewport.press("Control+a");
  page.once("dialog", (dialog) => dialog.accept());
  await viewport.press("Delete");
  await expect.poll(() => countTasks(page)).toBe(3);
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "100");
  await expect(region.getByRole("alert")).toContainText("Fixture recycle failed");
  await viewport.press("Backspace");
  await expect.poll(() => countTasks(page)).toBe(4);
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "200");
});

test("successful mutation cancels a live child scan and rejects its late completion", async ({ page }) => {
  await openMutationSpace(page, { liveChild: true });
  await enterChild(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  await expect(region.getByRole("status")).toHaveText("Scanning");
  await viewport.click({ position: { x: 50, y: 50 } });
  page.once("dialog", (dialog) => dialog.accept());
  await viewport.press("Delete");
  await expect.poll(() => countTasks(page)).toBe(3);
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "100");
  await page.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __spaceMutation: MutationRuntime }).__spaceMutation;
    state.publish(1, true, 99_999);
  });
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "100");
  await expect.poll(() => page.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __spaceMutation: MutationRuntime }).__spaceMutation;
    return state.cancelled.includes(state.tasks[1].id);
  })).toBe(true);
  await viewport.press("Backspace");
  await expect.poll(() => countTasks(page)).toBe(4);
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "200");
});

test("manual refresh invalidates the completed parent after external changes", async ({ page }) => {
  await openMutationSpace(page);
  await enterChild(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  await page.evaluate(() => { (globalThis as typeof globalThis & { __spaceMutation: MutationRuntime }).__spaceMutation.deleted.push("Deleted.txt"); });
  await viewport.press("F5");
  await expect.poll(() => countTasks(page)).toBe(3);
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "100");
  await viewport.press("Backspace");
  await expect.poll(() => countTasks(page)).toBe(4);
  await expect(region.locator("canvas")).toHaveAttribute("data-area-bytes", "200");
});
