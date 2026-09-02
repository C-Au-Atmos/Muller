import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

interface MockChannel {
  onmessage: (message: unknown) => void;
}

interface MockPayload {
  item?: string[];
  input?: string;
  path?: string;
  message?: string;
  behavior?: "hide" | "quit";
  enabled?: boolean;
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
  taskId?: number;
  offset?: number;
  query?: string;
  positions?: number[];
}

interface MockState {
  audioStarts: number;
  autostartEnabled: boolean;
  closeBehavior: "hide" | "quit";
  debugLoggingEnabled: boolean;
  debugLoggingFailure: "none" | "before-write" | "after-write";
  diagnosticsStatusError: string | null;
  diagnosticLogs: string[];
  openedNativePaths: string[];
  windowCommands: string[];
  windowMaximized: boolean;
  completionInputs: string[];
  directoryQueries: string[];
  cancelledQueries: number[];
  closedSessions: number[];
  cancelledScans: number[];
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
  locale: "en-US" | "zh-CN" = "en-US",
): Promise<void> {
  await page.addInitScript(({ initialSidebarMode, initialHoverDelayMs, initialMotion, initialAudioEnabled, initialLocale }) => {
    if (window.sessionStorage.getItem("muller.e2e.desktop-initialized") !== "true") {
      window.localStorage.clear();
      window.localStorage.setItem("muller.preferences.v1", JSON.stringify({
        version: 1,
        locale: initialLocale,
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
      autostartEnabled: false,
      closeBehavior: "hide",
      debugLoggingEnabled: false,
      debugLoggingFailure: "none",
      diagnosticsStatusError: null,
      diagnosticLogs: [],
      openedNativePaths: [],
      windowCommands: [],
      windowMaximized: false,
      completionInputs: [],
      directoryQueries: [],
      cancelledQueries: [],
      closedSessions: [],
      cancelledScans: [],
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
      __mullerE2eHtmlDrag: boolean;
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
    runtime.__mullerE2eHtmlDrag = true;

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
        if (command === "get_close_behavior") {
          return { behavior: state.closeBehavior };
        }
        if (command === "set_close_behavior") {
          state.closeBehavior = payload.behavior ?? "hide";
          return { behavior: state.closeBehavior };
        }
        if (command === "get_autostart_status") {
          return { enabled: state.autostartEnabled, error: null };
        }
        if (command === "set_autostart_enabled") {
          state.autostartEnabled = payload.enabled === true;
          return { enabled: state.autostartEnabled, error: null };
        }
        if (command === "get_diagnostics_status") {
          return {
            debugEnabled: state.debugLoggingEnabled,
            effectiveLevel: state.debugLoggingEnabled ? "debug" : "info",
            logDirectory: "C:\\Users\\test\\AppData\\Local\\app.muller.desktop\\logs",
            error: state.diagnosticsStatusError
              ? { code: state.diagnosticsStatusError }
              : null,
          };
        }
        if (command === "set_debug_logging") {
          const failure = state.debugLoggingFailure;
          state.debugLoggingFailure = "none";
          if (failure === "before-write") {
            return Promise.reject(new Error("diagnostics persistence failed"));
          }
          state.debugLoggingEnabled = payload.enabled === true;
          if (failure === "after-write") {
            return Promise.reject(new Error("diagnostics response was lost"));
          }
          return {
            debugEnabled: state.debugLoggingEnabled,
            effectiveLevel: state.debugLoggingEnabled ? "debug" : "info",
            logDirectory: "C:\\Users\\test\\AppData\\Local\\app.muller.desktop\\logs",
            error: null,
          };
        }
        if (command === "get_diagnostics_log_directory") {
          return "C:\\Users\\test\\AppData\\Local\\app.muller.desktop\\logs";
        }
        if (command === "plugin:log|log") {
          if (typeof payload.message === "string") state.diagnosticLogs.push(payload.message);
          return null;
        }
        if (command === "open_native_path") {
          if (typeof payload.path === "string") state.openedNativePaths.push(payload.path);
          return "opened";
        }
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
            { id: "profile", label: "Profile", path: "D:\\Muller" },
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
        if (command === "cancel_directory_query") {
          if (typeof payload.taskId === "number") state.cancelledQueries.push(payload.taskId);
          return null;
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
        if (command === "start_scan") {
          const nextTaskId = ++taskId;
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId: nextTaskId });
          });
          return { taskId: nextTaskId };
        }
        if (command === "cancel_scan") {
          if (typeof payload.taskId === "number") state.cancelledScans.push(payload.taskId);
          return { taskId: payload.taskId ?? 0, cancelled: true };
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
    initialLocale: locale,
  });
}

async function mockState(page: Page): Promise<MockState> {
  return page.evaluate(() => (
    globalThis as typeof globalThis & { __muller710: MockState }
  ).__muller710);
}

async function startComposition(input: Locator): Promise<void> {
  await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      composed: true,
    }));
  });
}

