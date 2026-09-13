import { expect, test } from "@playwright/test";

test("Space Sniffer opens, selects, drills into a folder, and returns", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  // The app uses the English locale in the Playwright test environment, while
  // the Chinese locale labels this control "空间视图". Keep the assertion
  // locale-agnostic so the interaction exercises the same product surface in
  // either configured language.
  await page.getByRole("button", { name: /空间视图|Space map/ }).click();

  const region = page.getByRole("region", { name: "Space Sniffer" });
  await expect(region).toBeVisible();
  await expect(region.locator(".space-sniffer__title")).toHaveText(/Space map|空间视图/);
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");

  const viewport = region.getByRole("application", { name: "Folder space map" });
  await viewport.click();
  await expect(region.getByRole("heading", { level: 2 })).toBeVisible();

  const breadcrumbs = page.locator(".breadcrumb-address__segment button");
  const rootBreadcrumbCount = await breadcrumbs.count();
  await viewport.dblclick();
  await expect(breadcrumbs).toHaveCount(rootBreadcrumbCount + 1);

  await viewport.press("Escape");
  await expect(breadcrumbs).toHaveCount(rootBreadcrumbCount);
  expect(errors).toEqual([]);
});

test("top-level space breadcrumbs create history entries and Escape returns to the previous location", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /空间视图|Space map/ }).click();
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  const rootPath = await region.getAttribute("data-root-path");
  await expect(region.getByRole("navigation", { name: "Folder path" })).toHaveCount(0);
  await viewport.dblclick();
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  const intermediatePath = await region.getAttribute("data-root-path");
  expect(intermediatePath).not.toBe(rootPath);
  await viewport.dblclick();
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  const deepestPath = await region.getAttribute("data-root-path");
  expect(deepestPath).not.toBe(intermediatePath);
  await page.locator(".breadcrumb-address__segments").getByTitle(intermediatePath!, { exact: true }).click();
  await expect(region).toHaveAttribute("data-root-path", intermediatePath!);
  await expect(viewport).toBeFocused();
  await viewport.press("Escape");
  await expect(region).toHaveAttribute("data-root-path", deepestPath!);
  await viewport.press("Escape");
  await expect(region).toHaveAttribute("data-root-path", intermediatePath!);
  await viewport.press("Escape");
  await expect(region).toHaveAttribute("data-root-path", rootPath!);
});

interface SpaceMockChannel { onmessage: (message: unknown) => void; }
interface SpaceMockTask { id: number; root: string; channel: SpaceMockChannel; }
interface SpaceMockRuntime { tasks: SpaceMockTask[]; cancelled: number[]; previews: SpaceMockTask[]; cancelledPreviews: number[]; statisticsPaths: string[]; }

