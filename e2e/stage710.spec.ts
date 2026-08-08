import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

interface MockChannel {
  onmessage: (message: unknown) => void;
}

interface MockPayload {
  item?: string[];
  input?: string;
  path?: string;
  onEvent?: MockChannel;
  request?: {
    path?: string;
    generation?: number;
    sessionId?: number;
    sourceSessionId?: number;
    query?: string;
    positions?: number[];
    destinationDirectory?: string;
    mode?: string;
    archive?: string;
    leftPath?: string;
    rightPath?: string;
    leftRoot?: string;
    rightRoot?: string;
    roots?: string[];
    recursive?: boolean;
  };
  sessionId?: number;
  offset?: number;
  query?: string;
  positions?: number[];
}

interface MockState {
  audioStarts: number;
  windowCommands: string[];
  windowMaximized: boolean;
  completionInputs: string[];
  directoryQueries: string[];
  closedSessions: number[];
  locateCalls: { prefix: string; startAfter: number | null }[];
  searchCalls: { sessionId: number; query: string }[];
  expandedSearchCalls: { roots: string[]; query: string; recursive: boolean }[];
  transferRequests: {
    sourceSessionId: number;
    query: string;
    positions: number[];
    destinationDirectory: string;
    mode: string;
  }[];
  extractRequests: { archive: string; destinationDirectory: string; mode: string }[];
  nativeDragPaths: string[][];
  fileDiffRequests: { leftPath: string; rightPath: string }[];
  folderDiffRequests: { leftRoot: string; rightRoot: string }[];
  statisticsPaths: string[];
}

type SidebarPreference = "option" | "line" | "classic";