async function inputCompositionValue(
  input: Locator,
  value: string,
  isComposing: boolean,
): Promise<void> {
  await input.evaluate((element, payload) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.bind(element);
    if (!setValue) throw new Error("Native input value setter is unavailable");
    setValue(payload.value);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: payload.value,
      inputType: payload.isComposing ? "insertCompositionText" : "insertText",
      isComposing: payload.isComposing,
    }));
  }, { value, isComposing });
}

async function endComposition(input: Locator, value: string): Promise<void> {
  await input.evaluate((element, finalValue) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.bind(element);
    if (!setValue) throw new Error("Native input value setter is unavailable");
    setValue(finalValue);
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      composed: true,
      data: finalValue,
    }));
  }, value);
  await inputCompositionValue(input, value, false);
}

async function dispatchImeKey(
  input: Locator,
  key: string,
  options: { isComposing?: boolean; keyCode?: number } = {},
): Promise<boolean> {
  return input.evaluate((element, payload) => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      isComposing: payload.isComposing,
      key: payload.key,
    });
    if (payload.keyCode !== undefined) {
      Object.defineProperty(event, "keyCode", { configurable: true, value: payload.keyCode });
      Object.defineProperty(event, "which", { configurable: true, value: payload.keyCode });
    }
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, { key, ...options });
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

async function startVerticalMotionSampling(
  page: Page,
  selector: string,
  key: string,
  durationMs = 1_000,
): Promise<void> {
  await page.evaluate(({ targetSelector, storageKey, sampleDuration }) => {
    const samples: number[] = [];
    Reflect.set(window, storageKey, samples);
    const deadline = performance.now() + sampleDuration;
    const capture = () => {
      const element = document.querySelector(targetSelector);
      if (element) samples.push(element.getBoundingClientRect().y);
      if (performance.now() < deadline) requestAnimationFrame(capture);
    };
    capture();
  }, { targetSelector: selector, storageKey: key, sampleDuration: durationMs });
}