async function installSpaceStreamMock(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("muller.preferences.v1", JSON.stringify({ version: 1, locale: "en-US", theme: "platinum", audioEnabled: false, motion: "full" }));
    const state: SpaceMockRuntime = { tasks: [], cancelled: [], previews: [], cancelledPreviews: [], statisticsPaths: [] };
    const runtime = globalThis as typeof globalThis & { isTauri: boolean; __spaceStream: SpaceMockRuntime };
    runtime.isTauri = true; runtime.__spaceStream = state;
    let id = 0; let callbackId = 0;
    const tauri = window as unknown as { __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: string } }; transformCallback: () => number; unregisterCallback: () => void;
      invoke: (command: string, payload: { taskId?: number; sessionId?: number; offset?: number; path?: string; input?: string; request?: { root?: string; path?: string }; onEvent?: SpaceMockChannel }) => unknown;
    } };
    tauri.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } }, transformCallback: () => ++callbackId, unregisterCallback: () => undefined,
      invoke(command, payload) {
        if (command === "plugin:window|is_maximized") return false;
        if (command === "get_shell_locations") return [
          { id: "profile", label: "Profile", path: "D:\\Muller" },
          { id: "desktop", label: "Desktop", path: "D:\\Desktop" },
        ];
        if (command === "complete_directory_path") return payload.input === "D:\\Draft" ? ["D:\\Draft folder"] : [];
        if (command === "list_logical_drives" || command === "list_directory_extensions") return [];
        if (command === "start_directory_query") {
          const taskId = ++id;
          queueMicrotask(() => { payload.onEvent?.onmessage({ type: "started", taskId }); payload.onEvent?.onmessage({ type: "ready", taskId, sessionId: taskId, path: payload.request?.path ?? "D:\\Muller", parent: null, totalEntries: 0 }); });
          return { taskId };
        }
        if (command === "read_directory_page") return { sessionId: payload.sessionId, offset: payload.offset ?? 0, totalEntries: 0, entries: [] };
        if (command === "start_space_scan") {
          const taskId = ++id; const root = payload.request?.root ?? "D:\\Muller";
          if (payload.onEvent) state.tasks.push({ id: taskId, root, channel: payload.onEvent });
          queueMicrotask(() => payload.onEvent?.onmessage({ type: "started", taskId, root }));
          return { taskId };
        }
        if (command === "cancel_space_scan") { state.cancelled.push(payload.taskId ?? -1); return { taskId: payload.taskId, cancelled: true }; }
        if (command === "directory_statistics") {
          state.statisticsPaths.push(payload.path ?? "");
          return { recursiveSize: 6144, childFileCount: 3, childDirectoryCount: 2 };
        }
        if (command === "start_file_preview") {
          const taskId = ++id;
          if (payload.onEvent) state.previews.push({ id: taskId, root: payload.request?.path ?? "", channel: payload.onEvent });
          queueMicrotask(() => payload.onEvent?.onmessage({ type: "started", taskId }));
          return { taskId };
        }
        if (command === "cancel_file_preview") { state.cancelledPreviews.push(payload.taskId ?? -1); return null; }
        return null;
      },
    };
  });
}

async function publishSpaceBatch(page: import("@playwright/test").Page, index: number, weights: [number, number], done = false, kind: "directory" | "file" = "directory") {
  await page.evaluate(({ taskIndex, sizes, complete, entryKind }) => {
    const state = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream;
    const task = state.tasks[taskIndex];
    const totalBytes = sizes[0] + sizes[1];
    const root = { path: task.root, parent: null, name: task.root.split("\\").filter(Boolean).at(-1), kind: "directory", bytes: totalBytes, depth: 0, childCount: 2, partial: false, scanning: !complete };
    const items = sizes.map((bytes, i) => ({ path: `${task.root.replace(/[\\/]+$/, "")}\\${i === 0 ? "Projects" : "Media"}`, parent: task.root, name: i === 0 ? "Projects" : "Media", kind: entryKind, bytes, depth: 1, childCount: 4, partial: false, scanning: !complete }));
    task.channel.onmessage({ type: "batch", taskId: task.id, items: [...items, root], totalBytes, fileCount: 8, directoryCount: 3, skippedCount: 0 });
    if (complete) task.channel.onmessage({ type: "done", taskId: task.id, root, totalBytes, fileCount: 8, directoryCount: 3, skippedCount: 0 });
  }, { taskIndex: index, sizes: weights, complete: done, entryKind: kind });
}

async function publishPreview(page: import("@playwright/test").Page, index: number, text: string) {
  await page.evaluate(({ previewIndex, content }) => {
    const state = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream;
    const task = state.previews[previewIndex];
    task.channel.onmessage({ type: "ready", taskId: task.id, preview: {
      path: task.root, name: task.root.split("\\").at(-1), kind: "text", mime: "text/plain", text: content,
      dataUrl: null, artworkDataUrl: null, message: null, fileSize: content.length, bytesLoaded: content.length,
      createdUnixMs: null, modifiedUnixMs: null, accessedUnixMs: null, extension: "txt", metadata: [], truncated: false,
    } });
  }, { previewIndex: index, content: text });
}

async function spaceTaskCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.tasks.length);
}

