import { expect, test, type Page } from "@playwright/test";

interface MockChannel {
  onmessage: (message: unknown) => void;
}

interface MockInvokePayload {
  onEvent?: MockChannel;
  request?: { path: string; generation?: number; filter?: { extensions?: string[] } };
  sessionId?: number;
  offset?: number;
  limit?: number;
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function installAlbumDirectoryMock(page: Page, entryCount: number): Promise<void> {
  await page.addInitScript((count) => {
    const runtime = globalThis as typeof globalThis & {
      isTauri: boolean;
      __mullerAlbumFilters: string[][];
      __mullerConvertedPaths: string[];
    };
    const tauriWindow = window as unknown as {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: string } };
        convertFileSrc: (path: string, protocol: string) => string;
        transformCallback: (callback?: (message: unknown) => void) => number;
        unregisterCallback: (id: number) => void;
        invoke: (command: string, payload: MockInvokePayload) => unknown;
      };
    };
    const callbacks = new Map<number, (message: unknown) => void>();
    let callbackId = 0;
    let taskId = 0;
    let sessionId = 0;
    runtime.isTauri = true;
    runtime.__mullerAlbumFilters = [];
    runtime.__mullerConvertedPaths = [];
    tauriWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      convertFileSrc(path, protocol) {
        runtime.__mullerConvertedPaths.push(path);
        void protocol;
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69pP1wAAAABJRU5ErkJggg==";
      },
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
        if (command === "start_directory_query") {
          const nextTask = ++taskId;
          const nextSession = ++sessionId;
          const channel = payload.onEvent;
          const path = payload.request?.path ?? "D:\\Pictures";
          runtime.__mullerAlbumFilters.push(payload.request?.filter?.extensions ?? []);
          queueMicrotask(() => {
            channel?.onmessage({ type: "started", taskId: nextTask });
            channel?.onmessage({
              type: "ready",
              taskId: nextTask,
              sessionId: nextSession,
              path,
              parent: null,
              totalEntries: count,
            });
          });
          return { taskId: nextTask };
        }
        if (command === "read_directory_page") {
          const offset = payload.offset ?? 0;
          const limit = Math.min(payload.limit ?? 128, count - offset);
          return {
            sessionId: payload.sessionId,
            offset,
            totalEntries: count,
            entries: Array.from({ length: Math.max(0, limit) }, (_, index) => {
              const position = offset + index;
              const extension = position === 0 ? "cr3" : position === 1 ? "gif" : "png";
              return {
                path: `D:\\Pictures\\image-${position}.${extension}`,
                name: `image-${position}.${extension}`,
                kind: "file",
                extension,
                size: 1_024,
                modifiedUnixMs: 0,
                hidden: false,
              };
            }),
          };
        }
        if (command === "start_image_thumbnail") {
          const nextTask = ++taskId;
          const channel = payload.onEvent;
          queueMicrotask(() => channel?.onmessage({
            type: "error",
            taskId: nextTask,
            message: "Thumbnail omitted by test runtime",
          }));
          return { taskId: nextTask };
        }
        if (command === "start_shell_visual") {
          const nextTask = ++taskId;
          const channel = payload.onEvent;
          const generation = payload.request?.generation ?? 0;
          const path = payload.request?.path ?? "D:\\Pictures\\image-0.cr3";
          queueMicrotask(() => {
            channel?.onmessage({ type: "started", taskId: nextTask, generation });
            channel?.onmessage({
              type: "ready",
              taskId: nextTask,
              generation,
              visual: {
                path,
                dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69pP1wAAAABJRU5ErkJggg==",
                width: 1,
                height: 1,
                sourceBytes: 2_048,
                modifiedUnixMs: 0,
                visualType: "shell-thumbnail",
              },
            });
          });
          return { taskId: nextTask };
        }
        if (command === "start_file_preview") {
          const nextTask = ++taskId;
          const channel = payload.onEvent;
          const path = payload.request?.path ?? "D:\\Pictures\\image-1.gif";
          queueMicrotask(() => {
            channel?.onmessage({ type: "started", taskId: nextTask });
            channel?.onmessage({
              type: "ready",
              taskId: nextTask,
              preview: {
                path,
                name: "image-1.gif",
                kind: "image",
                mime: "image/gif",
                text: null,
                dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69pP1wAAAABJRU5ErkJggg==",
                artworkDataUrl: null,
                message: null,
                fileSize: 1_024,
                bytesLoaded: 128,
                createdUnixMs: null,
                modifiedUnixMs: 0,
                accessedUnixMs: null,
                extension: "gif",
                metadata: [],
                truncated: false,
              },
            });
          });
          return { taskId: nextTask };
        }
        return null;
      },
    };
  }, entryCount);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("muller.workspace.v1");
    window.localStorage.removeItem("muller.workspace.v2");
    window.localStorage.setItem("muller:tool-modes-expanded", "true");
  });
});

