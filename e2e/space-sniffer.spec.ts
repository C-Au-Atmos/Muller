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

test("largest-folder thumbnails render two real levels, stay read-only, and persist the configured count", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installSpaceStreamMock(page);
  await page.addInitScript(() => {
    const runtime = window as unknown as { __previewDrawn: { text: string; x: number; y: number }[] };
    runtime.__previewDrawn = [];
    // Preserve the browser renderer while observing the exact labels it paints.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      runtime.__previewDrawn.push({ text, x, y });
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Space map", exact: true }).click();
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const canvas = region.locator("canvas");
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const countMenu = region.getByRole("combobox", { name: "Largest folder previews" });
  const rootPath = await region.getAttribute("data-root-path");
  await expect(countMenu).toHaveValue("1");
  await page.evaluate(() => {
    const task = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.tasks[0];
    const items = ["Projects", "Media", "Archive"].map((name, index) => ({ path: `${task.root}\\${name}`, parent: task.root, name, kind: "directory", bytes: 6000 - index * 1000, depth: 1, childCount: 2, partial: false, scanning: true }));
    task.channel.onmessage({ type: "batch", taskId: task.id, items, totalBytes: 15000, fileCount: 0, directoryCount: 3 });
  });
  await expect(canvas).toHaveAttribute("data-visible-count", "3");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await expect(canvas).toHaveAttribute("data-preview-count", "0");
  const before = await canvas.screenshot();
  await page.evaluate(() => {
    const task = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.tasks[0];
    const items = ["Projects", "Media", "Archive"].flatMap((name, index) => {
      const folder = `${task.root}\\${name}`;
      const bytes = 6000 - index * 1000;
      return [
        { path: `${folder}\\Level one`, parent: folder, name: "Level one", kind: "directory", bytes: bytes * .6, depth: 2, childCount: 1, partial: false },
        { path: `${folder}\\Direct.txt`, parent: folder, name: "Direct.txt", kind: "file", bytes: bytes * .4, depth: 2, childCount: 0, partial: false },
        { path: `${folder}\\Level one\\Second.txt`, parent: `${folder}\\Level one`, name: "Second.txt", kind: "file", bytes: bytes * .6, depth: 3, childCount: 0, partial: false },
      ];
    });
    const root = { path: task.root, parent: null, name: "Muller", kind: "directory", bytes: 15000, depth: 0, childCount: 3, partial: false };
    task.channel.onmessage({ type: "batch", taskId: task.id, items, totalBytes: 15000, fileCount: 6, directoryCount: 6 });
    task.channel.onmessage({ type: "done", taskId: task.id, root, totalBytes: 15000, fileCount: 6, directoryCount: 6 });
  });
  await expect(canvas).toHaveAttribute("data-preview-count", "1");
  await expect(canvas).toHaveAttribute("data-preview-depth", "2");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  const drawnNames = () => page.evaluate(() => (window as unknown as { __previewDrawn: { text: string }[] }).__previewDrawn.map((item) => item.text));
  await expect.poll(drawnNames).toContain("Direct.txt");
  await expect.poll(drawnNames).toContain("Level one");
  await expect.poll(drawnNames).toContain("Second.txt");
  const secondLevel = await page.evaluate(() => (window as unknown as { __previewDrawn: { text: string; x: number; y: number }[] }).__previewDrawn.findLast((item) => item.text === "Second.txt")!);
  await viewport.click({ position: { x: secondLevel.x + 2, y: secondLevel.y - 4 } });
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Projects");
  await expect(region).toHaveAttribute("data-root-path", rootPath!);
  expect(await spaceTaskCount(page)).toBe(1);
  await viewport.dblclick({ position: { x: secondLevel.x + 2, y: secondLevel.y - 4 } });
  await expect(region).toHaveAttribute("data-root-path", `${rootPath}\\Projects`);
  await viewport.press("Escape");
  await expect(region).toHaveAttribute("data-root-path", rootPath!);
  await countMenu.selectOption("2");
  await expect(canvas).toHaveAttribute("data-preview-count", "2");
  await countMenu.selectOption("3");
  await expect(canvas).toHaveAttribute("data-preview-count", "3");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await region.screenshot({ path: test.info().outputPath("largest-folder-preview.png") });
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("muller.preferences.v1")!) as { spacePreviewCount: number }).spacePreviewCount)).toBe(3);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  const settingsCount = page.getByRole("radiogroup", { name: "Largest folder previews" });
  await expect(settingsCount.getByRole("radio", { name: "3 folders" })).toHaveAttribute("aria-checked", "true");
  await settingsCount.getByRole("radio", { name: "2 folders" }).click();
  await page.getByRole("button", { name: "Space map", exact: true }).click();
  await expect(countMenu).toHaveValue("2");
});