async function openStreamSpace(page: import("@playwright/test").Page) {
  await installSpaceStreamMock(page); await page.goto("/");
  await expect(page.getByRole("button", { name: "Space map", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Space map", exact: true }).click();
}

test("real Channel batches repaint the map before Done and stopping retains the last geometry", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" }); const canvas = region.locator("canvas");
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await expect(region.getByRole("status")).toHaveText("Scanning");
  await publishSpaceBatch(page, 0, [900_000, 100_000]);
  await expect(canvas).toHaveAttribute("data-area-bytes", "1000000"); await expect(canvas).toHaveAttribute("data-visible-count", "2");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  const before = await canvas.screenshot();
  await publishSpaceBatch(page, 0, [900_000, 700_000]);
  await expect(canvas).toHaveAttribute("data-area-bytes", "1600000");
  await expect(region.getByRole("status")).toHaveText("Scanning");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  const after = await canvas.screenshot(); expect(after.equals(before)).toBe(false);
  await region.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(region.getByRole("status")).toHaveText("Scan stopped");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  const stopped = await canvas.screenshot();
  await publishSpaceBatch(page, 0, [8_000_000, 2_000_000], true);
  await expect(canvas).toHaveAttribute("data-area-bytes", "1600000");
  await expect(canvas).toHaveAttribute("data-visible-count", "2");
  expect((await canvas.screenshot()).equals(stopped)).toBe(true);
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.cancelled.length)).toBe(1);
  expect(errors).toEqual([]);
});

test("drilling a live scan cancels its parent and keeps streamed child progress and history isolated", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" }); const canvas = region.locator("canvas"); const viewport = region.getByRole("application", { name: "Folder space map" });
  const breadcrumbs = page.locator(".breadcrumb-address__segments");
  await expect.poll(() => spaceTaskCount(page)).toBe(1); await publishSpaceBatch(page, 0, [800_000, 200_000]);
  await expect(canvas).toHaveAttribute("data-area-bytes", "1000000"); await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText("Projects");
  await publishSpaceBatch(page, 1, [1500, 500]); await expect(canvas).toHaveAttribute("data-area-bytes", "2000");
  await publishSpaceBatch(page, 0, [8_000_000, 2_000_000], true);
  await publishSpaceBatch(page, 1, [1500, 2500]); await expect(canvas).toHaveAttribute("data-area-bytes", "4000");
  await expect(region.getByRole("status")).toHaveText("Scanning"); await expect(region).toHaveAttribute("data-root-path", "D:\\Muller\\Projects");
  await publishSpaceBatch(page, 1, [1500, 3500], true); await expect(canvas).toHaveAttribute("data-area-bytes", "5000");
  await expect(region.getByRole("status")).toHaveText("Scan complete");
  await viewport.press("Escape"); await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText("Muller");
  await expect.poll(() => spaceTaskCount(page)).toBe(3);
  await publishSpaceBatch(page, 2, [3000, 1000], true);
  await expect(canvas).toHaveAttribute("data-area-bytes", "4000"); await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } }); await expect.poll(() => spaceTaskCount(page)).toBe(4);
  await publishSpaceBatch(page, 3, [500, 500], true); await expect(canvas).toHaveAttribute("data-area-bytes", "1000");
  await viewport.press("Escape"); await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText("Muller");
  await expect(region.getByRole("status")).toHaveText("Scan complete"); await expect(canvas).toHaveAttribute("data-area-bytes", "4000");
  expect(await spaceTaskCount(page)).toBe(4);
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.cancelled.length)).toBe(1);
  expect(errors).toEqual([]);
});

test("subpixel folders remain reachable through Smaller items and reduced motion settles immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" }); const canvas = region.locator("canvas");
  await expect.poll(() => spaceTaskCount(page)).toBe(1); await publishSpaceBatch(page, 0, [1_000_000_000, 1], true);
  await expect(canvas).toHaveAttribute("data-area-bytes", "1000000001"); await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  const groupButton = region.getByRole("button", { name: /^Smaller items/ });
  await expect(groupButton).toBeVisible(); await groupButton.click();
  await region.locator(".space-sniffer__group-list").getByRole("button", { name: "Media 1 B" }).click();
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Media");
  await region.getByRole("button", { name: "Open folder" }).click(); await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await expect(page.locator('.breadcrumb-address__segment button[aria-current="page"]')).toHaveText("Media");
});

test("space tiles support keyboard neighbor selection and a context menu", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" }); const canvas = region.locator("canvas");
  const viewport = region.getByRole("application", { name: "Folder space map" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1); await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 100, y: 100 } }); await expect(region.getByRole("heading", { level: 2 })).toBeVisible();
  await viewport.press("ArrowRight");
  const box = await viewport.boundingBox(); expect(box).not.toBeNull();
  await viewport.dispatchEvent("contextmenu", { bubbles: true, clientX: box!.x + box!.width - 20, clientY: box!.y + box!.height / 2, button: 2 });
  await expect(region.getByRole("menu")).toBeVisible();
  await expect(region.getByRole("menu").getByRole("menuitem").first()).toBeVisible();
  await viewport.press("Escape"); await expect(region.getByRole("menu")).not.toBeVisible();
});