async function verticalMotionSamples(page: Page, key: string): Promise<number[]> {
  return page.evaluate((storageKey) => Reflect.get(window, storageKey) as number[], key);
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

test("Windows known folders use Chinese names and distinct location glyphs", async ({ page }) => {
  await installDesktopMock(page, "classic", 0, "reduced", false, "zh-CN");
  await page.goto("/");
  const sidebar = page.locator(".classic-sidebar");
  const home = sidebar.getByRole("button", { name: "用户主目录", exact: true });
  const desktop = sidebar.getByRole("button", { name: "桌面", exact: true });
  const downloads = sidebar.getByRole("button", { name: "下载", exact: true });
  await expect(home.locator(".location-glyph.is-profile")).toBeVisible();
  await expect(desktop.locator(".location-glyph.is-desktop")).toBeVisible();
  await expect(downloads.locator(".location-glyph.is-downloads")).toBeVisible();
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

test("Compare Browse supports pane Tab switching, normal context actions, preview, and native drag", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const workspace = page.locator(".compare-workspace");
  const panes = workspace.locator(".directory-pane");
  const viewports = workspace.locator(".directory-list-viewport");
  await expect(panes).toHaveCount(2);

  await viewports.nth(0).focus();
  await page.keyboard.press("Tab");
  await expect(panes.nth(1)).toHaveClass(/is-active/);
  await expect(viewports.nth(1)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(panes.nth(0)).toHaveClass(/is-active/);

  await viewports.nth(0).focus();
  await page.keyboard.press("d");
  await expect(panes.nth(0).locator(".directory-row", { hasText: "Destination" })).toHaveAttribute("aria-selected", "true");

  const first = viewports.nth(0).locator(".directory-row:not(.is-placeholder)").first();
  await first.evaluate((entry) => {
    entry.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: window.innerWidth - 2,
      clientY: window.innerHeight - 2,
    }));
  });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Copy", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Cut", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy file name", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy full path", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Compress selection to ZIP", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Properties", exact: true })).toBeVisible();
  const menuBounds = await menu.boundingBox();
  const viewportSize = page.viewportSize();
  expect(menuBounds ? menuBounds.x + menuBounds.width : Number.POSITIVE_INFINITY).toBeLessThanOrEqual((viewportSize?.width ?? 0) - 8);
  expect(menuBounds ? menuBounds.y + menuBounds.height : Number.POSITIVE_INFINITY).toBeLessThanOrEqual((viewportSize?.height ?? 0) - 8);
  await menu.getByRole("menuitem", { name: "Copy", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();

  const second = viewports.nth(0).locator(".directory-row:not(.is-placeholder)").nth(1);
  await first.click();
  await second.click({ modifiers: ["Control"] });
  await expect(viewports.nth(0).locator(".directory-row[aria-selected='true']")).toHaveCount(2);

  const viewportBounds = await viewports.nth(0).boundingBox();
  if (!viewportBounds) throw new Error("Compare browse viewport is not measurable");
  await page.mouse.click(
    viewportBounds.x + viewportBounds.width / 2,
    viewportBounds.y + viewportBounds.height - 8,
    { button: "right" },
  );
  const blankMenu = page.getByRole("menu");
  await expect(blankMenu.getByRole("menuitem", { name: "New folder", exact: true })).toBeVisible();
  await expect(blankMenu.getByRole("menuitem", { name: "New text document", exact: true })).toBeVisible();
  await expect(blankMenu.getByRole("menuitem", { name: "New empty file", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await first.click();

  await workspace.getByRole("button", { name: "Toggle preview" }).click();
  await expect(workspace.locator(".preview-panel")).toBeVisible();
  await workspace.getByRole("button", { name: "Enable automatic media playback" }).click();
  await expect(workspace.getByRole("button", { name: "Disable automatic media playback" })).toBeVisible();
  expect(await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("muller.preferences.v1") ?? "{}") as {
      mediaAutoplay?: unknown;
    };
    return stored.mediaAutoplay === true;
  })).toBe(true);
  await workspace.getByRole("button", { name: "Close preview" }).click();

  await first.locator(".directory-drag-label").evaluate((source) => {
    Reflect.set(globalThis, "__mullerE2eHtmlDrag", false);
    source.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer(),
    }));
  });
  await expect.poll(async () => (await mockState(page)).nativeDragPaths.at(-1)).toEqual(["D:\\Muller\\Alpha.txt"]);
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
  await expect(panes.nth(0).locator(".directory-pane-heading > span")).toHaveAttribute("title", "D:\\Muller\\Destination");
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
  await expect(panes.nth(0).locator(".directory-pane-heading > span")).toHaveAttribute("title", "D:\\");

  await page.getByRole("button", { name: "Right: Open selected child folder" }).click();
  await expect(panes.nth(1).locator(".directory-pane-heading > span")).toHaveAttribute("title", "D:\\Muller\\Destination");

  await page.locator(".compare-actions .command-button.is-primary").click();
  await expect(page.locator(".folder-diff-pane")).toBeVisible();
  await page.getByRole("button", { name: "Up one level", exact: true }).click();
  await expect(page.locator(".compare-browser-surface")).toBeVisible();
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(1).locator(".directory-pane-heading > span")).toHaveAttribute("title", "D:\\");
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