test("space cache preview stays visible during verification and switches to the fresh tree at completion", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const canvas = region.locator("canvas");
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await page.evaluate(() => {
    const task = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.tasks[0];
    task.channel.onmessage({ type: "cached", taskId: task.id, items: [{ path: `${task.root}\\Removed.txt`, parent: task.root, name: "Removed.txt", kind: "file", bytes: 1000000, depth: 1, childCount: 0, partial: false }], totalBytes: 1000000 });
  });
  await expect(region.getByRole("status")).toHaveText("Cached preview · verifying");
  await expect(canvas).toHaveAttribute("data-area-bytes", "1000000");
  await expect(canvas).toHaveAttribute("data-visible-count", "1");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  const viewport = region.getByRole("application", { name: "Folder space map" });
  await viewport.click({ position: { x: 100, y: 100 } });
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Removed.txt");
  await region.locator(".space-sniffer__preview-button").click();
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.previews.length)).toBeGreaterThan(0);
  await expect(region.locator(".preview-panel")).toBeVisible();
  await viewport.click({ button: "right", position: { x: 100, y: 100 } });
  await expect(region.getByRole("menu")).toBeVisible();
  await publishSpaceBatch(page, 0, [1_600_000, 400_000]);
  await expect(region.locator(".space-sniffer__scan-state")).toHaveText("Cached preview · verifying");
  await expect(canvas).toHaveAttribute("data-area-bytes", "1000000");
  await publishSpaceBatch(page, 0, [1_600_000, 400_000], true);
  await expect(region.locator(".space-sniffer__scan-state")).toHaveText("Scan complete");
  await expect(canvas).toHaveAttribute("data-area-bytes", "2000000");
  await expect(canvas).toHaveAttribute("data-visible-count", "2");
  await expect(region.getByRole("heading", { level: 2 })).toHaveCount(0);
  await expect(region.getByRole("menu")).toHaveCount(0);
  await expect(region.locator(".preview-panel")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream;
    return state.previews.every((task) => state.cancelledPreviews.includes(task.id));
  })).toBe(true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 100, y: 100 } });
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Projects");
  await expect(region.locator(".space-sniffer__preview-button")).toHaveAttribute("aria-pressed", "false");
});

interface SpaceMockChannel { onmessage: (message: unknown) => void; }
interface SpaceMockTask { id: number; root: string; channel: SpaceMockChannel; }
interface SpaceMockRuntime { tasks: SpaceMockTask[]; cancelled: number[]; previews: SpaceMockTask[]; cancelledPreviews: number[]; statisticsPaths: string[]; audioStarts: number; }