test("space Backspace goes to the actual parent beyond the scan root and stops at the drive root", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  const current = page.locator('.breadcrumb-address__segment button[aria-current="page"]');
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [1500, 500], true);
  await expect(current).toHaveText("Projects");

  await viewport.press("Backspace");
  await expect(current).toHaveText("Muller");
  await viewport.press("Backspace");
  await expect.poll(() => spaceTaskCount(page)).toBe(3);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.tasks[2].root)).toBe("D:\\");
  await publishSpaceBatch(page, 2, [3000, 1000], true);
  await expect(current).toHaveText("D:");
  await viewport.press("Backspace");
  await viewport.press("Backspace");
  await expect(current).toHaveText("D:");
  expect(await spaceTaskCount(page)).toBe(3);
  await expect(page.locator("[data-workspace-mode]")).toHaveAttribute("data-workspace-mode", "space");
});

test("space Alt arrows follow history across branches and a fresh drill clears forward history", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  const current = page.locator('.breadcrumb-address__segment button[aria-current="page"]');
  const selected = region.getByRole("heading", { level: 2 });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 50, y: 50 } });
  await expect(selected).toHaveText("Projects");
  await viewport.press("Alt+ArrowLeft");
  await viewport.press("Alt+ArrowRight");
  await expect(current).toHaveText("Muller");
  await expect(selected).toHaveText("Projects");
  expect(await spaceTaskCount(page)).toBe(1);

  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [1500, 500], true);
  await expect(current).toHaveText("Projects");
  await viewport.press("Alt+ArrowLeft");
  await expect(current).toHaveText("Muller");
  await viewport.press("Alt+ArrowRight");
  await expect(current).toHaveText("Projects");
  await viewport.press("Backspace");
  await expect(current).toHaveText("Muller");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("Space viewport is unavailable");
  await viewport.dblclick({ position: { x: bounds.width - 20, y: bounds.height - 20 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(3);
  await publishSpaceBatch(page, 2, [6000, 2000], true);
  await expect(current).toHaveText("Media");
  await viewport.press("Alt+ArrowLeft");
  await expect(current).toHaveText("Muller");
  // The preceding location is Projects even though it is a sibling of Media.
  await viewport.press("Alt+ArrowLeft");
  await expect(current).toHaveText("Projects");
  await viewport.press("Alt+ArrowRight");
  await expect(current).toHaveText("Muller");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(4);
  await publishSpaceBatch(page, 3, [750, 250], true);
  await expect(current).toHaveText("Projects");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 50, y: 50 } });
  await expect(selected).toHaveText("Projects");
  await viewport.press("Alt+ArrowRight");
  await expect(current).toHaveText("Projects");
  await expect(selected).toHaveText("Projects");
  expect(await spaceTaskCount(page)).toBe(4);
  await expect(page.locator("[data-workspace-mode]")).toHaveAttribute("data-workspace-mode", "space");
});

test("space navigation preserves text editing, menu focus, and IME composition", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  const current = page.locator('.breadcrumb-address__segment button[aria-current="page"]');
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [1500, 500], true);
  await expect(current).toHaveText("Projects");

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox");
  await expect(input).toBeFocused();
  await input.fill("navigation");
  await input.press("End");
  await input.press("Backspace");
  await expect(input).toHaveValue("navigatio");
  await input.press("Alt+ArrowLeft");
  await input.press("Alt+ArrowRight");
  await expect(current).toHaveText("Projects");
  await expect(dialog).toBeVisible();
  await input.press("Escape");
  await expect(dialog).not.toBeVisible();

  await viewport.dispatchEvent("keydown", { key: "Backspace", isComposing: true, bubbles: true });
  await viewport.dispatchEvent("keydown", { key: "ArrowLeft", altKey: true, isComposing: true, bubbles: true });
  await expect(current).toHaveText("Projects");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ button: "right", position: { x: 50, y: 50 } });
  const menu = region.getByRole("menu");
  const menuItem = menu.getByRole("menuitem").first();
  await expect(menu).toBeVisible();
  await menuItem.focus();
  for (const key of ["Backspace", "Alt+ArrowLeft", "Alt+ArrowRight"]) {
    await menuItem.press(key);
    await expect(current).toHaveText("Projects");
    await expect(menuItem).toBeFocused();
  }
  expect(await spaceTaskCount(page)).toBe(2);
  await menuItem.press("Escape");
  await expect(menu).not.toBeVisible();
  await viewport.press("Backspace");
  await expect(current).toHaveText("Muller");
});