async function installDesktopMock(
  page: Page,
  sidebarMode: SidebarPreference = "classic",
  hoverDelayMs = 0,
  motion: "full" | "reduced" = "reduced",
  audioEnabled = false,
): Promise<void> {
  await page.addInitScript(({ initialSidebarMode, initialHoverDelayMs, initialMotion, initialAudioEnabled }) => {
    if (window.sessionStorage.getItem("muller.e2e.desktop-initialized") !== "true") {
      window.localStorage.clear();
      window.localStorage.setItem("muller.preferences.v1", JSON.stringify({
        version: 1,
        locale: "en-US",
        theme: "dark",
        density: "compact",
        uiScale: 100,
        sidebarMode: initialSidebarMode,
        audioEnabled: initialAudioEnabled,
        audioVolume: 65,
        lastNonZeroAudioVolume: 65,
        hoverDelayMs: initialHoverDelayMs,
        motion: initialMotion,
      }));
      window.sessionStorage.setItem("muller.e2e.desktop-initialized", "true");
    }

    const entries = [
      { path: "D:\\Muller\\Alpha.txt", name: "Alpha.txt", kind: "file", extension: "txt", size: 128, modifiedUnixMs: 1_720_000_000_000, hidden: false },
      { path: "D:\\Muller\\Alpine.txt", name: "Alpine.txt", kind: "file", extension: "txt", size: 256, modifiedUnixMs: 1_721_000_000_000, hidden: false },
      { path: "D:\\Muller\\Destination", name: "Destination", kind: "directory", extension: null, size: 0, modifiedUnixMs: 1_722_000_000_000, hidden: false },
      { path: "D:\\Muller\\Archive.zip", name: "Archive.zip", kind: "file", extension: "zip", size: 4096, modifiedUnixMs: 1_723_000_000_000, hidden: false },
      { path: "D:\\Muller\\Atlas.txt", name: "Atlas.txt", kind: "file", extension: "txt", size: 512, modifiedUnixMs: 1_724_000_000_000, hidden: false },
    ];
    const state: MockState = {
      audioStarts: 0,
      windowCommands: [],
      windowMaximized: false,
      completionInputs: [],
      directoryQueries: [],
      closedSessions: [],
      locateCalls: [],
      searchCalls: [],
      expandedSearchCalls: [],
      transferRequests: [],
      extractRequests: [],
      nativeDragPaths: [],
      fileDiffRequests: [],
      folderDiffRequests: [],
      statisticsPaths: [],
    };
    if (initialAudioEnabled) {
      class AudioParamMock {
        value = 0;
        setTargetAtTime() {}
        setValueAtTime() {}
        exponentialRampToValueAtTime() {}
      }
      class AudioNodeMock {
        connect() { return this; }
      }
      class AudioContextMock {
        currentTime = 0;
        destination = new AudioNodeMock();
        createGain() {
          return Object.assign(new AudioNodeMock(), { gain: new AudioParamMock() });
        }
        createDynamicsCompressor() {
          return Object.assign(new AudioNodeMock(), {
            threshold: new AudioParamMock(),
            knee: new AudioParamMock(),
            ratio: new AudioParamMock(),
            attack: new AudioParamMock(),
            release: new AudioParamMock(),
          });
        }
        createOscillator() {
          return Object.assign(new AudioNodeMock(), {
            type: "sine",
            frequency: new AudioParamMock(),
            start: () => { state.audioStarts += 1; },
            stop() {},
          });
        }
        createBiquadFilter() {
          return Object.assign(new AudioNodeMock(), {
            type: "lowpass",
            frequency: new AudioParamMock(),
          });
        }
        resume() { return Promise.resolve(); }
        close() { return Promise.resolve(); }
      }
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: AudioContextMock,
      });
    }
    const runtime = globalThis as typeof globalThis & {
      isTauri: boolean;
      __muller710: MockState;
    };
    const tauriWindow = window as unknown as {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: string } };
        transformCallback: (callback?: (message: unknown) => void) => number;
        unregisterCallback: (id: number) => void;
        invoke: (command: string, payload: MockPayload) => unknown;
      };
    };
    const callbacks = new Map<number, (message: unknown) => void>();
    let callbackId = 0;
    let taskId = 0;
    let sessionId = 0;
    const searchEntriesBySession = new Map<number, typeof entries>();
    runtime.isTauri = true;
    runtime.__muller710 = state;

    tauriWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback(callback) {
        const id = ++callbackId;
        if (callback) callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      invoke(command, payload) {
        if (command === "plugin:window|is_maximized") {
          return Promise.resolve(state.windowMaximized);
        }
        if (command === "plugin:window|toggle_maximize") {
          state.windowMaximized = !state.windowMaximized;
          state.windowCommands.push(command);
          window.dispatchEvent(new Event("resize"));
          return Promise.resolve(null);
        }
        if (command === "plugin:window|minimize" || command === "plugin:window|close" || command === "plugin:window|start_dragging") {
          state.windowCommands.push(command);
          return Promise.resolve(null);
        }
        if (command === "plugin:drag|start_drag") {
          state.nativeDragPaths.push(payload.item ?? []);
          return null;
        }
        if (command === "get_shell_locations") {
          return [
            { id: "desktop", label: "Desktop", path: "D:\\Desktop" },
            { id: "downloads", label: "Downloads", path: "D:\\Downloads" },
          ];
        }
        if (command === "list_directory_extensions") {
          return [{ extension: "txt", count: 3 }, { extension: "zip", count: 1 }];
        }
        if (command === "list_logical_drives") return [{
          path: "D:\\",
          label: "Local Disk",
          fileSystem: "NTFS",
          driveType: "fixed",
          totalBytes: 1_000_000,
          freeBytes: 500_000,
        }];
        if (command === "complete_directory_path") {
          state.completionInputs.push(payload.input ?? "");
          return payload.input?.toLocaleLowerCase() === "d:\\" ? ["D:\\Projects"] : [];
        }
        if (command === "start_directory_query") {
          const nextTaskId = ++taskId;
          const nextSessionId = ++sessionId;
          const path = payload.request?.path ?? "D:\\Muller";
          state.directoryQueries.push(path);
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId: nextTaskId });
            if (path.toLocaleLowerCase() === "d:\\muller\\doc") {
              payload.onEvent?.onmessage({ type: "error", taskId: nextTaskId, message: `cannot inspect ${path}: path not found` });
              return;
            }
            payload.onEvent?.onmessage({
              type: "ready",
              taskId: nextTaskId,
              sessionId: nextSessionId,
              path,
              parent: "D:\\",
              totalEntries: entries.length,
            });
          });
          return { taskId: nextTaskId };
        }
        if (command === "start_directory_search") {
          const nextTaskId = ++taskId;
          const nextSessionId = ++sessionId;
          const query = String(payload.request?.query ?? "").toLocaleLowerCase();
          const roots = payload.request?.roots ?? [];
          const recursive = Boolean(payload.request?.recursive);
          const matches = entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query));
          state.expandedSearchCalls.push({ roots, query, recursive });
          searchEntriesBySession.set(nextSessionId, matches);
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId: nextTaskId });
            payload.onEvent?.onmessage({
              type: "ready",
              taskId: nextTaskId,
              sessionId: nextSessionId,
              path: roots[0] ?? "D:\\",
              parent: null,
              totalEntries: matches.length,
            });
          });
          return { taskId: nextTaskId };
        }
        if (command === "read_directory_page") {
          const pageEntries = searchEntriesBySession.get(payload.sessionId ?? 0) ?? entries;
          return {
            sessionId: payload.sessionId,
            offset: payload.offset ?? 0,
            totalEntries: pageEntries.length,
            entries: pageEntries,
          };
        }
        if (command === "search_directory_page") {
          const query = String(payload.query ?? "").toLocaleLowerCase();
          state.searchCalls.push({ sessionId: payload.sessionId ?? 0, query });
          const matches = entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query));
          return {
            sessionId: payload.sessionId,
            offset: payload.offset ?? 0,
            totalEntries: matches.length,
            entries: matches,
          };
        }
        if (command === "resolve_directory_entries") {
          return (payload.request?.positions ?? payload.positions ?? [])
            .flatMap((position) => entries[position] ? [entries[position]] : []);
        }
        if (command === "locate_directory_entry") {
          const prefix = String((payload as MockPayload & { prefix?: string }).prefix ?? "").toLocaleLowerCase();
          const startAfter = (payload as MockPayload & { startAfter?: number | null }).startAfter ?? null;
          state.locateCalls.push({ prefix, startAfter });
          for (let step = 1; step <= entries.length; step += 1) {
            const position = ((startAfter ?? -1) + step) % entries.length;
            const entry = entries[position];
            if (entry?.name.toLocaleLowerCase().startsWith(prefix)) {
              return { position, path: entry.path };
            }
          }
          return null;
        }
        if (command === "close_directory_session") {
          if (typeof payload.sessionId === "number") state.closedSessions.push(payload.sessionId);
          return null;
        }
        if (command === "transfer_directory_entries") {
          const request = payload.request;
          state.transferRequests.push({
            sourceSessionId: request?.sourceSessionId ?? 0,
            query: request?.query ?? "",
            positions: request?.positions ?? [],
            destinationDirectory: request?.destinationDirectory ?? "",
            mode: request?.mode ?? "",
          });
          return { reports: [{ outcome: request?.mode ?? "copy" }], failures: [] };
        }
        if (command === "extract_zip") {
          const request = payload.request;
          state.extractRequests.push({
            archive: request?.archive ?? "",
            destinationDirectory: request?.destinationDirectory ?? "",
            mode: request?.mode ?? "",
          });
          return request?.destinationDirectory ?? "D:\\Muller";
        }
        if (command === "create_zip") return "D:\\Muller\\Archive (2).zip";
        if (command === "directory_statistics") {
          state.statisticsPaths.push(payload.path ?? "");
          return { recursiveSize: 6_144, childFileCount: 3, childDirectoryCount: 2 };
        }
        if (command === "start_file_diff") {
          state.fileDiffRequests.push({
            leftPath: payload.request?.leftPath ?? "",
            rightPath: payload.request?.rightPath ?? "",
          });
          return { taskId: ++taskId };
        }
        if (command === "start_folder_diff") {
          state.folderDiffRequests.push({
            leftRoot: payload.request?.leftRoot ?? "",
            rightRoot: payload.request?.rightRoot ?? "",
          });
          return { taskId: ++taskId };
        }
        if (command === "start_shell_visual" || command === "start_file_preview") {
          const nextTaskId = ++taskId;
          const generation = payload.request?.generation ?? 0;
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId: nextTaskId, generation });
            payload.onEvent?.onmessage({ type: "error", taskId: nextTaskId, generation, message: "mock fallback" });
          });
          return { taskId: nextTaskId };
        }
        return null;
      },
    };
  }, {
    initialSidebarMode: sidebarMode,
    initialHoverDelayMs: hoverDelayMs,
    initialMotion: motion,
    initialAudioEnabled: audioEnabled,
  });
}

async function mockState(page: Page): Promise<MockState> {
  return page.evaluate(() => (
    globalThis as typeof globalThis & { __muller710: MockState }
  ).__muller710);
}

async function expectNoIntersection(page: Page, first: string, second: string): Promise<void> {
  const overlap = await page.evaluate(([firstSelector, secondSelector]) => {
    const firstElement = document.querySelector<HTMLElement>(firstSelector);
    const secondElement = document.querySelector<HTMLElement>(secondSelector);
    if (!firstElement || !secondElement) throw new Error(`Missing layout element: ${firstSelector} / ${secondSelector}`);
    const left = firstElement.getBoundingClientRect();
    const right = secondElement.getBoundingClientRect();
    return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
      * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  }, [first, second]);
  expect(overlap).toBe(0);
}

test("Muller opens Home without creating workspace tabs", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(1);

  for (let index = 0; index < 5; index += 1) {
    await page.locator(".brand-lockup").click();
  }
  await expect(page.getByRole("region", { name: "Home dashboard" })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "This PC" })).toHaveCount(0);
  await expect(tabs).toHaveCount(1);

  await page.locator(".classic-tree-label", { hasText: "This PC" }).click();
  await expect(page.getByRole("region", { name: "This PC" })).toHaveCount(1);

  await page.getByRole("button", { name: "Open settings" }).click();
  for (let index = 0; index < 4; index += 1) await page.keyboard.press("Control+,");
  await expect(page.locator(".settings-page")).toHaveCount(1);
  await expect(tabs).toHaveCount(1);
});