test("desktop lifecycle and diagnostic settings update native state and restore defaults", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();

  const hide = page.getByRole("radio", { name: "Hide to system tray" });
  const quit = page.getByRole("radio", { name: "Quit Muller" });
  const autostart = page.getByRole("checkbox", { name: "Start Muller when I sign in to Windows" });
  const debugLogging = page.getByRole("checkbox", { name: "Detailed debug logging" });
  await expect(hide).toHaveAttribute("aria-checked", "true");
  await expect(autostart).not.toBeChecked();
  await expect(debugLogging).not.toBeChecked();

  await quit.click();
  await autostart.check();
  await debugLogging.check();
  await page.getByRole("button", { name: "Open log folder" }).click();
  await expect.poll(async () => {
    const state = await mockState(page);
    return {
      closeBehavior: state.closeBehavior,
      autostartEnabled: state.autostartEnabled,
      debugLoggingEnabled: state.debugLoggingEnabled,
      openedNativePaths: state.openedNativePaths.length,
    };
  }).toEqual({
    closeBehavior: "quit",
    autostartEnabled: true,
    debugLoggingEnabled: true,
    openedNativePaths: 1,
  });

  await page.getByRole("button", { name: "Restore defaults" }).click();
  await expect.poll(async () => {
    const state = await mockState(page);
    return {
      closeBehavior: state.closeBehavior,
      autostartEnabled: state.autostartEnabled,
      debugLoggingEnabled: state.debugLoggingEnabled,
    };
  }).toEqual({ closeBehavior: "hide", autostartEnabled: false, debugLoggingEnabled: false });
  await expect(hide).toHaveAttribute("aria-checked", "true");
  await expect(autostart).not.toBeChecked();
  await expect(debugLogging).not.toBeChecked();
});