test("space Alt navigation does not resize details and works from Smaller items focus", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  const current = page.locator('.breadcrumb-address__segment button[aria-current="page"]');
  const separator = region.getByRole("separator");
  const detailsWidth = () => region.locator(".space-sniffer__details").evaluate((element) => element.getBoundingClientRect().width);
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [1_000_000_000, 1], true);
  await expect(current).toHaveText("Projects");
  const originalWidth = await detailsWidth();
  await separator.press("Alt+ArrowLeft");
  await expect(current).toHaveText("Muller");
  expect(await detailsWidth()).toBe(originalWidth);
  await separator.press("Alt+ArrowRight");
  await expect(current).toHaveText("Projects");
  expect(await detailsWidth()).toBe(originalWidth);
  await separator.press("ArrowLeft");
  await expect.poll(detailsWidth).toBe(originalWidth + 16);
  await separator.press("ArrowRight");
  await expect.poll(detailsWidth).toBe(originalWidth);

  await region.getByRole("button", { name: /^Smaller items/ }).click();
  const smallItem = region.locator(".space-sniffer__group-list").getByRole("button", { name: "Media 1 B" });
  await smallItem.click();
  await expect(smallItem).toBeFocused();
  await smallItem.press("Alt+ArrowLeft");
  await expect(current).toHaveText("Muller");
  await viewport.press("Alt+ArrowRight");
  await expect(current).toHaveText("Projects");
  await region.getByRole("button", { name: /^Smaller items/ }).click();
  await smallItem.click();
  await smallItem.press("Backspace");
  await expect(current).toHaveText("Muller");
  expect(await spaceTaskCount(page)).toBe(2);
  await expect(page.locator("[data-workspace-mode]")).toHaveAttribute("data-workspace-mode", "space");
});

test("space history navigation cancels live scans and ignores late results from departed folders", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  const current = page.locator('.breadcrumb-address__segment button[aria-current="page"]');
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000]);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [1500, 500]);
  await expect(canvas).toHaveAttribute("data-area-bytes", "2000");
  await viewport.press("Alt+ArrowLeft");
  await expect(current).toHaveText("Muller");
  await expect.poll(() => spaceTaskCount(page)).toBe(3);
  await publishSpaceBatch(page, 2, [3000, 1000], true);
  await expect(canvas).toHaveAttribute("data-area-bytes", "4000");
  await publishSpaceBatch(page, 1, [8_000_000, 2_000_000], true);
  await expect(current).toHaveText("Muller");
  await expect(canvas).toHaveAttribute("data-area-bytes", "4000");
  await viewport.press("Alt+ArrowRight");
  await expect(current).toHaveText("Projects");
  await expect.poll(() => spaceTaskCount(page)).toBe(4);
  await publishSpaceBatch(page, 3, [750, 250]);
  await publishSpaceBatch(page, 0, [80_000_000, 20_000_000], true);
  await expect(current).toHaveText("Projects");
  await expect(canvas).toHaveAttribute("data-area-bytes", "1000");
  await expect(region.getByRole("status")).toHaveText("Scanning");
  await publishSpaceBatch(page, 3, [1500, 500], true);
  await expect(canvas).toHaveAttribute("data-area-bytes", "2000");
  await expect(region.getByRole("status")).toHaveText("Scan complete");
  const cancellation = await page.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream;
    return { cancelled: state.cancelled, departed: state.tasks.slice(0, 2).map((task) => task.id) };
  });
  expect(cancellation.cancelled).toEqual(expect.arrayContaining(cancellation.departed));
});