async function installSpaceStreamMock(page: import("@playwright/test").Page, audioEnabled = false) {
  await page.addInitScript(({ initialAudioEnabled }) => {
    localStorage.clear();
    localStorage.setItem("muller.preferences.v1", JSON.stringify({ version: 1, locale: "en-US", theme: "platinum", audioEnabled: initialAudioEnabled, motion: "full" }));
    const state: SpaceMockRuntime = { tasks: [], cancelled: [], previews: [], cancelledPreviews: [], statisticsPaths: [], audioStarts: 0 };
    if (initialAudioEnabled) {
      class AudioParamMock {
        value = 0;
        setTargetAtTime() {}
        setValueAtTime() {}
        exponentialRampToValueAtTime() {}
      }
      class AudioNodeMock { connect() { return this; } }
      class AudioContextMock {
        currentTime = 0;
        destination = new AudioNodeMock();
        createGain() { return Object.assign(new AudioNodeMock(), { gain: new AudioParamMock() }); }
        createDynamicsCompressor() {
          return Object.assign(new AudioNodeMock(), {
            threshold: new AudioParamMock(), knee: new AudioParamMock(), ratio: new AudioParamMock(),
            attack: new AudioParamMock(), release: new AudioParamMock(),
          });
        }
        createOscillator() {
          return Object.assign(new AudioNodeMock(), {
            type: "sine", frequency: new AudioParamMock(),
            start: () => { state.audioStarts += 1; }, stop() {},
          });
        }
        createBiquadFilter() { return Object.assign(new AudioNodeMock(), { type: "lowpass", frequency: new AudioParamMock() }); }
        resume() { return Promise.resolve(); }
        close() { return Promise.resolve(); }
      }
      Object.defineProperty(window, "AudioContext", { configurable: true, value: AudioContextMock });
    }
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
  }, { initialAudioEnabled: audioEnabled });
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

async function openStreamSpace(page: import("@playwright/test").Page, audioEnabled = false) {
  await installSpaceStreamMock(page, audioEnabled); await page.goto("/");
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
  let stopped = await canvas.screenshot();
  // Stop changes the toolbar and may deliver a final ResizeObserver repaint.
  // Capture stable pixels before checking that late scanner events are ignored.
  await expect.poll(async () => {
    await expect(canvas).toHaveAttribute("data-animation-state", "settled");
    const current = await canvas.screenshot();
    const stable = current.equals(stopped);
    stopped = current;
    return stable;
  }).toBe(true);
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
  await viewport.click({ button: "right", position: { x: box!.width - 20, y: box!.height / 2 } });
  const menu = region.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeVisible();
  const expectInsideMap = async () => {
    // Read both rectangles in one layout snapshot; resize delivery is asynchronous.
    await expect.poll(() => menu.evaluate((element) => {
      const own = element.getBoundingClientRect();
      const map = element.closest(".space-sniffer__viewport")!.getBoundingClientRect();
      return Math.min(own.left - map.left, own.top - map.top, map.right - own.right, map.bottom - own.bottom);
    })).toBeGreaterThanOrEqual(7.5);
  };
  await expectInsideMap();
  await page.setViewportSize({ width: 1100, height: 640 });
  await expectInsideMap();
  await region.getByRole("separator").press("ArrowLeft");
  await expectInsideMap();
  await menu.getByRole("menuitem").first().press("End");
  await expect(menu.getByRole("menuitem", { name: "Properties", exact: true })).toBeInViewport();
  expect(await viewport.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual([0, 0]);
  await region.screenshot({ path: test.info().outputPath("space-context-menu-resized.png") });
  await viewport.press("Escape"); await expect(region.getByRole("menu")).not.toBeVisible();
});

test("space file shortcuts copy, paste into the current directory, rename, recycle, and refresh", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  await page.evaluate(() => {
    const runtime = window as unknown as { __spaceOperations: { command: string; payload: unknown }[]; __TAURI_INTERNALS__: { invoke: (command: string, payload: unknown) => unknown } };
    runtime.__spaceOperations = [];
    const original = runtime.__TAURI_INTERNALS__.invoke;
    runtime.__TAURI_INTERNALS__.invoke = (command, payload) => {
      if (["transfer_entry", "rename_entry", "recycle_entry"].includes(command)) {
        runtime.__spaceOperations.push({ command, payload });
        return Promise.resolve({});
      }
      return original(command, payload);
    };
  });
  const operations = () => page.evaluate(() => (window as unknown as { __spaceOperations: { command: string; payload: unknown }[] }).__spaceOperations);
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 50, y: 50 } });
  await viewport.press("Control+c");
  await viewport.press("Control+v");
  await expect.poll(operations).toEqual([{ command: "transfer_entry", payload: { request: { taskId: expect.any(Number), source: "D:\\Muller\\Projects", destinationDirectory: "D:\\Muller", mode: "copy", conflict: "fail" } } }]);
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 50, y: 50 } });
  page.once("dialog", (dialog) => dialog.accept("Renamed"));
  await viewport.press("F2");
  await expect.poll(operations).toHaveLength(2);
  expect((await operations())[1]).toEqual({ command: "rename_entry", payload: { request: { source: "D:\\Muller\\Projects", newName: "Renamed", conflict: "fail" } } });
  await expect.poll(() => spaceTaskCount(page)).toBe(3);
  await publishSpaceBatch(page, 2, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 50, y: 50 } });
  page.once("dialog", (dialog) => dialog.accept());
  await viewport.press("Delete");
  await expect.poll(operations).toHaveLength(3);
  expect((await operations())[2]).toMatchObject({ command: "recycle_entry", payload: { expectation: { path: "D:\\Muller\\Projects", kind: "directory" } } });
  await expect.poll(() => spaceTaskCount(page)).toBe(4);
  await publishSpaceBatch(page, 3, [900_000, 100_000], true);
  await viewport.press("F5");
  await expect.poll(() => spaceTaskCount(page)).toBe(5);
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
});

