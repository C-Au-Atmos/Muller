import { expect, test, type Page } from "@playwright/test";

interface NativeMockState {
  state: "disabled" | "starting" | "building" | "ready" | "degraded" | "error";
  entries: number;
  volumes: number;
  message: string | null;
  provider: string;
  enabledRoots: string[][];
  cancelFirst: boolean;
  stops: number;
}

async function installNativeMock(page: Page, cancelFirst = false) {
  await page.addInitScript((cancel) => {
    localStorage.clear();
    localStorage.setItem("muller.preferences.v1", JSON.stringify({ version: 1, locale: "en-US", theme: "platinum", audioEnabled: false, motion: "reduced" }));
    const state: NativeMockState = {
      state: "disabled", entries: 0, volumes: 0, message: null,
      provider: "portable-snapshot-walker", enabledRoots: [], cancelFirst: cancel, stops: 0,
    };
    const runtime = globalThis as typeof globalThis & { isTauri: boolean; __mullerNativeIndex: NativeMockState };
    runtime.isTauri = true;
    runtime.__mullerNativeIndex = state;
    let callbackId = 0;
    const tauriWindow = window as unknown as {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: string } };
        transformCallback: () => number;
        unregisterCallback: () => void;
        invoke: (command: string, payload: { roots?: string[] }) => unknown;
      };
    };
    tauriWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => ++callbackId,
      unregisterCallback: () => undefined,
      invoke(command, payload) {
        if (command === "plugin:window|is_maximized") return false;
        if (command === "get_shell_locations") return [];
        if (command === "list_logical_drives") return [{ path: "D:\\", label: "Data", fileSystem: "NTFS", driveType: "fixed", totalBytes: 1_000_000, freeBytes: 500_000 }];
        if (command === "get_native_indexer_status") return {
          state: state.state, entries: state.entries, volumes: state.volumes, message: state.message, provider: state.provider,
        };
        if (command === "enable_native_indexer") {
          state.enabledRoots.push(payload.roots ?? []);
          if (state.cancelFirst) {
            state.cancelFirst = false;
            state.state = "degraded";
            state.message = "Native index was not started; folder scanning remains available.";
            return Promise.reject(Object.assign(new Error("The operation was canceled by the user."), { code: 1223 }));
          }
          state.state = "building";
          state.provider = "ntfs-mft-usn";
          state.entries = 10_000;
          state.volumes = 1;
          state.message = null;
          return null;
        }
        if (command === "stop_native_indexer") {
          state.stops += 1;
          state.state = "disabled";
          state.provider = "portable-snapshot-walker";
          state.entries = 0;
          state.volumes = 0;
          state.message = "Native indexing cancelled";
          return null;
        }
        return null;
      },
    };
  }, cancelFirst);
}

test("fast index starts only on demand and reports real provider and readiness", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installNativeMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "NTFS fast index: Not enabled", exact: true }).click();
  const panel = page.getByRole("region", { name: "NTFS fast index", exact: true });
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __mullerNativeIndex: NativeMockState }).__mullerNativeIndex.enabledRoots)).toEqual([]);
  await panel.getByRole("button", { name: "Enable fast index", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Building index");
  await expect(panel).toContainText("10,000");
  await page.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __mullerNativeIndex: NativeMockState }).__mullerNativeIndex;
    state.state = "ready";
    state.entries = 123_456;
  });
  await expect(panel.getByRole("status")).toHaveText("Ready", { timeout: 10_000 });
  await expect(panel).toContainText("123,456");
  await panel.getByText("Index details", { exact: true }).click();
  await expect(panel).toContainText("ntfs-mft-usn");
  await expect(panel).toContainText("Space map still scans file sizes separately");
  await expect(panel).toContainText("Additional hard-link names are not yet covered");
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __mullerNativeIndex: NativeMockState }).__mullerNativeIndex.enabledRoots)).toEqual([["D:\\"]]);
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole("button", { name: "NTFS fast index: Ready", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test("cancelled administrator approval shows fallback and allows an explicit retry", async ({ page }) => {
  await installNativeMock(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "NTFS fast index: Not enabled", exact: true }).click();
  const panel = page.getByRole("region", { name: "NTFS fast index", exact: true });
  await panel.getByRole("button", { name: "Enable fast index", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Administrator approval was cancelled");
  await expect(panel.getByRole("status")).toHaveText("Fallback search");
  await expect(panel.getByRole("button", { name: "Enable fast index", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __mullerNativeIndex: NativeMockState }).__mullerNativeIndex.enabledRoots.length)).toBe(1);
  await panel.getByRole("button", { name: "Enable fast index", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Building index");
  await expect(panel.getByRole("alert")).not.toBeVisible();
});

test("cancelled restore can be stopped even when no NTFS volumes are ready", async ({ page }) => {
  await installNativeMock(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "NTFS fast index: Not enabled", exact: true }).click();
  const panel = page.getByRole("region", { name: "NTFS fast index", exact: true });
  await panel.getByRole("button", { name: "Enable fast index", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Fallback search");
  await panel.getByRole("button", { name: "Stop fast index", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Not enabled");
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __mullerNativeIndex: NativeMockState }).__mullerNativeIndex.stops)).toBe(1);
});

test("browser preview never offers a usable native elevation action", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /NTFS (fast index|快速索引)/ }).click();
  await expect(page.locator("#native-indexer-panel")).toContainText(/Windows app|Windows 程序/);
  await expect(page.locator(".native-indexer__enable")).toBeDisabled();
});

test("an in-progress build can be stopped and then explicitly enabled again", async ({ page }) => {
  await installNativeMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "NTFS fast index: Not enabled", exact: true }).click();
  const panel = page.getByRole("region", { name: "NTFS fast index", exact: true });
  await panel.getByRole("button", { name: "Enable fast index", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Building index");
  await panel.getByRole("button", { name: "Stop fast index", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Not enabled");
  await expect(panel.getByRole("button", { name: "Stop fast index", exact: true })).not.toBeVisible();
  await expect(panel.getByRole("button", { name: "Enable fast index", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __mullerNativeIndex: NativeMockState }).__mullerNativeIndex.stops)).toBe(1);
  await panel.getByRole("button", { name: "Enable fast index", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Building index");
});