test("space sidebar folder changes participate in Alt history without changing the view mode", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  const current = page.locator('.breadcrumb-address__segment button[aria-current="page"]');
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [1500, 500], true);
  await expect(current).toHaveText("Projects");
  // Returning to the original scan root is still navigation when its prop path
  // has not changed during local drill-in.
  await page.locator('.classic-tree-label[data-drop-directory="D:\\\\Muller"]').click();
  await expect.poll(() => spaceTaskCount(page)).toBe(3);
  await publishSpaceBatch(page, 2, [900_000, 100_000], true);
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
  await viewport.press("Alt+ArrowLeft");
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller\\Projects");
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  await expect.poll(() => spaceTaskCount(page)).toBe(4);
  await publishSpaceBatch(page, 3, [6000, 2000], true);
  await expect(current).toHaveText("Desktop");
  await viewport.press("Alt+ArrowLeft");
  await expect(current).toHaveText("Projects");
  await expect(canvas).toHaveAttribute("data-area-bytes", "2000");
  await viewport.press("Alt+ArrowRight");
  await expect(current).toHaveText("Desktop");
  await expect(canvas).toHaveAttribute("data-area-bytes", "8000");
  expect(await spaceTaskCount(page)).toBe(4);
  await expect(page.locator("[data-workspace-mode]")).toHaveAttribute("data-workspace-mode", "space");
});

test("space top address editing and navigation buttons share keyboard history", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const address = page.getByRole("combobox", { name: "Current directory" });
  const current = page.locator('.breadcrumb-address__segment button[aria-current="page"]');
  const back = page.locator(".nav-actions").getByRole("button", { name: "Back", exact: true });
  const forward = page.locator(".nav-actions").getByRole("button", { name: "Forward", exact: true });
  const up = page.locator(".nav-actions").getByRole("button", { name: /Up|Parent/i });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();
  await page.keyboard.press("Control+l");
  await expect(address).toBeFocused();
  await address.fill("D:\\Draft");
  await expect(page.getByRole("listbox")).toBeVisible();
  await address.press("Escape");
  await expect(page.getByRole("listbox")).not.toBeVisible();
  await expect(address).toBeFocused();
  await address.press("Escape");
  await expect(current).toHaveAttribute("title", "D:\\Muller");
  await page.keyboard.press("Control+l");
  await expect(address).toHaveValue("D:\\Muller");
  await address.fill("D:\\Unsubmitted");
  await viewport.click({ position: { x: 50, y: 50 } });
  await expect(current).toHaveAttribute("title", "D:\\Muller");
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
  expect(await spaceTaskCount(page)).toBe(1);
  await page.keyboard.press("Control+l");
  await address.fill("D:\\Desktop");
  await address.press("Enter");
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [6000, 2000], true);
  await expect(region).toHaveAttribute("data-root-path", "D:\\Desktop");
  await expect(current).toHaveAttribute("title", "D:\\Desktop");
  await back.click();
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
  await forward.click();
  await expect(region).toHaveAttribute("data-root-path", "D:\\Desktop");
  await up.click();
  await expect.poll(() => spaceTaskCount(page)).toBe(3);
  await publishSpaceBatch(page, 2, [3000, 1000], true);
  await expect(region).toHaveAttribute("data-root-path", "D:\\");
  await expect(up).toBeDisabled();
  await viewport.press("Alt+ArrowLeft");
  await expect(region).toHaveAttribute("data-root-path", "D:\\Desktop");
  await page.keyboard.press("Control+l");
  await address.fill("D:\\Muller");
  await address.press("Enter");
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
  await expect(current).toHaveAttribute("title", "D:\\Muller");
  await expect(forward).toBeDisabled();
  expect(await spaceTaskCount(page)).toBe(3);
  await expect(region.getByRole("navigation", { name: "Folder path" })).toHaveCount(0);
  await expect(page.locator("[data-workspace-mode]")).toHaveAttribute("data-workspace-mode", "space");
});