test("space menu scrolls within the map and Smaller item operations do not affect preview controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [1_000_000_000, 1], true);
  await region.getByRole("button", { name: /^Smaller items/ }).click();
  const row = region.locator(".space-sniffer__group-list").getByRole("button", { name: "Media 1 B" });
  await row.click({ button: "right" });
  const menu = region.getByRole("menu");
  await expect(menu).toBeVisible();
  const bounds = await menu.evaluate((element) => {
    const own = element.getBoundingClientRect();
    const map = element.closest(".space-sniffer__viewport")!.getBoundingClientRect();
    return { left: own.left - map.left, top: own.top - map.top, right: map.right - own.right, bottom: map.bottom - own.bottom, scrollable: element.scrollHeight > element.clientHeight };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(7.5);
  expect(bounds.top).toBeGreaterThanOrEqual(7.5);
  expect(bounds.right).toBeGreaterThanOrEqual(7.5);
  expect(bounds.bottom).toBeGreaterThanOrEqual(7.5);
  expect(bounds.scrollable).toBe(true);
  await menu.getByRole("menuitem").first().press("End");
  await expect(menu.getByRole("menuitem", { name: "Properties", exact: true })).toBeFocused();
  await expect(menu.getByRole("menuitem", { name: "Properties", exact: true })).toBeInViewport();
  expect(await viewport.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft }))).toEqual({ top: 0, left: 0 });
  await page.keyboard.press("Escape");
  await expect(viewport).toBeFocused();
  await row.click();
  await row.press("Space");
  const preview = region.getByRole("complementary", { name: "File preview" });
  await expect(preview).toBeVisible();
  let dialogCount = 0;
  page.on("dialog", (dialog) => { dialogCount += 1; void dialog.dismiss(); });
  const close = preview.getByRole("button", { name: "Close preview", exact: true });
  await close.press("Delete");
  await close.press("F2");
  await close.press("Control+x");
  expect(dialogCount).toBe(0);
  await expect(preview).toBeVisible();
  expect(await spaceTaskCount(page)).toBe(1);
});

