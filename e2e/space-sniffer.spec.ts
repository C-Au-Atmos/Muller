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

  const breadcrumbs = region.getByRole("navigation", { name: "Folder path" }).getByRole("button");
  const rootBreadcrumbCount = await breadcrumbs.count();
  await viewport.dblclick();
  await expect(breadcrumbs).toHaveCount(rootBreadcrumbCount + 1);

  await viewport.press("Escape");
  await expect(breadcrumbs).toHaveCount(rootBreadcrumbCount);
  expect(errors).toEqual([]);
});

test("Space Sniffer restores an intermediate breadcrumb and Escape returns to the scan root", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /空间视图|Space map/ }).click();
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const breadcrumbs = region.getByRole("navigation", { name: "Folder path" });
  const parts = breadcrumbs.locator(".space-sniffer__crumb");
  const current = breadcrumbs.locator('[aria-current="page"]');
  await expect(current).toBeVisible();
  const rootPartCount = await parts.count();
  const rootName = await current.innerText();
  // Ancestors before the scan root must not offer an unsupported return path.
  await expect(breadcrumbs.getByRole("button")).toHaveCount(0);
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");

  await viewport.dblclick();
  await expect(parts).toHaveCount(rootPartCount + 1);
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  const intermediateName = await current.innerText();
  await viewport.dblclick();
  await expect(parts).toHaveCount(rootPartCount + 2);
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  await expect(breadcrumbs.getByRole("button")).toHaveCount(2);
  await viewport.click();
  await expect(region.getByRole("heading", { level: 2 })).toBeVisible();

  await breadcrumbs.getByRole("button").nth(1).click();
  await expect(parts).toHaveCount(rootPartCount + 1);
  await expect(current).toHaveText(intermediateName);
  await expect(region.getByRole("heading", { level: 2 })).not.toBeVisible();
  await expect(viewport).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(parts).toHaveCount(rootPartCount);
  await expect(current).toHaveText(rootName);
  await expect(breadcrumbs.getByRole("button")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(current).toHaveText(rootName);
  expect(errors).toEqual([]);
});

interface SpaceMockChannel { onmessage: (message: unknown) => void; }
interface SpaceMockTask { id: number; root: string; channel: SpaceMockChannel; }
interface SpaceMockRuntime { tasks: SpaceMockTask[]; cancelled: number[]; }

async function installSpaceStreamMock(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("muller.preferences.v1", JSON.stringify({ version: 1, locale: "en-US", theme: "platinum", audioEnabled: false, motion: "full" }));
    const state: SpaceMockRuntime = { tasks: [], cancelled: [] };
    const runtime = globalThis as typeof globalThis & { isTauri: boolean; __spaceStream: SpaceMockRuntime };
    runtime.isTauri = true; runtime.__spaceStream = state;
    let id = 0; let callbackId = 0;
    const tauri = window as unknown as { __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: string } }; transformCallback: () => number; unregisterCallback: () => void;
      invoke: (command: string, payload: { taskId?: number; sessionId?: number; offset?: number; request?: { root?: string; path?: string }; onEvent?: SpaceMockChannel }) => unknown;
    } };
    tauri.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } }, transformCallback: () => ++callbackId, unregisterCallback: () => undefined,
      invoke(command, payload) {
        if (command === "plugin:window|is_maximized") return false;
        if (command === "get_shell_locations") return [{ id: "profile", label: "Profile", path: "D:\\Muller" }];
        if (command === "list_logical_drives" || command === "list_directory_extensions" || command === "complete_directory_path") return [];
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
        return null;
      },
    };
  });
}

async function publishSpaceBatch(page: import("@playwright/test").Page, index: number, weights: [number, number], done = false) {
  await page.evaluate(({ taskIndex, sizes, complete }) => {
    const state = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream;
    const task = state.tasks[taskIndex];
    const totalBytes = sizes[0] + sizes[1];
    const root = { path: task.root, parent: null, name: task.root.split("\\").at(-1), kind: "directory", bytes: totalBytes, depth: 0, childCount: 2, partial: false, scanning: !complete };
    const items = sizes.map((bytes, i) => ({ path: `${task.root}\\${i === 0 ? "Projects" : "Media"}`, parent: task.root, name: i === 0 ? "Projects" : "Media", kind: "directory", bytes, depth: 1, childCount: 4, partial: false, scanning: !complete }));
    task.channel.onmessage({ type: "batch", taskId: task.id, items: [...items, root], totalBytes, fileCount: 8, directoryCount: 3, skippedCount: 0 });
    if (complete) task.channel.onmessage({ type: "done", taskId: task.id, root, totalBytes, fileCount: 8, directoryCount: 3, skippedCount: 0 });
  }, { taskIndex: index, sizes: weights, complete: done });
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
  const breadcrumbs = region.getByRole("navigation", { name: "Folder path" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1); await publishSpaceBatch(page, 0, [800_000, 200_000]);
  await expect(canvas).toHaveAttribute("data-area-bytes", "1000000"); await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.dblclick({ position: { x: 50, y: 50 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText("Projects");
  await publishSpaceBatch(page, 1, [1500, 500]); await expect(canvas).toHaveAttribute("data-area-bytes", "2000");
  await publishSpaceBatch(page, 0, [8_000_000, 2_000_000], true);
  await publishSpaceBatch(page, 1, [1500, 2500]); await expect(canvas).toHaveAttribute("data-area-bytes", "4000");
  await expect(region.getByRole("status")).toHaveText("Scanning"); await expect(breadcrumbs.getByRole("button")).toHaveCount(1);
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
  await expect(region.getByRole("navigation", { name: "Folder path" }).locator('[aria-current="page"]')).toHaveText("Media");
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