test("diagnostic setting failures restore or re-read the native truth", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const debugLogging = page.getByRole("checkbox", { name: "Detailed debug logging" });

  await page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __muller710: MockState };
    runtime.__muller710.debugLoggingFailure = "before-write";
  });
  await debugLogging.click();
  await expect(debugLogging).not.toBeChecked();
  await expect(page.getByRole("alert")).toContainText("Could not update detailed debug logging");

  await page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __muller710: MockState };
    runtime.__muller710.debugLoggingFailure = "after-write";
    runtime.__muller710.diagnosticsStatusError = "diagnostics_file_unavailable";
  });
  await debugLogging.check();
  await expect(debugLogging).toBeChecked();
  await expect.poll(async () => (await mockState(page)).debugLoggingEnabled).toBe(true);
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
  await expect(page.locator(".stage7-shell")).toHaveClass(/is-window-maximized/);
  await expect(page.locator(".stage7-shell")).toHaveCSS("border-radius", "0px");
  await expect(page.locator(".flow-border")).toHaveCSS("border-radius", "0px");
  await restore.click();
  await expect(page.getByRole("button", { name: "Maximize" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".stage7-shell")).not.toHaveClass(/is-window-maximized/);
  await expect(page.locator(".stage7-shell")).toHaveCSS("border-radius", "12px");
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
  await expect(wheel.getByRole("option")).toHaveCount(5);
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
  await expect(items).toHaveCount(5);

  for (let index = 0; index < 5; index += 1) {
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

test("IME pre-edit stays local and Enter submits only the final search value", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("checkbox", { name: "Detailed debug logging" }).check();
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await page.keyboard.press("Control+f");
  const search = page.getByRole("textbox", { name: "Search current directory" });
  await expect(search).toBeFocused();
  const before = await mockState(page);

  await startComposition(search);
  await inputCompositionValue(search, "zhong", true);
  await page.waitForTimeout(180);
  await expect(search).toHaveValue("zhong");
  await expect(search).toBeFocused();
  let current = await mockState(page);
  expect(current.searchCalls).toEqual(before.searchCalls);
  expect(current.expandedSearchCalls).toEqual(before.expandedSearchCalls);
  expect(current.cancelledQueries).toEqual(before.cancelledQueries);
  expect(current.closedSessions).toEqual(before.closedSessions);

  expect(await dispatchImeKey(search, "Enter", { isComposing: true })).toBe(false);
  await expect(search).toBeFocused();
  expect((await mockState(page)).searchCalls).toEqual(before.searchCalls);

  const finalValue = "\u4e2d";
  await endComposition(search, finalValue);
  await expect.poll(async () => (
    await mockState(page)
  ).searchCalls.filter((call) => call.query === finalValue).length).toBe(1);
  await expect(search).toHaveValue(finalValue);
  await expect(search).toBeFocused();

  await inputCompositionValue(search, finalValue, false);
  await page.waitForTimeout(180);
  current = await mockState(page);
  expect(current.searchCalls.filter((call) => call.query === finalValue)).toHaveLength(1);
  expect(current.searchCalls.some((call) => call.query === "zhong")).toBe(false);
  expect(current.diagnosticLogs.some((entry) => entry.includes("event=ime.composition_start"))).toBe(true);
  expect(current.diagnosticLogs.some((entry) => entry.includes("inputLength="))).toBe(true);
  expect(current.diagnosticLogs.some((entry) => entry.includes("phase=composition"))).toBe(true);
  expect(current.diagnosticLogs.join(" ")).not.toContain("zhong");
  expect(current.diagnosticLogs.join(" ")).not.toContain(finalValue);
});

test("IME final queries are isolated across recursive global and dual-pane search", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  const search = page.getByRole("textbox", { name: "Search current directory" });

  await page.getByRole("button", { name: "Choose search mode" }).click();
  await page.getByRole("menuitemradio", { name: "Search this folder and all subfolders" }).click();
  await page.waitForTimeout(180);
  let before = await mockState(page);
  await startComposition(search);
  await inputCompositionValue(search, "digui", true);
  await page.waitForTimeout(180);
  expect((await mockState(page)).expandedSearchCalls).toEqual(before.expandedSearchCalls);
  const recursiveValue = "\u9012\u5f52";
  await endComposition(search, recursiveValue);
  await expect.poll(async () => (
    await mockState(page)
  ).expandedSearchCalls.filter((call) => call.query === recursiveValue).length).toBe(1);

  await page.getByRole("button", { name: "Choose search mode" }).click();
  await page.getByRole("menuitemradio", { name: "Search all drives" }).click();
  await page.waitForTimeout(180);
  before = await mockState(page);
  await startComposition(search);
  await inputCompositionValue(search, "quanpan", true);
  await page.waitForTimeout(180);
  expect((await mockState(page)).expandedSearchCalls).toEqual(before.expandedSearchCalls);
  const globalValue = "\u5168\u76d8";
  await endComposition(search, globalValue);
  await expect.poll(async () => (
    await mockState(page)
  ).expandedSearchCalls.filter((call) => call.query === globalValue).length).toBe(1);

  await page.getByRole("button", { name: "Choose search mode" }).click();
  await page.getByRole("menuitemradio", { name: "Search inside this folder only" }).click();
  await page.waitForTimeout(180);
  await page.getByRole("button", { name: "Search both panes" }).click();
  await page.waitForTimeout(180);
  before = await mockState(page);
  await startComposition(search);
  await inputCompositionValue(search, "shuanglan", true);
  await page.waitForTimeout(180);
  expect((await mockState(page)).searchCalls).toEqual(before.searchCalls);
  const bothValue = "\u53cc\u680f";
  await endComposition(search, bothValue);
  await expect.poll(async () => new Set((
    await mockState(page)
  ).searchCalls.filter((call) => call.query === bothValue).map((call) => call.sessionId)).size).toBe(2);
});