test("space properties reuses Browse details and keeps file shortcuts outside the dialog", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ button: "right", position: { x: 50, y: 50 } });
  await region.getByRole("menuitem", { name: "Properties", exact: true }).click();
  const properties = page.getByRole("dialog", { name: "Properties", exact: true });
  await expect(properties).toBeVisible();
  await expect(properties.getByText("Projects", { exact: true })).toBeVisible();
  await expect(properties.getByText("6.1 KB", { exact: true })).toBeVisible();
  await expect(properties.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  let nativeDialogs = 0;
  page.on("dialog", async (dialog) => { nativeDialogs += 1; await dialog.dismiss(); });
  await page.keyboard.press("Delete");
  await page.keyboard.press("F2");
  await page.keyboard.press("Control+x");
  await expect(properties).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(properties).toHaveCount(0);
  await expect(viewport).toBeFocused();
  expect(nativeDialogs).toBe(0);
});

test("space menu surfaces native and clipboard failures and extracts into a chosen folder", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await page.evaluate(() => {
    const runtime = window as unknown as { __spaceOperations: { command: string; payload: unknown }[]; __TAURI_INTERNALS__: { invoke: (command: string, payload: unknown) => unknown } };
    runtime.__spaceOperations = [];
    const original = runtime.__TAURI_INTERNALS__.invoke;
    runtime.__TAURI_INTERNALS__.invoke = (command, payload) => {
      if (command === "open_native_path" || command === "open_terminal") return Promise.reject(new Error("Native access denied"));
      if (command === "plugin:dialog|open") {
        runtime.__spaceOperations.push({ command, payload });
        return Promise.resolve("D:\\Extracted");
      }
      if (command === "extract_zip") {
        runtime.__spaceOperations.push({ command, payload });
        return Promise.resolve("D:\\Extracted");
      }
      return original(command, payload);
    };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("Clipboard access denied")) } });
    const task = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.tasks[0];
    const root = { path: task.root, parent: null, name: "Muller", kind: "directory", bytes: 900_000, depth: 0, childCount: 1, partial: false };
    const archive = { path: `${task.root}\\Bundle.zip`, parent: task.root, name: "Bundle.zip", kind: "file", bytes: 900_000, depth: 1, childCount: 0, partial: false };
    task.channel.onmessage({ type: "batch", taskId: task.id, items: [archive, root], totalBytes: 900_000, fileCount: 1, directoryCount: 1 });
    task.channel.onmessage({ type: "done", taskId: task.id, root, totalBytes: 900_000, fileCount: 1, directoryCount: 1 });
  });
  await expect(region.locator("canvas")).toHaveAttribute("data-animation-state", "settled");
  for (const name of ["Open", "Open with…", "Open in terminal", "Copy file name", "Copy full path · 复制路径"]) {
    await viewport.click({ button: "right", position: { x: 50, y: 50 } });
    await region.getByRole("menuitem", { name, exact: true }).click();
    await expect(region.getByRole("alert")).toHaveText(name.startsWith("Copy") ? "Clipboard access denied" : "Native access denied");
  }
  await viewport.click({ button: "right", position: { x: 50, y: 50 } });
  await region.getByRole("menuitem", { name: "Choose extraction folder…", exact: true }).click();
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  const operations = await page.evaluate(() => (window as unknown as { __spaceOperations: { command: string; payload: unknown }[] }).__spaceOperations);
  expect(operations).toEqual([
    { command: "plugin:dialog|open", payload: { options: { directory: true, multiple: false, defaultPath: "D:\\Muller", title: "Choose extraction destination" } } },
    { command: "extract_zip", payload: { request: { taskId: expect.any(Number), archive: "D:\\Muller\\Bundle.zip", destinationDirectory: "D:\\Extracted", mode: "current" } } },
  ]);
  await expect(region.getByRole("alert")).toHaveCount(0);
});

