import { expect, test, type Page } from "@playwright/test";

interface MockChannel {
  onmessage: (message: unknown) => void;
}

interface MockPayload {
  onEvent?: MockChannel;
  request?: {
    path?: string;
    generation?: number;
    logicalSize?: number;
    preference?: string;
  };
  sessionId?: number;
  offset?: number;
}

interface PreviewMockState {
  filePreviewPaths: string[];
  shellRequests: { path: string; logicalSize: number; preference: string }[];
}

async function installPreviewMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem("muller.preferences.v1", JSON.stringify({
      version: 1,
      locale: "en-US",
      theme: "dark",
      density: "compact",
      uiScale: 100,
      sidebarMode: "classic",
      audioEnabled: false,
      audioVolume: 65,
      lastNonZeroAudioVolume: 65,
      hoverDelayMs: 0,
      motion: "reduced",
    }));
    const entries = [
      { path: "D:\\Dev\\settings.ini", name: "settings.ini", kind: "file", extension: "ini", size: 36, modifiedUnixMs: 1_720_000_000_000, hidden: false },
      { path: "D:\\Dev\\roadmap.pptx", name: "roadmap.pptx", kind: "file", extension: "pptx", size: 8_192, modifiedUnixMs: 1_721_000_000_000, hidden: false },
    ];
    const state: PreviewMockState = { filePreviewPaths: [], shellRequests: [] };
    const runtime = globalThis as typeof globalThis & {
      isTauri: boolean;
      __mullerDeveloperPreview: PreviewMockState;
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
    runtime.isTauri = true;
    runtime.__mullerDeveloperPreview = state;
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
        if (command === "plugin:window|is_maximized") return false;
        if (command.startsWith("plugin:window|")) return null;
        if (command === "get_shell_locations") return [];
        if (command === "list_logical_drives") return [{
          path: "D:\\",
          label: "Local Disk",
          fileSystem: "NTFS",
          driveType: "fixed",
          totalBytes: 1_000_000,
          freeBytes: 500_000,
        }];
        if (command === "list_directory_extensions") {
          return [{ extension: "ini", count: 1 }, { extension: "pptx", count: 1 }];
        }
        if (command === "start_directory_query") {
          const nextTask = ++taskId;
          const nextSession = ++sessionId;
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId: nextTask });
            payload.onEvent?.onmessage({
              type: "ready",
              taskId: nextTask,
              sessionId: nextSession,
              path: payload.request?.path ?? "D:\\Dev",
              parent: "D:\\",
              totalEntries: entries.length,
            });
          });
          return { taskId: nextTask };
        }
        if (command === "read_directory_page") return {
          sessionId: payload.sessionId,
          offset: payload.offset ?? 0,
          totalEntries: entries.length,
          entries,
        };
        if (command === "start_file_preview") {
          const nextTask = ++taskId;
          const path = payload.request?.path ?? "";
          state.filePreviewPaths.push(path);
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId: nextTask });
            payload.onEvent?.onmessage({
              type: "ready",
              taskId: nextTask,
              preview: {
                path,
                name: "settings.ini",
                kind: "text",
                mime: "text/plain",
                text: "[server]\nport = 8080\n",
                dataUrl: null,
                artworkDataUrl: null,
                message: null,
                fileSize: 36,
                bytesLoaded: 24,
                createdUnixMs: null,
                modifiedUnixMs: 1_720_000_000_000,
                accessedUnixMs: null,
                extension: "ini",
                metadata: [{ label: "Encoding", value: "Utf8" }],
                truncated: false,
              },
            });
          });
          return { taskId: nextTask };
        }
        if (command === "start_shell_visual") {
          const nextTask = ++taskId;
          const generation = payload.request?.generation ?? 0;
          const path = payload.request?.path ?? "";
          state.shellRequests.push({
            path,
            logicalSize: payload.request?.logicalSize ?? 0,
            preference: payload.request?.preference ?? "",
          });
          queueMicrotask(() => {
            payload.onEvent?.onmessage({ type: "started", taskId: nextTask, generation });
            payload.onEvent?.onmessage({
              type: "ready",
              taskId: nextTask,
              generation,
              visual: {
                path,
                dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69pP1wAAAABJRU5ErkJggg==",
                width: 320,
                height: 180,
                sourceBytes: 8_192,
                modifiedUnixMs: 1_721_000_000_000,
                visualType: "pptx-embedded-thumbnail",
              },
            });
          });
          return { taskId: nextTask };
        }
        return null;
      },
    };
  });
}

test("developer text preview and PPTX cover use their dedicated renderers", async ({ page }) => {
  await installPreviewMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Browse", exact: true }).click();

  const viewport = page.locator(".directory-list-viewport").first();
  const ini = viewport.locator(".directory-row", { hasText: "settings.ini" });
  await expect(ini).toBeVisible();
  await ini.click();
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await expect(page.locator(".preview-panel pre")).toContainText("port = 8080");

  const pptx = viewport.locator(".directory-row", { hasText: "roadmap.pptx" });
  await pptx.click();
  await expect(page.locator(".preview-panel .preview-content img")).toBeVisible();
  await expect(page.locator(".preview-panel")).toContainText("roadmap.pptx");
  const state = await page.evaluate(() => (
    globalThis as typeof globalThis & { __mullerDeveloperPreview: PreviewMockState }
  ).__mullerDeveloperPreview);
  expect(state.filePreviewPaths.length).toBeGreaterThan(0);
  expect(state.filePreviewPaths.every((path) => path === "D:\\Dev\\settings.ini")).toBe(true);
  expect(state.shellRequests.at(-1)).toEqual({
    path: "D:\\Dev\\roadmap.pptx",
    logicalSize: 512,
    preference: "thumbnail",
  });
});