test("Album masonry scrolling keeps the application root mounted", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Album/ }).click();

  const viewport = page.locator(".directory-grid-viewport.is-album").first();
  await expect(viewport).toBeVisible();

  // Browser-mode directory data is empty, so create enough scroll range to
  // exercise the same native scroll lifecycle as a large desktop album.
  await viewport.locator(".directory-grid-spacer").evaluate((element) => {
    element.style.height = "4000px";
  });
  await viewport.evaluate((element) => {
    element.scrollTop = 1200;
  });
  await page.waitForTimeout(100);

  await expect(page.locator(".stage7-shell")).toBeVisible();
  await expect(viewport).toBeVisible();
  expect(errors).toEqual([]);
});

test("Album selection moves with a spring without scrolling visible tiles", async ({ page }) => {
  await installAlbumDirectoryMock(page, 100);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = trackPageErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Album/ }).click();

  const viewport = page.locator(".directory-grid-viewport.is-album").first();
  const tiles = viewport.locator(".directory-tile:not(.is-placeholder)");
  const selection = viewport.locator(".directory-grid-selection");
  await expect(tiles.nth(1)).toBeVisible();
  await expect(selection).toBeVisible();
  await page.waitForTimeout(300);

  const start = await selection.boundingBox();
  const target = await tiles.nth(1).boundingBox();
  if (!start || !target) throw new Error("Album selection geometry is unavailable");
  const scrollBefore = await viewport.evaluate((element) => element.scrollTop);

  await tiles.nth(1).click();
  await page.waitForTimeout(50);
  const middle = await selection.boundingBox();
  if (!middle) throw new Error("Album selection disappeared during its transition");
  expect(middle.x).toBeGreaterThan(start.x + 1);
  expect(middle.x).toBeLessThan(target.x - 1);

  await page.waitForTimeout(350);
  const end = await selection.boundingBox();
  if (!end) throw new Error("Album selection disappeared after its transition");
  expect(end.x).toBeCloseTo(target.x, 0);
  expect(end.y).toBeCloseTo(target.y, 0);
  expect(end.width).toBeCloseTo(target.width, 0);
  expect(end.height).toBeCloseTo(target.height, 0);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  expect(errors).toEqual([]);
});

test("Album includes camera RAW files and renders their Shell preview", async ({ page }) => {
  await installAlbumDirectoryMock(page, 4);
  await page.goto("/");
  await page.getByRole("button", { name: /Album/ }).click();

  await expect.poll(() => page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __mullerAlbumFilters?: string[][] };
    return runtime.__mullerAlbumFilters?.at(-1) ?? [];
  })).toEqual(expect.arrayContaining(["cr2", "cr3", "nef", "arw", "dng", "raf", "rw2"]));

  const rawTile = page.locator(".directory-grid-viewport.is-album .directory-tile", { hasText: "image-0.cr3" }).first();
  await expect(rawTile).toBeVisible();
  await rawTile.click();
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await expect(page.locator(".preview-panel .preview-content img")).toBeVisible();
  await expect(page.locator(".preview-panel")).toContainText("image-0.cr3");
});

test("Album and the preview panel play GIF files from the original source", async ({ page }) => {
  await installAlbumDirectoryMock(page, 4);
  await page.goto("/");
  await page.getByRole("button", { name: /Album/ }).click();

  const gifTile = page.locator(".directory-grid-viewport.is-album .directory-tile", { hasText: "image-1.gif" }).first();
  await expect(gifTile).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __mullerConvertedPaths?: string[] };
    return runtime.__mullerConvertedPaths?.some((path) => /image-1\.gif$/i.test(path)) ?? false;
  })).toBe(true);
  await gifTile.click();
  await page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __mullerConvertedPaths?: string[] };
    if (runtime.__mullerConvertedPaths) runtime.__mullerConvertedPaths.length = 0;
  });
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await expect(page.locator(".preview-panel .preview-content img")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & { __mullerConvertedPaths?: string[] };
    return runtime.__mullerConvertedPaths?.some((path) => /image-1\.gif$/i.test(path)) ?? false;
  })).toBe(true);
});