test("space cut uses the shared clipboard and clears it after a successful move", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  await page.evaluate(() => {
    const runtime = window as unknown as { __spaceTransfers: unknown[]; __TAURI_INTERNALS__: { invoke: (command: string, payload: unknown) => unknown } };
    runtime.__spaceTransfers = [];
    const original = runtime.__TAURI_INTERNALS__.invoke;
    runtime.__TAURI_INTERNALS__.invoke = (command, payload) => {
      if (command === "transfer_entry") { runtime.__spaceTransfers.push(payload); return Promise.resolve({}); }
      return original(command, payload);
    };
  });
  const transfers = () => page.evaluate(() => (window as unknown as { __spaceTransfers: unknown[] }).__spaceTransfers);
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ position: { x: 50, y: 50 } });
  await viewport.press("Control+x");
  const bounds = await viewport.boundingBox();
  await viewport.dblclick({ position: { x: bounds!.width - 20, y: bounds!.height - 20 } });
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await publishSpaceBatch(page, 1, [750, 250], true);
  await viewport.press("Control+v");
  await expect.poll(transfers).toEqual([{ request: { taskId: expect.any(Number), source: "D:\\Muller\\Projects", destinationDirectory: "D:\\Muller\\Media", mode: "move", conflict: "fail" } }]);
  await expect.poll(() => spaceTaskCount(page)).toBe(3);
  await publishSpaceBatch(page, 2, [1500, 500], true);
  await viewport.press("Control+v");
  expect(await transfers()).toHaveLength(1);
});

test("space right-click preserves a real multi-selection and never operates the aggregate tile", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  const viewport = region.getByRole("application", { name: "Folder space map" });
  const canvas = region.locator("canvas");
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [900_000, 100_000], true);
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.press("Control+a");
  await viewport.click({ button: "right", position: { x: 50, y: 50 } });
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("2 items");
  await expect(region.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await viewport.press("F5");
  await expect.poll(() => spaceTaskCount(page)).toBe(2);
  await page.evaluate(() => {
    const task = (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.tasks[1];
    const root = { path: task.root, parent: null, name: "Muller", kind: "directory", bytes: 400, depth: 0, childCount: 400, partial: false, scanning: false };
    const items = Array.from({ length: 400 }, (_, index) => ({ path: `${task.root}/${index}`, parent: task.root, name: `Item ${index}`, kind: "file", bytes: 1, depth: 1, childCount: 0, partial: false, scanning: false }));
    task.channel.onmessage({ type: "batch", taskId: task.id, items: [...items, root], totalBytes: 400, fileCount: 400, directoryCount: 1, skippedCount: 0 });
    task.channel.onmessage({ type: "done", taskId: task.id, root, totalBytes: 400, fileCount: 400, directoryCount: 1, skippedCount: 0 });
  });
  await expect(canvas).toHaveAttribute("data-area-bytes", "400");
  await expect(canvas).toHaveAttribute("data-animation-state", "settled");
  await viewport.click({ button: "right", position: { x: 50, y: 50 } });
  await expect(region.getByRole("menu")).not.toBeVisible();
  await region.getByRole("button", { name: /^Smaller items/ }).click();
  await region.getByRole("button", { name: /^Smaller items/ }).click();
  let dialogCount = 0;
  page.on("dialog", (dialog) => { dialogCount += 1; void dialog.dismiss(); });
  await viewport.press("Delete");
  expect(dialogCount).toBe(0);
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Smaller items");
  expect(await spaceTaskCount(page)).toBe(2);
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

test("Smaller item clicks emit one selection sound even when the pointer is held", async ({ page }) => {
  await openStreamSpace(page, true);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [1_000_000_000, 1], true);
  await region.getByRole("button", { name: /^Smaller items/ }).click();
  const row = region.locator(".space-sniffer__group-list").getByRole("button", { name: "Media 1 B" });
  const audioStarts = () => page.evaluate(() => (globalThis as typeof globalThis & { __spaceStream: SpaceMockRuntime }).__spaceStream.audioStarts);
  // An action sound contains two tones. Separate activations by more than
  // its 55 ms rate limit, and hold the pointer to expose pointerdown/click duplication.
  for (const delay of [0, 125]) {
    await page.waitForTimeout(80);
    const before = await audioStarts();
    await row.click({ delay });
    expect(await audioStarts() - before).toBe(2);
    await expect(row).toHaveAttribute("aria-pressed", "true");
  }
  await page.waitForTimeout(80);
  let before = await audioStarts();
  await row.press("Space");
  expect(await audioStarts() - before).toBe(2);
  await expect(region.getByRole("complementary", { name: "File preview" })).toBeVisible();
  // Ordinary buttons continue to use the shared pointer sound.
  await page.waitForTimeout(80);
  before = await audioStarts();
  await region.locator(".space-sniffer__preview-button").click({ delay: 125 });
  expect(await audioStarts() - before).toBe(2);
  await page.waitForTimeout(80);
  before = await audioStarts();
  await region.getByRole("application", { name: "Folder space map" }).press("ArrowLeft");
  expect(await audioStarts() - before).toBe(2);
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Projects");
});

test("Smaller item details return to their group without changing the directory or rescanning", async ({ page }) => {
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [1_000_000_000, 1], true);
  await region.getByRole("button", { name: /^Smaller items/ }).click();
  const row = region.locator(".space-sniffer__group-list").getByRole("button", { name: "Media 1 B" });
  const back = region.getByRole("button", { name: "Back to smaller items" });
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Smaller items");
  await expect(back).not.toBeVisible();
  await row.click();
  await expect(back).toBeVisible();
  await row.press("Space");
  await expect(region.getByRole("complementary", { name: "File preview" })).toBeVisible();
  await back.press("Enter");
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Smaller items");
  await expect(region.getByRole("complementary", { name: "File preview" })).not.toBeVisible();
  await expect(back).not.toBeVisible();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(region.getByRole("application", { name: "Folder space map" })).toBeFocused();
  await region.getByRole("application", { name: "Folder space map" }).press("Enter");
  await expect(region).toHaveAttribute("data-root-path", "D:\\Muller");
  expect(await spaceTaskCount(page)).toBe(1);
  await row.click();
  await expect(back).toBeVisible();
  await expect(region.getByRole("heading", { level: 2 })).toHaveText("Media");
});