test("Muller Home performs paged full-disk search across logical drives", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.locator(".brand-lockup").click();
  const search = page.getByRole("textbox", { name: "Full-disk search" });
  await search.fill("Alpha");
  await expect(page.locator(".home-search-result:not(.is-placeholder)")).toHaveCount(1);
  await expect(page.locator(".home-search-result")).toContainText("D:\\Muller\\Alpha.txt");
  await expect.poll(async () => (await mockState(page)).expandedSearchCalls.at(-1)).toEqual({
    roots: ["D:\\"],
    query: "alpha",
    recursive: true,
  });
});

test("Home global-search results expose file operations that carry into Browse", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.locator(".brand-lockup").click();
  const search = page.getByRole("textbox", { name: "Full-disk search" });
  await search.fill("Alpha.txt");
  const result = page.locator(".home-search-result:not(.is-placeholder)").first();
  await expect(result).toBeVisible();

  await result.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Copy", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Cut", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy file name", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy full path", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Properties", exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Copy", exact: true }).click();

  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await expect(page.locator(".clipboard-status")).toContainText("Alpha.txt");
  await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();

  await page.locator(".brand-lockup").click();
  await search.fill("Alpha.txt");
  await result.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Properties" })).toContainText("D:\\Muller\\Alpha.txt");
});

test("address search mode button switches between current, recursive, and global search", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search current directory" });
  await expect(search).toHaveAttribute("placeholder", "Search inside this folder only");
  await page.getByRole("button", { name: "Choose search mode" }).click();
  await page.getByRole("menuitemradio", { name: "Search this folder and all subfolders" }).click();
  await expect(search).toHaveAttribute("placeholder", "Search this folder and all subfolders");
  await expect(search).toHaveCSS("animation-name", "search-mode-change");
  await search.fill("Atlas");
  await expect.poll(async () => (await mockState(page)).expandedSearchCalls.at(-1)).toEqual({
    roots: ["D:\\Muller"],
    query: "atlas",
    recursive: true,
  });
  await page.getByRole("button", { name: "Choose search mode" }).click();
  await page.getByRole("menuitemradio", { name: "Search all drives" }).click();
  await expect(search).toHaveAttribute("placeholder", "Search files and folders across all drives");
  await expect.poll(async () => (await mockState(page)).expandedSearchCalls.at(-1)).toEqual({
    roots: ["D:\\"],
    query: "atlas",
    recursive: true,
  });
});

test("Compare keeps an invalid attempted path visible and renders its read error", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.locator(".compare-workspace")).toBeVisible();
  await page.keyboard.press("Control+L");
  const address = page.getByRole("combobox", { name: "Current directory" });
  await address.fill("D:\\MULLER\\DOC");
  await address.press("Enter");
  await expect(page.locator(".directory-pane").first().locator(".directory-pane-heading")).toContainText("DOC");
  await expect(page.locator(".directory-pane").first().locator(".pane-error")).toContainText("path not found");
});

test("Compare pane hierarchy controls survive navigation from a result view", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const panes = page.locator(".compare-workspace .directory-pane");
  await expect(panes).toHaveCount(2);

  await panes.nth(0).locator(".directory-row", { hasText: "Destination" }).click();
  await panes.nth(1).locator(".directory-row", { hasText: "Destination" }).click();
  await page.getByRole("button", { name: "Left: Open selected child folder" }).click();
  await expect(panes.nth(0).locator(".directory-pane-heading > span")).toHaveText("D:\\Muller\\Destination");
  const visibleGeometry = await panes.nth(0).evaluate((pane) => {
    const viewport = pane.querySelector<HTMLElement>(".directory-list-viewport");
    const row = pane.querySelector<HTMLElement>(".directory-row:not(.is-placeholder)");
    if (!viewport || !row) return null;
    const viewportBox = viewport.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    return {
      viewportHeight: viewportBox.height,
      intersection: Math.max(0, Math.min(viewportBox.bottom, rowBox.bottom) - Math.max(viewportBox.top, rowBox.top)),
    };
  });
  expect(visibleGeometry?.viewportHeight ?? 0).toBeGreaterThan(32);
  expect(visibleGeometry?.intersection ?? 0).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Left: Parent folder" }).click();
  await expect(panes.nth(0).locator(".directory-pane-heading > span")).toHaveText("D:\\");

  await page.getByRole("button", { name: "Right: Open selected child folder" }).click();
  await expect(panes.nth(1).locator(".directory-pane-heading > span")).toHaveText("D:\\Muller\\Destination");

  await page.locator(".compare-actions .command-button.is-primary").click();
  await expect(page.locator(".folder-diff-pane")).toBeVisible();
  await page.getByRole("button", { name: "Up one level", exact: true }).click();
  await expect(page.locator(".compare-browser-surface")).toBeVisible();
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(1).locator(".directory-pane-heading > span")).toHaveText("D:\\");
});

