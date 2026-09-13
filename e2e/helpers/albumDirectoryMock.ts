import type { Page } from "@playwright/test";

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

export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

export async function installAlbumDirectoryMock(page: Page, entryCount: number): Promise<void> {
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
        if (command === "get_shell_locations") {
          return [{ id: "profile", label: "Profile", path: "D:\\Pictures" }];
        }
        if (command === "list_logical_drives") return [];
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