test("Smaller item names and MB sizes keep clear insets at narrow and wide detail widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStreamSpace(page);
  const region = page.getByRole("region", { name: "Space Sniffer" });
  await expect.poll(() => spaceTaskCount(page)).toBe(1);
  await publishSpaceBatch(page, 0, [1_000_000_000_000, 1_234_567], true, "file");
  await region.getByRole("button", { name: /^Smaller items/ }).click();
  const row = region.locator(".space-sniffer__group-list").getByRole("button", { name: "Media 1.2 MB" });
  await row.click();
  const separator = region.getByRole("separator");
  for (const width of [180, 248, 460]) {
    await separator.dblclick();
    for (let index = 0; index < Math.ceil(Math.abs(width - 248) / 16); index += 1) {
      await separator.press(width < 248 ? "ArrowRight" : "ArrowLeft");
    }
    await expect.poll(() => region.locator(".space-sniffer__details").evaluate((element) => element.getBoundingClientRect().width)).toBe(width);
    const bounds = await row.evaluate((element) => {
      const name = element.querySelector("span")!;
      const size = element.querySelector("small")!;
      const rowBounds = element.getBoundingClientRect();
      return {
        leftInset: name.getBoundingClientRect().left - rowBounds.left,
        rightInset: rowBounds.right - size.getBoundingClientRect().right,
        sizeOverflow: size.scrollWidth - size.clientWidth,
        rowOverflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(bounds.leftInset).toBeGreaterThanOrEqual(10);
    expect(bounds.rightInset).toBeGreaterThanOrEqual(10);
    expect(bounds.sizeOverflow).toBeLessThanOrEqual(0);
    expect(bounds.rowOverflow).toBeLessThanOrEqual(0);
    const back = region.getByRole("button", { name: "Back to smaller items" });
    const backBounds = await back.boundingBox();
    const detailsBounds = await region.locator(".space-sniffer__details").boundingBox();
    expect(backBounds!.x + backBounds!.width).toBeLessThanOrEqual(detailsBounds!.x + detailsBounds!.width - 12);
  }
});