test("UNC host addresses render as network breadcrumbs and navigate up to This PC", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.keyboard.press("Control+L");
  const address = page.getByRole("combobox", { name: "Current directory" });
  await address.fill("\\\\10.1.10.8");
  await page.waitForTimeout(350);
  expect((await mockState(page)).completionInputs).toEqual([]);
  await address.press("Enter");
  await expect(page.getByRole("button", { name: "\\\\10.1.10.8", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Up one level", exact: true }).click();
  await expect(page.getByRole("region", { name: "This PC" })).toBeVisible();
});

test("Preview is a themed overlay that does not resize directory panes", async ({ page }) => {
  await installDesktopMock(page);
  await page.setViewportSize({ width: 1360, height: 840 });
  await page.goto("/");
  await expect(page.locator(".directory-pane").first().locator(".directory-row:not(.is-placeholder)")).toHaveCount(5);
  const before = await page.locator(".directory-panes").boundingBox();

  await page.getByRole("button", { name: "Toggle preview" }).click();
  await expect(page.locator(".preview-panel")).toBeVisible();
  const after = await page.locator(".directory-panes").boundingBox();
  expect(after?.width).toBe(before?.width);
  await expect(page.locator(".preview-panel")).not.toHaveCSS("background-color", "rgb(11, 14, 19)");

  await page.getByRole("button", { name: "Pin preview to the page" }).click();
  await expect(page.locator(".browse-content")).toHaveClass(/is-preview-pinned/);
  const pinned = await page.locator(".directory-panes").boundingBox();
  expect(pinned?.width ?? 0).toBeLessThan(after?.width ?? 0);

  const resizer = page.getByRole("separator", { name: "Resize file preview" });
  const resizerBox = await resizer.boundingBox();
  if (!resizerBox) throw new Error("Preview resizer is not measurable");
  const widthBeforeDrag = Number(await resizer.getAttribute("aria-valuenow"));
  await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 90);
  await page.mouse.down();
  await page.mouse.move(resizerBox.x + resizerBox.width / 2 - 100, resizerBox.y + 90);
  await page.mouse.up();
  await expect.poll(async () => Number(await resizer.getAttribute("aria-valuenow"))).toBe(widthBeforeDrag + 100);
  const previewInteraction = await page.evaluate(() => {
    const resizerElement = document.querySelector<HTMLElement>(".preview-resizer");
    const pin = document.querySelector<HTMLElement>(".preview-heading__actions button");
    if (!resizerElement || !pin) return null;
    const bounds = resizerElement.getBoundingClientRect();
    const pinBounds = pin.getBoundingClientRect();
    const pointTarget = document.elementFromPoint(pinBounds.x + pinBounds.width / 2, pinBounds.y + pinBounds.height / 2);
    return {
      resizer: { left: bounds.left, right: bounds.right, width: bounds.width },
      pin: { left: pinBounds.left, right: pinBounds.right },
      targetIsResizer: pointTarget instanceof Element && pointTarget.closest(".preview-resizer") !== null,
      capturesPointerOne: resizerElement.hasPointerCapture(1),
    };
  });
  expect(previewInteraction?.capturesPointerOne).toBe(false);
  if (previewInteraction?.targetIsResizer) {
    throw new Error(`Preview resizer overlaps the pin control: ${JSON.stringify(previewInteraction)}`);
  }
  await page.getByRole("button", { name: "Unpin preview overlay" }).click();
  await expect(page.locator(".browse-content")).not.toHaveClass(/is-preview-pinned/);

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.locator(".workspace-filter-menu")).toBeVisible();
  await page.waitForTimeout(250);
  await expectNoIntersection(page, ".browse-workspace", ".workspace-filter-menu");
  await expectNoIntersection(page, ".directory-panes", ".workspace-filter-menu");
});

test("standard density keeps the five-row workspace chrome within its intended size", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radio", { name: "Standard", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "standard");
  const topbar = await page.locator(".stage7-topbar").boundingBox();
  const addressbar = await page.locator(".stage7-addressbar").boundingBox();
  expect(topbar?.height ?? 0).toBeLessThanOrEqual(46);
  expect(addressbar?.height ?? 0).toBeLessThanOrEqual(56);
  await expect(page.getByRole("button", { name: "Minimize" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Maximize" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
});

test("window controls dispatch all three native window operations", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Minimize" }).click();
  const maximize = page.getByRole("button", { name: "Maximize" });
  await expect(maximize.locator(".lucide-maximize2")).toBeVisible();
  await maximize.click();
  const restore = page.getByRole("button", { name: "Restore" });
  await expect(restore.locator(".lucide-minimize2")).toBeVisible();
  await expect(restore).toHaveAttribute("aria-pressed", "true");
  await restore.click();
  await expect(page.getByRole("button", { name: "Maximize" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(async () => (await mockState(page)).windowCommands).toEqual([
    "plugin:window|minimize",
    "plugin:window|toggle_maximize",
    "plugin:window|toggle_maximize",
    "plugin:window|close",
  ]);
});

test("blank titlebar space starts native window dragging", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.locator(".stage7-topbar").dispatchEvent("pointerdown", { button: 0 });
  await expect.poll(async () => (await mockState(page)).windowCommands).toContain("plugin:window|start_dragging");
});

test("duplicate scan root cycles directory completion with Tab", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Duplicates", exact: true }).click();
  const scanLocation = page.getByRole("textbox", { name: "Scan location" });
  await scanLocation.fill("D:\\");
  await scanLocation.press("Tab");
  await expect(scanLocation).toHaveValue("D:\\Projects");
  await scanLocation.press("Shift+Tab");
  await expect(scanLocation).toHaveValue("D:\\Projects");
});

test("Folder preview reports size and immediate child counts once per selection", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const destination = page.locator(".directory-pane").first().locator(".directory-row", { hasText: "Destination" });
  await destination.click();
  await page.getByRole("button", { name: "Toggle preview" }).click();

  const folderPreview = page.locator(".preview-folder");
  await expect(folderPreview).toBeVisible();
  await expect(folderPreview).toContainText("6.1 KB");
  await expect(folderPreview).toContainText("Folders in folder");
  await expect(folderPreview).toContainText("Files in folder");
  await destination.click();
  await expect.poll(async () => (await mockState(page)).statisticsPaths).toEqual(["D:\\Muller\\Destination"]);
});

test("Home, address typography, and search actions use the available desktop width", async ({ page }) => {
  await installDesktopMock(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");

  const breadcrumbText = page.locator(".breadcrumb-address__segment button").last();
  const breadcrumbFontSize = await breadcrumbText.evaluate((element) => getComputedStyle(element).fontSize);
  await page.keyboard.press("Control+L");
  const addressInput = page.getByRole("combobox", { name: "Current directory" });
  await expect(addressInput).toBeVisible();
  await expect(addressInput).toHaveCSS("font-size", breadcrumbFontSize);
  await addressInput.press("Escape");

  const searchBox = page.locator(".address-directory-search");
  const searchActions = page.locator(".address-search-actions");
  const alignment = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>(".address-directory-search")?.getBoundingClientRect();
    const actions = document.querySelector<HTMLElement>(".address-search-actions")?.getBoundingClientRect();
    return box && actions ? Math.abs(box.right - actions.right) : Number.POSITIVE_INFINITY;
  });
  expect(alignment).toBeLessThanOrEqual(1);
  await expect(searchBox).toBeVisible();
  await expect(searchActions).toBeVisible();
  await page.getByRole("button", { name: "Choose search mode" }).click();
  const menuItemsFit = await page.locator(".address-search-mode-menu button").evaluateAll((items) =>
    items.every((item) => item.scrollWidth <= item.clientWidth && item.clientHeight === 36),
  );
  expect(menuItemsFit).toBe(true);
  await page.getByRole("button", { name: "Choose search mode" }).click();
  await page.locator(".brand-lockup").click();
  const workspace = await page.locator(".stage7-workspace").boundingBox();
  const bento = await page.locator(".magic-bento").boundingBox();
  expect(bento?.width ?? 0).toBeGreaterThan((workspace?.width ?? Number.POSITIVE_INFINITY) * 0.9);
  await expect(page.locator(".location-rail__label")).toHaveCSS("font-size", "10px");
});

test("Option Wheel previews 100 wheel steps without navigation or tab creation", async ({ page }) => {
  await installDesktopMock(page, "option");
  await page.goto("/");
  const wheel = page.getByRole("listbox", { name: "Quick locations" });
  await expect(wheel.getByRole("option")).toHaveCount(4);
  const before = await mockState(page);

  await wheel.evaluate((element) => {
    for (let index = 0; index < 100; index += 1) {
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }));
    }
  });
  await page.waitForTimeout(200);

  const after = await mockState(page);
  expect(after.directoryQueries).toEqual(before.directoryQueries);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".stage7-shell")).toHaveAttribute("data-workspace-mode", "browse");
});