test("space folder preview opens by button and Space and closes without navigating", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const preview = region.getByRole("complementary", { name: "File preview" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 50, y: 50 } });
  await region.locator(".space-sniffer__preview-button").click();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveClass(/preview-panel--embedded/);
  await expect(preview.locator(".preview-folder__size")).toContainText("6.1 KB");
  await expect(preview.locator(".preview-details")).not.toHaveAttribute("open", "");
  await preview.locator(".preview-details summary").click();
  await expect(preview.locator(".preview-metadata")).toContainText("D:\\Muller\\Projects");
  await preview.getByRole("button", { name: "Close preview", exact: true }).click();
  await expect(preview).not.toBeVisible();
  await expect(viewport).toBeFocused();
  await viewport.press("Space");
  await expect(preview).toBeVisible();
  await viewport.press("Space");
  await expect(preview).not.toBeVisible();
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
});

test("space file preview follows selection and ignores a late previous response", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const preview = region.getByRole("complementary", { name: "File preview" });
  const previewIndexes = (path: string) => page.evaluate((targetPath) => {
    const state = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream;
    return state.previews.flatMap((task, index) => task.root === targetPath ? [index] : []);
  }, path);
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true, "file");
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 50, y: 50 } });
  await viewport.press("Space");
  await expect.poll(async () => (await previewIndexes("D:\\Muller\\Projects")).length).toBeGreaterThan(0);
  const previousIndexes = await previewIndexes("D:\\Muller\\Projects");
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("Space viewport is unavailable");
  await viewport.click({ position: { x: bounds.width - 20, y: bounds.height - 20 } });
  await expect.poll(async () => (await previewIndexes("D:\\Muller\\Media")).length).toBeGreaterThan(0);
  const currentIndexes = await previewIndexes("D:\\Muller\\Media");
  await expect(preview.locator(".preview-file-heading__identity strong")).toHaveText("Media");
  await publishPreview(page, currentIndexes.at(-1)!, "The current file is Media.");
  await expect(preview).toContainText("The current file is Media.");
  for (const index of previousIndexes) await publishPreview(page, index, "Late Projects response must be ignored.");
  await expect(preview).not.toContainText("Late Projects response must be ignored.");
  await expect(preview).toContainText("The current file is Media.");
  await expect.poll(() => page.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream;
    return state.previews.filter((task) => task.root === "D:\\Muller\\Projects").every((task) => state.cancelledPreviews.includes(task.id));
  })).toBe(true);
  await preview.getByRole("button", { name: "Close preview", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(preview).not.toBeVisible();
  await expect(viewport).toBeFocused();
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
});

test("space tabs restore their own directory without sharing another tab path", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [1500, 500], true);
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller\\Projects");
  await page.keyboard.press("Control+t");
  await page.getByRole("button", { name: "Space map", exact: true }).click();
  await expect.poll(() => spaceTaskCount(page)).toBe(3);
  await publishSpaceBatch(page, 2, [1500, 500], true);
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  await expect.poll(() => spaceTaskCount(page)).toBe(4);
  await publishSpaceBatch(page, 3, [6000, 2000], true);
  await expect(region).toHaveAttribute("data-root-path", "D:\\Desktop");
  const tabs = page.locator(".workspace-tab");
  await expect(tabs).toHaveCount(2);
  await tabs.first().click();
  await expect.poll(() => spaceTaskCount(page)).toBe(5);
  await publishSpaceBatch(page, 4, [1500, 500], true);
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller\\Projects");
  await tabs.last().click();
  await expect.poll(() => spaceTaskCount(page)).toBe(6);
  await publishSpaceBatch(page, 5, [6000, 2000], true);
  await expect(region).toHaveAttribute("data-root-path", "D:\\Desktop");
  await expect(page.locator('.breadcrumb-address__segment button[aria-current="page"]')).toHaveAttribute("title", "D:\\Desktop");
});

test("Space on a focused Smaller item previews that row instead of the previous selection", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const preview = region.getByRole("complementary", { name: "File preview" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [1_000_000_000, 1], true);
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  await region.getByRole("button", { name: /^Smaller items/ }).click();
  await viewport.press("ArrowLeft");
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Projects");
  const smallItem = region.locator(".space-sniffer__group-list").getByRole("button", { name: "Media 1 B" });
  await smallItem.focus();
  await smallItem.press("Space");
  await expect(preview).toBeVisible();
  await expect(preview.locator(".preview-file-heading__identity strong")).toHaveText("Media");
  await expect(smallItem).toHaveAttribute("aria-pressed", "true");
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Media");
  await smallItem.press("Space");
  await expect(preview).not.toBeVisible();
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
});