test("IME 229 Escape preserves the search and does not cancel an active scan", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Duplicates", exact: true }).click();
  await page.getByRole("button", { name: "Start duplicate scan" }).click();
  await expect(page.getByRole("button", { name: "Cancel scan" })).toBeEnabled();
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search current directory" });
  await search.fill("Alpha");
  await expect.poll(async () => (
    await mockState(page)
  ).searchCalls.filter((call) => call.query === "alpha").length).toBe(1);
  await search.focus();

  await startComposition(search);
  await inputCompositionValue(search, "Alphapin", true);
  expect(await dispatchImeKey(search, "Escape", { keyCode: 229 })).toBe(false);
  await page.waitForTimeout(180);
  await expect(search).toHaveValue("Alphapin");
  await expect(search).toBeFocused();
  expect((await mockState(page)).cancelledScans).toEqual([]);
  expect((await mockState(page)).searchCalls.some((call) => call.query === "alphapin")).toBe(false);

  await endComposition(search, "Alpha");
  await search.press("Escape");
  await expect.poll(async () => (await mockState(page)).cancelledScans.length).toBe(1);
  await expect(search).toHaveValue("");
});

test("shared directory search keeps IME candidate keys inside the input", async ({ page }) => {
  await installDesktopMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Duplicates", exact: true }).click();
  await page.keyboard.press("Control+f");
  const search = page.getByRole("textbox", { name: "Search duplicate results" });
  await expect(search).toBeFocused();

  await startComposition(search);
  await inputCompositionValue(search, "weixin", true);
  expect(await dispatchImeKey(search, "Enter", { isComposing: true })).toBe(false);
  expect(await dispatchImeKey(search, "Escape", { isComposing: true })).toBe(false);
  await expect(search).toHaveValue("weixin");
  await expect(search).toBeFocused();

  const finalValue = "\u5fae\u4fe1";
  await endComposition(search, finalValue);
  await expect(search).toHaveValue(finalValue);
  await expect(search).toBeFocused();
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
  await page.clock.install();
  await page.goto("/");
  const viewport = page.locator(".directory-list-viewport").first();
  const focusSurface = viewport.locator(".directory-list-selection");
  await viewport.focus();
  await page.clock.pauseAt(Date.now() + 1_000);
  const start = await focusSurface.boundingBox();
  if (!start) throw new Error("List focus spring start geometry is unavailable");
  await page.keyboard.press("ArrowDown");
  await page.clock.runFor(32);
  const middle = await focusSurface.boundingBox();
  if (!middle) throw new Error("List focus spring middle geometry is unavailable");
  expect(middle.y).toBeGreaterThan(start.y + 1);
  expect(middle.y).toBeLessThan(start.y + 31);
  await page.clock.runFor(500);
  const end = await focusSurface.boundingBox();
  if (!end) throw new Error("List focus spring end geometry is unavailable");
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
  if (firstTop === undefined) throw new Error("Pointer follow start geometry is unavailable");
  await startVerticalMotionSampling(
    page,
    ".directory-list-viewport .directory-list-hover",
    "__mullerPointerFollowSamples",
  );
  await rows.nth(1).hover();
  await expect.poll(async () => Math.round(
    ((await viewport.locator(".directory-list-hover").boundingBox())?.y ?? firstTop) - firstTop,
  )).toBe(32);
  const samples = await verticalMotionSamples(page, "__mullerPointerFollowSamples");
  expect(samples.some((y) => y > firstTop + 1 && y < firstTop + 31)).toBe(true);
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
  await expect.poll(async () => Math.round(
    ((await viewport.locator(".directory-list-hover").boundingBox())?.y ?? firstTop) - firstTop,
  )).toBe(128);
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