test("Line Sidebar visual markers track the real button rect and clicks open that item", async ({ page }) => {
  await installDesktopMock(page, "line");
  await page.goto("/");
  const items = page.locator(".line-sidebar__item");
  await expect(items).toHaveCount(4);

  for (let index = 0; index < 4; index += 1) {
    await items.nth(index).hover();
    const centerDelta = await items.nth(index).evaluate((button) => {
      const marker = button.querySelector<HTMLElement>(".line-sidebar__marker");
      if (!marker) throw new Error("Line Sidebar marker is missing");
      const buttonRect = button.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      return Math.abs((buttonRect.top + buttonRect.height / 2) - (markerRect.top + markerRect.height / 2));
    });
    expect(centerDelta).toBeLessThanOrEqual(2);
  }

  await items.filter({ hasText: "Desktop" }).click();
  await expect.poll(async () => (await mockState(page)).directoryQueries).toContain("D:\\Desktop");
});

test("Classic sidebar keeps This PC standalone and expands drive folders", async ({ page }) => {
  await installDesktopMock(page, "classic");
  await page.goto("/");
  const thisPc = page.locator(".classic-tree-node.is-this-pc");
  const drive = page.locator(".classic-tree-node.is-drive").first();
  await expect(thisPc.locator(".classic-tree-toggle")).toHaveCount(0);
  await expect(drive).toContainText("Local Disk (D:)");
  await drive.locator(":scope > .classic-tree-row .classic-tree-label").dblclick();
  await expect(drive).toContainText("Projects");
});

test("workspace tools collapse upward and leave one restore button", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const ribbon = page.locator(".tool-ribbon");
  await expect(page.getByRole("button", { name: "Duplicates", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse workspace tools" }).click();
  await expect(page.locator(".stage7-shell")).toHaveClass(/is-ribbon-collapsed/);
  await expect(ribbon).toBeHidden();
  await page.getByRole("button", { name: "Expand workspace tools" }).click();
  await expect(ribbon).toBeVisible();
});

test("file actions collapse into the workspace tool ribbon", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Collapse file actions" }).click();
  await expect(page.locator(".browse-toolbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand file actions" }).click();
  await expect(page.locator(".browse-toolbar")).toBeVisible();
});

test("address search is persistent and drive roots navigate up to This PC", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");

  await page.keyboard.press("Control+f");
  const search = page.getByRole("textbox", { name: "Search current directory" });
  await expect(search).toBeFocused();
  await search.fill("Alpha");
  await expect(page.locator(".directory-list-viewport").first().locator(".directory-row:not(.is-placeholder)")).toHaveCount(1);
  await search.press("Escape");
  await expect(search).toBeVisible();
  await expect(search).toHaveValue("");

  const address = page.locator(".breadcrumb-address");
  await expect(address.getByRole("button", { name: "This PC", exact: true })).toBeVisible();
  await address.getByRole("button", { name: "D:", exact: true }).click();
  await expect.poll(async () => (await mockState(page)).directoryQueries).toContain("D:\\");
  await page.getByRole("button", { name: "Up one level", exact: true }).click();
  await expect(page.getByRole("region", { name: "This PC" })).toBeVisible();
});

test("dual-pane search runs both sessions and returns to the active pane", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewports = page.locator(".directory-list-viewport");
  await viewports.nth(1).locator(".directory-row").nth(2).dblclick();
  await expect.poll(async () => (await mockState(page)).directoryQueries).toContain("D:\\Muller\\Destination");

  await page.getByRole("button", { name: "Search both panes" }).click();
  const search = page.getByRole("textbox", { name: "Search current directory" });
  await search.fill("Alpha");
  await expect(viewports.nth(0).locator(".directory-row:not(.is-placeholder)")).toHaveCount(1);
  await expect(viewports.nth(1).locator(".directory-row:not(.is-placeholder)")).toHaveCount(1);
  expect(new Set((await mockState(page)).searchCalls.filter((call) => call.query === "alpha").map((call) => call.sessionId)).size).toBe(2);

  await page.getByRole("button", { name: "Search active pane only" }).click();
  await expect(viewports.nth(0).locator(".directory-row:not(.is-placeholder)")).toHaveCount(5);
  await expect(viewports.nth(1).locator(".directory-row:not(.is-placeholder)")).toHaveCount(1);
});

test("address pane button switches the active file pane", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const panes = page.locator(".directory-pane");
  const toggle = page.getByRole("button", { name: "Switch active pane" });
  await expect(page.getByRole("button", { name: "Search both panes" })).toBeEnabled();
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(panes.nth(1)).toHaveClass(/is-active/);
  await toggle.click();
  await expect(panes.nth(0)).toHaveClass(/is-active/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoIntersection(page, ".stage7-address-center", ".nav-actions");
  await expectNoIntersection(page, ".stage7-address-center", ".address-actions");
  await expectNoIntersection(page, ".breadcrumb-address", ".address-directory-search");
});

test("Tab switches file focus between panes without a focus rectangle", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewports = page.locator(".directory-list-viewport");
  await viewports.nth(0).focus();
  await page.keyboard.press("Tab");
  await expect(viewports.nth(1)).toBeFocused();
  await expect(page.locator(".directory-pane").nth(1)).toHaveClass(/is-active/);
  await expect(viewports.nth(1)).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Shift+Tab");
  await expect(viewports.nth(0)).toBeFocused();
});

test("keyboard row navigation moves the focus surface with a spring", async ({ page }) => {
  await installDesktopMock(page, "classic", 0, "full");
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  const focusSurface = viewport.locator(".directory-list-selection");
  await viewport.focus();
  const start = await focusSurface.boundingBox();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(32);
  const middle = await focusSurface.boundingBox();
  await page.waitForTimeout(260);
  const end = await focusSurface.boundingBox();
  if (!start || !middle || !end) throw new Error("List focus spring geometry is unavailable");
  expect(middle.y).toBeGreaterThan(start.y);
  expect(middle.y).toBeLessThan(end.y);
  expect(Math.round(end.y - start.y)).toBe(32);
});

test("keyboard selection movement plays interface audio", async ({ page }) => {
  await installDesktopMock(page, "classic", 0, "reduced", true);
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  await viewport.focus();
  const before = (await mockState(page)).audioStarts;
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await mockState(page)).audioStarts).toBeGreaterThan(before);
});

test("blank-space drag creates a marquee and selects rows", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("List viewport is unavailable");
  await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 80, bounds.y + 36, { steps: 6 });
  await expect(viewport.locator(".selection-marquee")).toBeVisible();
  await page.mouse.up();
  await expect(viewport.locator(".directory-row[aria-selected='true']")).not.toHaveCount(0);
});

test("the entire list row selects and never starts a marquee", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  const row = viewport.locator(".directory-row:not(.is-placeholder)").nth(3);
  const bounds = await row.boundingBox();
  if (!bounds) throw new Error("List row is unavailable");
  await page.mouse.move(bounds.x + bounds.width - 32, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + bounds.height / 2 + 1);
  await page.mouse.up();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(viewport.locator(".selection-marquee")).toHaveCount(0);
});

test("row whitespace starts marquee while the name remains the file drag handle", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  const rows = viewport.locator(".directory-row:not(.is-placeholder)");
  const row = rows.nth(3);
  const label = row.locator(".directory-drag-label");
  await expect(label).toHaveAttribute("draggable", "true");
  await expect(row).not.toHaveAttribute("draggable", "true");
  const [rowBox, labelBox] = await Promise.all([row.boundingBox(), label.boundingBox()]);
  if (!rowBox || !labelBox) throw new Error("Directory row gesture geometry is unavailable");
  const startX = Math.min(rowBox.x + rowBox.width - 8, labelBox.x + labelBox.width + 32);
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __mullerDragStarts: number }).__mullerDragStarts = 0;
    document.querySelector(".directory-list-viewport")?.addEventListener("dragstart", () => {
      (globalThis as typeof globalThis & { __mullerDragStarts: number }).__mullerDragStarts += 1;
    });
  });
  await page.mouse.move(startX, rowBox.y + rowBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(startX - 48, rowBox.y - rowBox.height * 2, { steps: 6 });
  await expect(viewport.locator(".selection-marquee")).toBeVisible();
  await page.mouse.up();
  expect(await page.evaluate(() => (
    globalThis as typeof globalThis & { __mullerDragStarts: number }
  ).__mullerDragStarts)).toBe(0);
  await expect(viewport.locator(".directory-row[aria-selected='true']")).not.toHaveCount(0);
});

test("pointer selection does not reveal-scroll the list", async ({ page }) => {
  await installDesktopMock(page, "classic", 0, "full");
  await page.setViewportSize({ width: 1000, height: 420 });
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const before = await viewport.evaluate((element) => element.scrollTop);
  await viewport.locator(".directory-row:not(.is-placeholder)").last().evaluate((row) => {
    row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7 }));
    row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 7 }));
  });
  await page.waitForTimeout(260);
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(before);
});

test("pointer following distance trails continuously without a timer hold", async ({ page }) => {
  await installDesktopMock(page, "classic", 150, "full");
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  const rows = viewport.locator(".directory-row:not(.is-placeholder)");
  await rows.nth(0).hover();
  await page.waitForTimeout(220);
  const firstTop = (await viewport.locator(".directory-list-hover").boundingBox())?.y;
  await rows.nth(1).hover();
  await page.waitForTimeout(24);
  const trailingTop = (await viewport.locator(".directory-list-hover").boundingBox())?.y;
  expect(trailingTop).toBeGreaterThan(firstTop ?? 0);
  expect(trailingTop).toBeLessThan((firstTop ?? 0) + 32);
  await expect.poll(async () => (await viewport.locator(".directory-list-hover").boundingBox())?.y).toBe((firstTop ?? 0) + 32);
});

test("rapid pointer following settles on the latest row without stale motion", async ({ page }) => {
  await installDesktopMock(page, "classic", 0, "full");
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  const rows = viewport.locator(".directory-row:not(.is-placeholder)");
  await rows.nth(0).hover();
  const firstTop = (await viewport.locator(".directory-list-hover").boundingBox())?.y ?? 0;
  await rows.nth(1).hover();
  await rows.nth(2).hover();
  await rows.nth(3).hover();
  await rows.nth(4).hover();
  const startedAt = Date.now();
  await expect.poll(async () => Math.round(((await viewport.locator(".directory-list-hover").boundingBox())?.y ?? 0) - firstTop), { timeout: 180 }).toBe(128);
  expect(Date.now() - startedAt).toBeLessThan(140);
});

test("large icons preserve thumbnails, zoom with Ctrl+wheel, and retain blank space", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Large icons" }).click();
  const viewport = page.locator(".directory-grid-viewport").first();
  const tile = viewport.locator(".directory-tile:not(.is-placeholder)").first();
  const before = await tile.boundingBox();
  await viewport.dispatchEvent("wheel", { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true });
  await expect.poll(async () => (await tile.boundingBox())?.width ?? 0).toBeGreaterThan(before?.width ?? 0);
  const objectFit = await tile.locator(".directory-tile__visual").evaluate((visual) => {
    const image = document.createElement("img");
    image.alt = "";
    visual.append(image);
    return getComputedStyle(image).objectFit;
  });
  expect(objectFit).toBe("contain");
  const thumbnailGeometry = await tile.evaluate((element) => {
    const tileBounds = element.getBoundingClientRect();
    const visualBounds = element.querySelector(".directory-tile__visual")?.getBoundingClientRect();
    return { tileWidth: tileBounds.width, visualHeight: visualBounds?.height ?? 0 };
  });
  expect(thumbnailGeometry.visualHeight).toBeGreaterThan(thumbnailGeometry.tileWidth * 0.72);
  const blankSpace = await viewport.evaluate((element) => {
    const spacer = element.querySelector<HTMLElement>(".directory-grid-spacer");
    const last = element.querySelectorAll<HTMLElement>(".directory-tile").item(element.querySelectorAll(".directory-tile").length - 1);
    if (!spacer || !last) return 0;
    return spacer.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
  });
  expect(blankSpace).toBeGreaterThanOrEqual(100);
});

test("type-ahead locates loaded entries and cycles repeated prefixes", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  const rows = viewport.locator(".directory-row:not(.is-placeholder)");
  await expect(rows).toHaveCount(5);
  await viewport.focus();

  await page.keyboard.press("a");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("a");
  await expect(rows.nth(3)).toHaveAttribute("aria-selected", "true");
  expect((await mockState(page)).locateCalls.map((call) => call.prefix)).toEqual(["a", "a"]);
});

test("internal drag carries the selected set, highlights the target, and uses transfer_directory_entries", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const rows = page.locator(".directory-list-viewport").first().locator(".directory-row:not(.is-placeholder)");
  await expect(rows).toHaveCount(5);
  await rows.nth(1).click({ modifiers: ["Control"] });
  await expect(rows.filter({ has: page.locator(".selection-surface") })).toHaveCount(2);
  await expect(page.locator(".directory-list-viewport").first().locator(".directory-row[aria-selected='true']")).toHaveCount(2);
  await expect(page.locator(".directory-list-viewport").first().locator(".directory-list-selection")).toHaveCount(0);

  const dragResult = await rows.evaluateAll((elements) => {
    const source = elements[1];
    const destination = elements[2];
    if (!source || !destination) throw new Error("Drag fixtures are missing");
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    destination.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      dataTransfer,
    }));
    const highlighted = destination.classList.contains("is-file-drop-target");
    const payload = dataTransfer.getData("application/x-muller-directory-entries");
    destination.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      dataTransfer,
    }));
    return { highlighted, payload };
  });

  expect(dragResult.highlighted).toBe(true);
  expect(JSON.parse(dragResult.payload)).toMatchObject({
    version: 1,
    sourcePane: "left",
    positions: [0, 1],
  });
  expect((await mockState(page)).nativeDragPaths).toEqual([]);
  await expect.poll(async () => (await mockState(page)).transferRequests).toEqual([
    expect.objectContaining({
      query: "",
      positions: [0, 1],
      destinationDirectory: "D:\\Muller\\Destination",
      mode: "copy",
    }),
  ]);
});

test("pointer drag from the file name moves the entry across panes", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewports = page.locator(".directory-list-viewport");
  await viewports.nth(1).locator(".directory-row").nth(2).dblclick();
  await expect.poll(async () => (await mockState(page)).directoryQueries).toContain("D:\\Muller\\Destination");
  const source = viewports.nth(0).locator(".directory-row:not(.is-placeholder)").first().locator(".directory-drag-label");
  await source.dragTo(page.locator(".directory-pane").nth(1).locator(".directory-pane-heading"));
  await expect.poll(async () => (await mockState(page)).transferRequests.at(-1)).toMatchObject({
    destinationDirectory: "D:\\Muller\\Destination",
    positions: [0],
    mode: "move",
  });
});

test("marquee-selected rows drag as one set without collapsing selection", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewports = page.locator(".directory-list-viewport");
  await viewports.nth(1).locator(".directory-row").nth(2).dblclick();
  await expect.poll(async () => (await mockState(page)).directoryQueries).toContain("D:\\Muller\\Destination");
  const rows = viewports.nth(0).locator(".directory-row:not(.is-placeholder)");
  const [firstBox, secondBox, secondLabelBox] = await Promise.all([
    rows.nth(0).boundingBox(),
    rows.nth(1).boundingBox(),
    rows.nth(1).locator(".directory-drag-label").boundingBox(),
  ]);
  if (!firstBox || !secondBox || !secondLabelBox) throw new Error("Marquee drag geometry is unavailable");
  const startX = Math.min(secondBox.x + secondBox.width - 8, secondLabelBox.x + secondLabelBox.width + 32);
  await page.mouse.move(startX, secondBox.y + secondBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(startX - 48, firstBox.y + firstBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(viewports.nth(0).locator(".directory-row[aria-selected='true']")).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("draggable", "true");

  await rows.nth(0).dragTo(page.locator(".directory-pane").nth(1).locator(".directory-pane-heading"));
  await expect.poll(async () => (await mockState(page)).transferRequests.at(-1)).toMatchObject({
    destinationDirectory: "D:\\Muller\\Destination",
    positions: [0, 1],
    mode: "move",
  });
});

test("selected grid tiles drag as one set without collapsing selection", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const listViewports = page.locator(".directory-list-viewport");
  await listViewports.nth(1).locator(".directory-row").nth(2).dblclick();
  await expect.poll(async () => (await mockState(page)).directoryQueries).toContain("D:\\Muller\\Destination");
  await page.getByRole("button", { name: "Large icons" }).click();
  const tiles = page.locator(".directory-grid-viewport").nth(0).locator(".directory-tile:not(.is-placeholder)");
  await tiles.nth(0).click();
  await tiles.nth(1).click({ modifiers: ["Control"] });
  await expect(page.locator(".directory-grid-viewport").nth(0).locator(".directory-tile[aria-selected='true']")).toHaveCount(2);
  await tiles.nth(0).dragTo(page.locator(".directory-pane").nth(1).locator(".directory-pane-heading"));
  await expect.poll(async () => (await mockState(page)).transferRequests.at(-1)).toMatchObject({
    destinationDirectory: "D:\\Muller\\Destination",
    positions: [0, 1],
    mode: "move",
  });
});

test("selected files drop onto the right pane and switch to native drag only outside", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewports = page.locator(".directory-list-viewport");
  await viewports.nth(1).locator(".directory-row").nth(2).dblclick();
  await expect.poll(async () => (await mockState(page)).directoryQueries).toContain("D:\\Muller\\Destination");

  const internalResult = await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>(".directory-list-viewport [data-file-drag-handle='true'][draggable='true']");
    const destination = document.querySelectorAll<HTMLElement>(".directory-pane").item(1);
    if (!source || !destination) throw new Error("Cross-pane drag fixtures are missing");
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    destination.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, ctrlKey: true, dataTransfer }));
    const highlighted = destination.classList.contains("is-file-drop-target");
    destination.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, ctrlKey: true, dataTransfer }));
    return highlighted;
  });
  expect(internalResult).toBe(true);
  await expect.poll(async () => (await mockState(page)).transferRequests.at(-1)).toMatchObject({
    destinationDirectory: "D:\\Muller\\Destination",
    mode: "copy",
  });
  expect((await mockState(page)).nativeDragPaths).toEqual([]);

  await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>(".directory-list-viewport [data-file-drag-handle='true'][draggable='true']");
    if (!source) throw new Error("Native drag fixture is missing");
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    window.dispatchEvent(new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      clientY: 0,
      relatedTarget: null,
      dataTransfer,
    }));
  });
  await page.waitForTimeout(160);
  expect((await mockState(page)).nativeDragPaths).toEqual([]);

  await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>(".directory-list-viewport [data-file-drag-handle='true'][draggable='true']");
    if (!source) throw new Error("Native drag fixture is missing");
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    window.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      clientX: 6,
      clientY: 200,
      dataTransfer,
    }));
    window.dispatchEvent(new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      clientY: 200,
      relatedTarget: null,
      dataTransfer,
    }));
  });
  await expect.poll(async () => (await mockState(page)).nativeDragPaths.length).toBe(1);
});

test("Browse context menu compares one selected file from each pane", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const viewports = page.locator(".directory-list-viewport");
  await viewports.nth(1).locator(".directory-row:not(.is-placeholder)").nth(1).click();
  await viewports.nth(0).locator(".directory-row:not(.is-placeholder)").nth(0).click({ button: "right" });
  const compare = page.getByRole("menuitem", { name: "Compare selected pane items" });
  await expect(compare).toBeEnabled();
  await compare.click();
  await expect(page.locator(".stage7-shell")).toHaveAttribute("data-workspace-mode", "compare");
  await expect.poll(async () => (await mockState(page)).fileDiffRequests).toEqual([{
    leftPath: "D:\\Muller\\Alpha.txt",
    rightPath: "D:\\Muller\\Alpine.txt",
  }]);
});

test("folder Properties reports recursive size and immediate child counts", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const folder = page.locator(".directory-list-viewport").first().locator(".directory-row:not(.is-placeholder)").nth(2);
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Properties" }).click();
  const dialog = page.getByRole("dialog", { name: "Properties" });
  await expect(dialog).toContainText("6.1 KB");
  await expect(dialog).toContainText("Files in folder");
  await expect(dialog).toContainText("3");
  await expect(dialog).toContainText("Folders in folder");
  await expect(dialog).toContainText("2");
  expect((await mockState(page)).statisticsPaths).toEqual(["D:\\Muller\\Destination"]);
});

test("language and theme switch immediately without rebuilding the directory session or selection", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const rows = page.locator(".directory-list-viewport").first().locator(".directory-row:not(.is-placeholder)");
  await expect(rows).toHaveCount(5);
  await rows.nth(1).click();
  const before = await mockState(page);

  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.locator(".browse-workspace")).toBeHidden();
  await page.getByRole("radio", { name: "Simplified Chinese" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();
  await page.getByRole("radio", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const afterPreferences = await mockState(page);
  expect(afterPreferences.directoryQueries).toEqual(before.directoryQueries);
  expect(afterPreferences.closedSessions).toEqual([]);
  await page.getByRole("tab").click();
  await expect(page.locator(".browse-workspace")).toBeVisible();
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  expect((await mockState(page)).directoryQueries).toEqual(before.directoryQueries);
});

test("Monochrome Platinum is a persistent built-in theme", async ({ page }, testInfo) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("radio", { name: "Platinum", exact: true }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme-source", "built-in");
  await expect(page.locator(".settings-page")).toContainText("Muller Monochrome Platinum");
  expect(await page.locator("html").evaluate((element) => ({
    canvas: element.style.getPropertyValue("--surface-0"),
    accent: element.style.getPropertyValue("--accent"),
    borderWidth: element.style.getPropertyValue("--flow-border-width"),
    borderOpacity: element.style.getPropertyValue("--flow-border-opacity"),
    borderIdle: element.style.getPropertyValue("--flow-border-idle"),
  }))).toEqual({
    canvas: "#09090b",
    accent: "#ffffff",
    borderWidth: "3px",
    borderOpacity: "0.88",
    borderIdle: "#e4e4e7",
  });
  await page.screenshot({ path: testInfo.outputPath("platinum-settings.png"), fullPage: true });

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator("html").evaluate((element) => element.style.getPropertyValue("--surface-0"))).toBe("#09090b");
});

test("capsule sliders and frosted glass appearance render and persist", async ({ page }, testInfo) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();

  const slider = page.getByRole("slider", { name: "UI scale" });
  await expect(slider).toBeVisible();
  const sliderMetrics = await slider.evaluate((element) => {
    const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules));
    const thumbRule = rules.find((rule) => rule instanceof CSSStyleRule
      && rule.selectorText === '.settings-row > input[type="range"]::-webkit-slider-thumb') as CSSStyleRule | undefined;
    return {
      controlHeight: getComputedStyle(element).height,
      thumbWidth: thumbRule?.style.width,
      thumbHeight: thumbRule?.style.height,
      thumbRadius: thumbRule?.style.borderRadius,
    };
  });
  expect(sliderMetrics).toEqual({
    controlHeight: "24px",
    thumbWidth: "22px",
    thumbHeight: "12px",
    thumbRadius: "6px",
  });

  await expect(page.locator("html")).toHaveAttribute("data-glass", "false");
  await page.getByRole("checkbox", { name: "Frosted glass" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-glass", "true");

  const glassMetrics = await page.evaluate(() => {
    const topbar = getComputedStyle(document.querySelector(".stage7-topbar") as HTMLElement);
    const settings = getComputedStyle(document.querySelector(".settings-page") as HTMLElement);
    return {
      topbarBackground: topbar.backgroundColor,
      topbarBackdrop: topbar.backdropFilter || topbar.getPropertyValue("-webkit-backdrop-filter"),
      settingsBackground: settings.backgroundColor,
      settingsBackdrop: settings.backdropFilter || settings.getPropertyValue("-webkit-backdrop-filter"),
    };
  });
  expect(glassMetrics.topbarBackground).toMatch(/rgba|color\(/);
  expect(glassMetrics.topbarBackdrop).toContain("blur(26px)");
  expect(glassMetrics.settingsBackground).toMatch(/rgba|color\(/);
  expect(glassMetrics.settingsBackdrop).toContain("blur(24px)");
  await page.screenshot({ path: testInfo.outputPath("glass-dark-settings.png"), fullPage: true });

  await page.getByRole("radio", { name: "Platinum", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("glass-platinum-settings.png"), fullPage: true });
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("glass-light-settings.png"), fullPage: true });

  await page.setViewportSize({ width: 760, height: 760 });
  await expect(page.locator(".settings-page")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("glass-light-settings-760.png"), fullPage: true });

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-glass", "true");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("checkbox", { name: "Frosted glass" })).toBeChecked();
});

test("custom color configuration imports, applies, and persists after reload", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const scheme = JSON.parse(readFileSync(new URL("../themes/muller-light.example.json", import.meta.url), "utf8")) as {
    name: string;
    colors: Record<string, string>;
    flowBorder: { width: number; opacity: number; colors: Record<string, string> };
  };
  scheme.name = "E2E Signal Palette";
  scheme.colors.canvas = "#123456";
  scheme.colors.accent = "#e83f6f";
  scheme.flowBorder.width = 6;
  scheme.flowBorder.opacity = 0.44;
  scheme.flowBorder.colors.idle = "#19a974";
  await page.locator(".theme-file-input").setInputFiles({
    name: "e2e-signal.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(scheme)),
  });

  await expect(page.locator("html")).toHaveAttribute("data-theme-source", "custom");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("status")).toContainText("E2E Signal Palette");
  expect(await page.locator("html").evaluate((element) => element.style.getPropertyValue("--surface-0"))).toBe("#123456");
  expect(await page.locator("html").evaluate((element) => element.style.getPropertyValue("--accent"))).toBe("#e83f6f");
  expect(await page.locator("html").evaluate((element) => element.style.getPropertyValue("--flow-border-width"))).toBe("6px");
  expect(await page.locator("html").evaluate((element) => element.style.getPropertyValue("--flow-border-opacity"))).toBe("0.44");
  expect(await page.locator("html").evaluate((element) => element.style.getPropertyValue("--flow-border-idle"))).toBe("#19a974");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme-source", "custom");
  expect(await page.locator("html").evaluate((element) => element.style.getPropertyValue("--surface-0"))).toBe("#123456");
});

test("ZIP context menu exposes all extraction destinations and dispatches explicit modes", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const archive = page.locator(".directory-list-viewport").first().locator(".directory-row:not(.is-placeholder)").nth(3);
  await expect(archive).toContainText("Archive.zip");
  await archive.click({ button: "right" });

  await expect(page.getByRole("menuitem", { name: "Extract to current folder" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Extract to named folder" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Choose extraction destination..." })).toBeVisible();
  await page.getByRole("menuitem", { name: "Extract to current folder" }).click();
  await expect.poll(async () => (await mockState(page)).extractRequests).toContainEqual({
    archive: "D:\\Muller\\Archive.zip",
    destinationDirectory: "D:\\Muller",
    mode: "current",
  });

  await expect(archive).toBeVisible();
  await archive.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Extract to named folder" }).click();
  await expect.poll(async () => (await mockState(page)).extractRequests).toContainEqual({
    archive: "D:\\Muller\\Archive.zip",
    destinationDirectory: "D:\\Muller",
    mode: "named",
  });
});
